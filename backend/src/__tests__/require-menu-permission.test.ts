import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("../config/database.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))

import { prisma } from "../config/database.js"
import { requireMenuPermission } from "../modules/security/security-utils.js"

// Token opaco (64 hex): getSessionUser aceita sem JWT e busca a sessao no banco.
const TOKEN = "a".repeat(64)
const FULL = { view: true, create: true, edit: true, delete: true, approve: true, admin: true }
const SO_VER = { view: true, create: false, edit: false, delete: false, approve: false, admin: false }

function sessaoDe(role: string) {
  vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{
    id: "usr-1", name: "Teste", email: "t@pateo.local", role, mustChangePassword: false,
    lastActivityAt: new Date(), sessionCreatedAt: new Date()
  }] as never)
}

function resposta() {
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  return { status, json }
}

function pedido(menuAccess?: { action: "view" | "create" | "edit" | "delete" | "approve" | "admin"; permission: typeof FULL }) {
  return { headers: { authorization: `Bearer ${TOKEN}` }, menuAccess }
}

describe("requireMenuPermission", () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset()
    vi.mocked(prisma.$executeRaw).mockReset().mockResolvedValue(0 as never)
  })

  it("sem sessao responde 401", async () => {
    const res = resposta()
    const user = await requireMenuPermission({ headers: {} }, res)
    expect(user).toBeNull()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it("libera quem tem a permissao do menu para a acao, seja qual for o cargo", async () => {
    sessaoDe("ESTOQUISTA")
    const res = resposta()
    const user = await requireMenuPermission(pedido({ action: "edit", permission: FULL }), res)
    expect(user?.id).toBe("usr-1")
    expect(res.status).not.toHaveBeenCalled()
  })

  it("nega quem nao tem a acao, mesmo com cargo de gestao", async () => {
    sessaoDe("GESTAO_COMPLETA")
    const res = resposta()
    const user = await requireMenuPermission(pedido({ action: "edit", permission: SO_VER }), res)
    expect(user).toBeNull()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it("rota sem modulo mapeado: nega em vez de liberar pelo cargo", async () => {
    // Era o furo do requireRole: sem menuAccess, a lista de cargos decidia.
    sessaoDe("ESTOQUISTA")
    const res = resposta()
    const user = await requireMenuPermission(pedido(undefined), res)
    expect(user).toBeNull()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it("ADMIN e superusuario por desenho", async () => {
    sessaoDe("ADMIN")
    const res = resposta()
    const user = await requireMenuPermission(pedido(undefined), res)
    expect(user?.role).toBe("ADMIN")
  })
})
