// Histórico do cadastro de funcionários — gravação e consulta no banco.
// Regras (vigente num dia, o que mudou, "vale a partir de") em cadastro-historico.ts.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  type Alteracao, type CampoHistorico, type LinhaHistorico, alteracoes, cadastroVigenteEm, valorVigenteEm, serializar,
} from "./cadastro-historico.js";

type Db = Prisma.TransactionClient | typeof prisma;

export type Origem = "CADASTRO" | "EQUIPE_GORJETA" | "CONFERENCIA_GORJETA" | "IMPORTADOR_PLANILHA" | "BACKFILL";

// Grava uma linha por campo que mudou. Chamar na MESMA transação que altera o cadastro:
// cadastro alterado sem histórico faria um mês passado ser recalculado com o valor novo.
export async function registrarAlteracoes(db: Db, opts: {
  employeeId: string;
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
  vigenteDesde: Date;
  motivo: string | null;
  origem: Origem;
  usuario: { id: string | null; nome: string | null };
}): Promise<Alteracao[]> {
  const lista = alteracoes(opts.antes, opts.depois);
  if (lista.length === 0) return lista;
  await db.employeeHistorico.createMany({
    data: lista.map((a) => ({
      id: crypto.randomUUID(),
      employeeId: opts.employeeId,
      campo: a.campo,
      valorAnterior: a.valorAnterior,
      valorNovo: a.valorNovo,
      vigenteDesde: opts.vigenteDesde,
      motivo: opts.motivo?.slice(0, 300) ?? null,
      origem: opts.origem,
      criadoPorId: opts.usuario.id,
      criadoPorNome: opts.usuario.nome,
    })),
  });
  return lista;
}

// Linhas de vários funcionários de uma vez (uma consulta), agrupadas por funcionário.
export async function carregarHistorico(employeeIds: string[], db: Db = prisma): Promise<Map<string, LinhaHistorico[]>> {
  const ids = [...new Set(employeeIds)];
  const porFuncionario = new Map<string, LinhaHistorico[]>();
  if (ids.length === 0) return porFuncionario;
  const linhas = await db.employeeHistorico.findMany({
    where: { employeeId: { in: ids } },
    select: { employeeId: true, campo: true, valorAnterior: true, valorNovo: true, vigenteDesde: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }],
  });
  for (const l of linhas) {
    const lista = porFuncionario.get(l.employeeId) ?? [];
    lista.push(l);
    porFuncionario.set(l.employeeId, lista);
  }
  return porFuncionario;
}

// Os campos rastreados de cada funcionário como estavam no dia de referência dele.
// `atual` traz o cadastro de hoje; quem não tem histórico fica como está.
export async function cadastrosVigentes<T extends { id: string } & Partial<Record<CampoHistorico, unknown>>>(
  atuais: T[], dataDe: (e: T) => Date, db: Db = prisma,
): Promise<Map<string, T>> {
  const historico = await carregarHistorico(atuais.map((e) => e.id), db);
  return new Map(atuais.map((e) => [e.id, cadastroVigenteEm(e, historico.get(e.id) ?? [], dataDe(e))]));
}

// Um campo de um funcionário num dia (texto, como no histórico). null = vazio.
export async function valorVigente(employeeId: string, campo: CampoHistorico, data: Date, db: Db = prisma): Promise<string | null> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { [campo]: true } as Prisma.EmployeeSelect });
  const atual = serializar(campo, (emp as Record<string, unknown> | null)?.[campo]);
  const linhas = (await carregarHistorico([employeeId], db)).get(employeeId) ?? [];
  return valorVigenteEm(linhas.filter((l) => l.campo === campo), atual, data);
}

// Sem registro naquele dia? (vínculo vigente, com o atual já em mãos: uma consulta só)
export async function semRegistroEm(employeeId: string, modalityAtual: string, data: Date, db: Db = prisma): Promise<boolean> {
  const linhas = ((await carregarHistorico([employeeId], db)).get(employeeId) ?? []).filter((l) => l.campo === "modality");
  return valorVigenteEm(linhas, modalityAtual, data) === "NAO_CLT";
}
