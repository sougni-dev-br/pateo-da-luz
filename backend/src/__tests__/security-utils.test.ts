import { describe, it, expect } from "vitest"
import {
  hashToken,
  hashPassword,
  verifyPassword,
  hashLegacyPassword,
  createToken,
  sessionExpiresAt,
  requestIp,
} from "../modules/security/security-utils.js"

// ─── hashToken ─────────────────────────────────────────────────────────────

describe("hashToken", () => {
  it("returns a 64-char lowercase hex string (SHA-256)", () => {
    expect(hashToken("qualquer-token")).toMatch(/^[a-f0-9]{64}$/)
  })

  it("é determinístico — mesmo input produz mesmo hash", () => {
    expect(hashToken("token-abc")).toBe(hashToken("token-abc"))
  })

  it("produz hashes diferentes para inputs diferentes", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"))
  })
})

// ─── hashPassword / verifyPassword — caminho bcrypt ────────────────────────

describe("hashPassword + verifyPassword (bcrypt)", () => {
  it("verifica senha correta contra hash bcrypt", () => {
    const hash = hashPassword("Senha@123")
    expect(verifyPassword("Senha@123", hash)).toBe(true)
  })

  it("rejeita senha errada contra hash bcrypt", () => {
    const hash = hashPassword("Senha@123")
    expect(verifyPassword("SenhaErrada", hash)).toBe(false)
  })

  it("hash bcrypt começa com $2b$ (identificador bcrypt)", () => {
    expect(hashPassword("Senha@123")).toMatch(/^\$2b\$/)
  })
})

// ─── hashLegacyPassword / verifyPassword — caminho scrypt (legado) ─────────

describe("hashLegacyPassword + verifyPassword (scrypt legado)", () => {
  it("verifica senha correta no formato legado", () => {
    const hash = hashLegacyPassword("Senha@123")
    expect(verifyPassword("Senha@123", hash)).toBe(true)
  })

  it("rejeita senha errada no formato legado", () => {
    const hash = hashLegacyPassword("Senha@123")
    expect(verifyPassword("SenhaErrada", hash)).toBe(false)
  })

  it("formato legado contém salt e hash separados por ':'", () => {
    const hash = hashLegacyPassword("Senha@123")
    const partes = hash.split(":")
    expect(partes).toHaveLength(2)
    expect(partes[0]).toHaveLength(32) // salt hex de 16 bytes
    expect(partes[1]).toHaveLength(128) // hash scrypt hex de 64 bytes
  })

  it("salt customizado produz hash reproduzível", () => {
    const salt = "abcdef0123456789abcdef0123456789"
    const h1 = hashLegacyPassword("Senha@123", salt)
    const h2 = hashLegacyPassword("Senha@123", salt)
    expect(h1).toBe(h2)
  })

  it("salts diferentes produzem hashes diferentes", () => {
    const h1 = hashLegacyPassword("Senha@123", "salt-aaaaaaaaaaaaaaaa")
    const h2 = hashLegacyPassword("Senha@123", "salt-bbbbbbbbbbbbbbbb")
    expect(h1).not.toBe(h2)
  })
})

// ─── createToken ───────────────────────────────────────────────────────────

describe("createToken", () => {
  const user = { id: "usr-001", email: "admin@pateo.local", role: "ADMIN" as const }

  it("retorna um JWT com 3 partes separadas por ponto", () => {
    expect(createToken(user).split(".")).toHaveLength(3)
  })

  it("payload contém sub, email e role corretos", () => {
    const token = createToken(user)
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    )
    expect(payload.sub).toBe("usr-001")
    expect(payload.email).toBe("admin@pateo.local")
    expect(payload.role).toBe("ADMIN")
  })

  it("payload contém issuer e audience corretos", () => {
    const token = createToken(user)
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    )
    expect(payload.iss).toBe("cmv-loja")
    expect(payload.aud).toBe("cmv-loja-web")
  })

  it("tokens para usuários diferentes são diferentes", () => {
    const t1 = createToken({ id: "usr-001", email: "a@pateo.local", role: "ADMIN" })
    const t2 = createToken({ id: "usr-002", email: "b@pateo.local", role: "VISUALIZACAO" })
    expect(t1).not.toBe(t2)
  })
})

// ─── sessionExpiresAt ──────────────────────────────────────────────────────

describe("sessionExpiresAt", () => {
  it("retorna uma data no futuro", () => {
    expect(sessionExpiresAt().getTime()).toBeGreaterThan(Date.now())
  })

  it("expira aproximadamente 12 horas a partir de agora", () => {
    const dozeHoras = 12 * 60 * 60 * 1000
    const margem = 2000 // 2s de tolerância
    const agora = Date.now()
    const exp = sessionExpiresAt().getTime()
    expect(exp).toBeGreaterThanOrEqual(agora + dozeHoras - margem)
    expect(exp).toBeLessThanOrEqual(agora + dozeHoras + margem)
  })
})

// ─── requestIp ─────────────────────────────────────────────────────────────

describe("requestIp", () => {
  it("extrai o primeiro IP do header x-forwarded-for (proxy chain)", () => {
    const req = { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 172.16.0.1" } }
    expect(requestIp(req)).toBe("203.0.113.5")
  })

  it("usa req.ip quando x-forwarded-for está ausente", () => {
    const req = { ip: "192.168.1.100", headers: {} }
    expect(requestIp(req)).toBe("192.168.1.100")
  })

  it("usa socket.remoteAddress como último recurso", () => {
    const req = { socket: { remoteAddress: "10.0.0.42" }, headers: {} }
    expect(requestIp(req)).toBe("10.0.0.42")
  })

  it("retorna string vazia quando nenhuma fonte de IP está disponível", () => {
    const req = { headers: {} }
    expect(requestIp(req)).toBe("")
  })

  it("x-forwarded-for tem prioridade sobre req.ip", () => {
    const req = { ip: "10.0.0.1", headers: { "x-forwarded-for": "203.0.113.99" } }
    expect(requestIp(req)).toBe("203.0.113.99")
  })
})
