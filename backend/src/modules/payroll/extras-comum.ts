// Utilitários compartilhados pelas rotas de Extras (diárias e pagamentos).
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { assertPeriodWritableForRange } from "../cmv-real/cmv-real.service.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { requestIp, type SessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";

export const JUSTIFICATIVA_MINIMA = 3;
export const LIMITE_CURTO = 120;
export const LIMITE_LONGO = 1000;

export function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// Primeiro campo de texto que passa do limite, para a mensagem de erro dizer qual.
export function campoLongoDemais(b: Record<string, unknown>, campos: Array<[string, string, number]>): string | null {
  const achado = campos.find(([chave, , max]) => String(b[chave] ?? "").trim().length > max);
  return achado ? `${achado[1]}: máximo de ${achado[2]} caracteres.` : null;
}

// Violação de índice único (CPF repetido, diária duplicada que passou pela
// checagem por corrida). Vira mensagem em vez de erro 500.
export const violouUnico = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// Hoje no fuso do restaurante: diária de data futura não pode estar "realizada".
export function hojeEmSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function oneOf<T extends readonly string[]>(list: T, v: unknown): T[number] | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : null;
}

// "2026-09-30" → Date do banco (@db.Date), meia-noite UTC.
export function lerData(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 ? d : null;
}
// A trava confere o DIA INTEIRO: o fim do período de CMV é gravado como "30/04
// 00:00", e só a meia-noite em ponto ou o intervalo do dia o alcançam.
const fimDoDia = (d: Date) => new Date(d.getTime() + 86_399_999);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function periodoBloqueado(date: Date, contexto: string, response: Response) {
  try {
    await assertPeriodWritableForRange(date, fimDoDia(date), contexto);
    return false;
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Período fechado." });
    return true;
  }
}

// CPF e PIX de quem vem de fora: quem vê dados de Funcionários ou administra Extras
// (é quem paga). Os demais veem nome e telefone.
export async function podeVerDadosDeFora(request: Request, user: SessionUser) {
  return (await podeVerDadosPessoais(request)) || userHasPermission(user, "extras", "admin");
}

export const auditoria = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
