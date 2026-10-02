// Link e acesso da ficha cadastral. O código do link é o único segredo de quem preenche:
// 32 bytes aleatórios, e o banco só guarda o SHA-256 dele (vazamento do banco não abre
// fichas). Depois de confirmar a data de nascimento (ou o CPF), a pessoa recebe uma chave
// de acesso curta, assinada, que vale só para aquela ficha.
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

export const VALIDADE_LINK_DIAS = 7;
export const MAX_TENTATIVAS = 5;
export const BLOQUEIO_MINUTOS = 30;
const BLOQUEIO_MAXIMO_MS = 7 * 24 * 60 * 60 * 1000;
const VALIDADE_ACESSO = "2h";
const AUDIENCIA = "ficha-cadastral";

export function gerarCodigo(): { codigo: string; hash: string } {
  const codigo = crypto.randomBytes(32).toString("base64url");
  return { codigo, hash: hashCodigo(codigo) };
}

export function hashCodigo(codigo: string): string {
  return crypto.createHash("sha256").update(codigo).digest("hex");
}

/** Formato do código gerado acima: barra lixo antes de ir ao banco. */
export function codigoBemFormado(codigo: unknown): codigo is string {
  return typeof codigo === "string" && /^[A-Za-z0-9_-]{43}$/.test(codigo);
}

export function expiracaoNova(agora = new Date()): Date {
  return new Date(agora.getTime() + VALIDADE_LINK_DIAS * 24 * 60 * 60 * 1000);
}

// Chave própria, derivada do segredo da sessão: a chave de acesso da ficha nunca é aceita
// como sessão do sistema, nem o contrário.
function segredo(): string {
  const base = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!base || base.trim().length < 16) throw new Error("JWT_SECRET deve ser configurado com pelo menos 16 caracteres.");
  return crypto.createHmac("sha256", base).update(AUDIENCIA).digest("hex");
}

// A chave vale para a ficha E para o link atual: "Gerar novo link" (link vazado) derruba
// também quem já tinha confirmado a data pelo link antigo.
const doLink = (tokenHash: string) => tokenHash.slice(0, 16);

export function emitirAcesso(fichaId: string, tokenHash: string): string {
  return jwt.sign({ f: fichaId, h: doLink(tokenHash) }, segredo(), { audience: AUDIENCIA, expiresIn: VALIDADE_ACESSO });
}

export function acessoValido(chave: unknown, fichaId: string, tokenHash: string): boolean {
  if (typeof chave !== "string" || chave.length > 500) return false;
  try {
    const p = jwt.verify(chave, segredo(), { audience: AUDIENCIA }) as { f?: unknown; h?: unknown };
    return p.f === fichaId && p.h === doLink(tokenHash);
  } catch {
    return false;
  }
}

/**
 * Bloqueio progressivo pela contagem acumulada de erros (zerada só ao acertar): a cada 5 erros
 * bloqueia, e cada bloqueio dura o dobro do anterior (30 min, 1 h, 2 h…, no máximo 7 dias).
 * Sem isso, 5 chutes a cada 30 min durante os 7 dias do link somavam ~1.600 datas tentadas.
 */
export function bloqueioApos(errosAcumulados: number, agora = Date.now()): Date | null {
  if (errosAcumulados <= 0 || errosAcumulados % MAX_TENTATIVAS !== 0) return null;
  const vez = errosAcumulados / MAX_TENTATIVAS;
  return new Date(agora + Math.min(BLOQUEIO_MINUTOS * 60 * 1000 * 2 ** (vez - 1), BLOQUEIO_MAXIMO_MS));
}

/** Compara a resposta da verificação sem vazar tempo. */
export function respostaConfere(resposta: unknown, esperado: string, metodo: "NASCIMENTO" | "CPF"): boolean {
  const r = metodo === "CPF" ? String(resposta ?? "").replace(/\D/g, "") : String(resposta ?? "").trim();
  const a = crypto.createHash("sha256").update(r).digest();
  const b = crypto.createHash("sha256").update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}
