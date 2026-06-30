import { vi, describe, it, expect, beforeEach } from "vitest"
import request from "supertest"
import express from "express"

// ── Mocks — hoistados pelo Vitest antes de qualquer import ────────────────────

vi.mock("../config/database.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))

vi.mock("../modules/security/menu-permissions.js", async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    attachMenuPermissions: vi.fn(async (user) => ({
      ...user,
      menuPermissions: {},
      modulePermissions: {},
    })),
  }
})

// ── Imports após os mocks ─────────────────────────────────────────────────────

import { prisma } from "../config/database.js"
import { authRouter } from "../modules/security/auth.routes.js"
import { hashPassword, createToken } from "../modules/security/security-utils.js"

// ── Mini app de teste — apenas o necessário para /auth ────────────────────────

const testApp = express()
testApp.use(express.json())
testApp.use("/auth", authRouter)

// ── Fixtures de módulo — bcrypt executado uma única vez (~200ms) ──────────────

const VALID_PASSWORD = "Senha@123"
const VALID_HASH = hashPassword(VALID_PASSWORD)

const BASE_USER = {
  id: "usr-test-001",
  name: "Admin Teste",
  email: "admin@pateo.local",
  role: "ADMIN",
  passwordHash: VALID_HASH,
  isActive: true,
  mustChangePassword: false,
  failedLoginAttempts: 0,
  lockedUntil: null,
}

// ── Helpers para reduzir repetição ───────────────────────────────────────────

const qRaw = () => vi.mocked(prisma.$queryRaw)
const eRaw = () => vi.mocked(prisma.$executeRaw)

function resetMocks() {
  vi.resetAllMocks()
  eRaw().mockResolvedValue(1n)
}

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe("POST /auth/login", () => {
  beforeEach(resetMocks)

  it("login válido — retorna 200 com token JWT e dados do usuário", async () => {
    qRaw()
      .mockResolvedValueOnce([BASE_USER]) // SELECT User WHERE email
      .mockResolvedValueOnce([])          // SELECT UserSession (sem sessão existente)

    const res = await request(testApp)
      .post("/auth/login")
      .send({ email: BASE_USER.email, password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe("string")
    expect(res.body.token.split(".")).toHaveLength(3)
    expect(res.body.user.id).toBe(BASE_USER.id)
    expect(res.body.user.email).toBe(BASE_USER.email)
    expect(res.body.user.role).toBe("ADMIN")
  })

  it("senha errada — retorna 401 com mensagem genérica", async () => {
    qRaw().mockResolvedValueOnce([BASE_USER])

    const res = await request(testApp)
      .post("/auth/login")
      .send({ email: BASE_USER.email, password: "SenhaErrada99" })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Credenciais invalidas.")
  })

  it("usuário inexistente — retorna 401 com mensagem genérica", async () => {
    qRaw().mockResolvedValueOnce([])

    const res = await request(testApp)
      .post("/auth/login")
      .send({ email: "nao@existe.com", password: VALID_PASSWORD })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Credenciais invalidas.")
  })

  it("usuário inativo — retorna 401 com mensagem genérica", async () => {
    qRaw().mockResolvedValueOnce([{ ...BASE_USER, isActive: false }])

    const res = await request(testApp)
      .post("/auth/login")
      .send({ email: BASE_USER.email, password: VALID_PASSWORD })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Credenciais invalidas.")
  })

  it("usuário bloqueado — retorna 423", async () => {
    qRaw().mockResolvedValueOnce([{
      ...BASE_USER,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    }])

    const res = await request(testApp)
      .post("/auth/login")
      .send({ email: BASE_USER.email, password: VALID_PASSWORD })

    expect(res.status).toBe(423)
    expect(res.body.message).toMatch(/bloqueado/i)
  })
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────

describe("POST /auth/logout", () => {
  beforeEach(resetMocks)

  it("logout com token válido — retorna 200 { ok: true }", async () => {
    const token = createToken({ id: BASE_USER.id, email: BASE_USER.email, role: "ADMIN" })
    qRaw().mockResolvedValueOnce([{ userId: BASE_USER.id }]) // sessão encontrada pelo tokenHash

    const res = await request(testApp)
      .post("/auth/logout")
      .set("Authorization", `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

// ── GET /auth/me — autenticação e sessão ─────────────────────────────────────

describe("GET /auth/me", () => {
  beforeEach(resetMocks)

  it("sem Authorization header — retorna 401", async () => {
    const res = await request(testApp).get("/auth/me")

    expect(res.status).toBe(401)
    expect(res.body.message).toBe("Sessao invalida.")
  })

  it("JWT com assinatura inválida — retorna 401 sem consultar banco", async () => {
    const res = await request(testApp)
      .get("/auth/me")
      .set("Authorization", "Bearer header.payload.assinatura-invalida")

    expect(res.status).toBe(401)
    expect(qRaw()).not.toHaveBeenCalled()
  })

  it("JWT válido mas sessão inexistente no banco — retorna 401", async () => {
    const token = createToken({ id: BASE_USER.id, email: BASE_USER.email, role: "ADMIN" })
    qRaw().mockResolvedValueOnce([])

    const res = await request(testApp)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`)

    expect(res.status).toBe(401)
    expect(qRaw()).toHaveBeenCalledTimes(1)
  })
})
