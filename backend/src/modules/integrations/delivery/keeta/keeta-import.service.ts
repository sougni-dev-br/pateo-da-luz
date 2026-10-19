import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../../../config/database.js";
import { assertPeriodWritableForDate } from "../../../cmv-real/cmv-real.service.js";
import { isPeriodLockedError } from "../../../cmv-real/period-locked-error.js";
import { auditLog } from "../../../security/security-utils.js";
import { ErroDeImportacao } from "./erro-de-importacao.js";
import { KEETA_SOURCE_PLATFORM } from "./keeta.service.js";
import {
  lerTabelaKeeta,
  parseCsvKeeta,
  planejarImportacao,
  type DiaExistente,
  type DiaKeeta,
  type ItemDoPlano
} from "./keeta-import.js";
import { verificarTamanhoDoZip } from "./zip-seguro.js";

const AUDIT_ACTION = "REVENUE_IMPORT_KEETA";
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
const NOME_MAXIMO_NA_AUDITORIA = 200;
const TIMEOUT_DA_GRAVACAO_MS = 60_000;
/** Serializa importações da Keeta: duas confirmações simultâneas não se atropelam. */
const CHAVE_DO_LOCK = "keeta-import";

type Banco = Prisma.TransactionClient | typeof prisma;

export type PrevisaoKeeta = {
  arquivo: string;
  erros: string[];
  /** Dias aceitos que merecem um olhar (ex.: repasse acima do bruto). Não bloqueiam a gravação. */
  avisos: string[];
  plano: ItemDoPlano[];
  /** Meses com fechamento travado: os dias deles não serão gravados. */
  mesesTravados: string[];
  totais: { criar: number; alterar: number; igual: number; conflito: number; travado: number };
};

export type ResultadoKeeta = PrevisaoKeeta & { gravados: number };

function valorDaCelula(valor: unknown): unknown {
  if (valor && typeof valor === "object" && !(valor instanceof Date)) {
    const r = valor as Record<string, unknown>;
    if (r.result !== undefined && r.result !== null) return valorDaCelula(r.result);
    if (r.text !== undefined && r.text !== null) return valorDaCelula(r.text);
    if (Array.isArray(r.richText)) return r.richText.map((p) => String((p as Record<string, unknown>).text ?? "")).join("");
  }
  return valor;
}

async function lerArquivo(buffer: Buffer, nome: string): Promise<unknown[][]> {
  if (buffer.length > TAMANHO_MAXIMO_BYTES) throw new ErroDeImportacao("Arquivo maior que 5 MB.");
  if (/\.csv$/i.test(nome)) return parseCsvKeeta(buffer.toString("utf8"));
  if (!/\.xlsx$/i.test(nome)) throw new ErroDeImportacao("Use um arquivo .xlsx ou .csv exportado do portal da Keeta.");
  // Antes de abrir no exceljs: um zip pequeno pode declarar gigabytes descomprimidos.
  verificarTamanhoDoZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ErroDeImportacao("O arquivo não é um .xlsx válido.");
  }
  const planilha = workbook.worksheets[0];
  if (!planilha) throw new ErroDeImportacao("A planilha está vazia.");
  const linhas: unknown[][] = [];
  planilha.eachRow({ includeEmpty: false }, (row) => {
    linhas.push((row.values as unknown[]).slice(1).map(valorDaCelula));
  });
  return linhas;
}

const dataUtc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

async function lerExistentes(db: Banco, dias: DiaKeeta[]): Promise<DiaExistente[]> {
  if (dias.length === 0) return [];
  const datas = dias.map((d) => d.date).sort();
  const linhas = await db.revenueEntry.findMany({
    where: {
      sourcePlatform: KEETA_SOURCE_PLATFORM,
      status: "ACTIVE",
      date: { gte: dataUtc(datas[0]!), lte: dataUtc(datas[datas.length - 1]!) }
    },
    select: { id: true, date: true, tickets: true, grossAmount: true, netAmount: true }
  });
  return linhas.map((l) => ({
    id: l.id,
    date: l.date.toISOString().slice(0, 10),
    orders: l.tickets,
    grossAmount: Number(l.grossAmount),
    netAmount: Number(l.netAmount)
  }));
}

/** Quais dos meses do arquivo estão com o fechamento travado — a gravação neles é recusada. */
async function mesesTravadosDe(dias: DiaKeeta[]): Promise<Set<string>> {
  const travados = new Set<string>();
  const verificados = new Set<string>();
  for (const dia of dias) {
    const mes = dia.date.slice(0, 7);
    if (verificados.has(mes)) continue;
    verificados.add(mes);
    try {
      await assertPeriodWritableForDate(dataUtc(dia.date), "Importação da Keeta");
    } catch (error) {
      if (!isPeriodLockedError(error)) throw error;
      travados.add(mes);
    }
  }
  return travados;
}

async function montarPrevisao(db: Banco, nome: string, dias: DiaKeeta[], erros: string[], avisos: string[]): Promise<PrevisaoKeeta> {
  const plano = planejarImportacao(dias, await lerExistentes(db, dias));
  const travados = await mesesTravadosDe(dias);
  const totais = { criar: 0, alterar: 0, igual: 0, conflito: 0, travado: 0 };
  for (const item of plano) {
    if (travados.has(item.dia.date.slice(0, 7)) && item.acao !== "IGUAL") totais.travado += 1;
    else if (item.acao === "CRIAR") totais.criar += 1;
    else if (item.acao === "ALTERAR") totais.alterar += 1;
    else if (item.acao === "IGUAL") totais.igual += 1;
    else totais.conflito += 1;
  }
  return { arquivo: nome, erros, avisos, plano, mesesTravados: [...travados].sort(), totais };
}

export async function preverImportacaoKeeta(buffer: Buffer, nome: string): Promise<PrevisaoKeeta> {
  const { dias, erros, avisos } = lerTabelaKeeta(await lerArquivo(buffer, nome));
  return montarPrevisao(prisma, nome, dias, erros, avisos);
}

export async function confirmarImportacaoKeeta(
  buffer: Buffer,
  nome: string,
  contexto: { userId: string | null; ipAddress?: string | null; userAgent?: string | null }
): Promise<ResultadoKeeta> {
  const { dias, erros, avisos } = lerTabelaKeeta(await lerArquivo(buffer, nome));
  if (erros.length > 0) throw new ErroDeImportacao("O arquivo tem linhas com erro. Corrija e envie de novo.");

  const anteriores: Array<{ id: string; gross: number; net: number; orders: number }> = [];

  const { previsao, gravados } = await prisma.$transaction(
    async (tx) => {
      // O que a tela mostrou na prévia não é confiável: com o lock tomado, o plano é refeito
      // contra o estado atual (lançamento cancelado, mês travado ou criado à mão desde então).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAVE_DO_LOCK}))`;
      const atual = await montarPrevisao(tx, nome, dias, erros, avisos);
      const travados = new Set(atual.mesesTravados);
      const gravar = atual.plano.filter(
        (i) => (i.acao === "CRIAR" || i.acao === "ALTERAR") && !travados.has(i.dia.date.slice(0, 7))
      );

      let feitos = 0;
      for (const item of gravar) {
        const { dia } = item;
        const data = dataUtc(dia.date);
        const valores = {
          grossAmount: dia.grossAmount,
          discounts: 0,
          platformFees: dia.platformFees,
          netAmount: dia.netAmount,
          tickets: dia.orders
        };
        if (item.acao === "ALTERAR" && item.existenteId) {
          const antes = await tx.revenueEntry.findUnique({
            where: { id: item.existenteId },
            select: { grossAmount: true, netAmount: true, tickets: true }
          });
          // Só atualiza lançamento que continua ATIVO: nunca ressuscita um cancelado.
          const { count } = await tx.revenueEntry.updateMany({
            where: { id: item.existenteId, status: "ACTIVE" },
            data: valores
          });
          if (count === 0) continue;
          if (antes) {
            anteriores.push({ id: item.existenteId, gross: Number(antes.grossAmount), net: Number(antes.netAmount), orders: antes.tickets });
          }
        } else {
          const id = `keeta-import-${dia.date.replace(/-/g, "")}`;
          await tx.revenueEntry.upsert({
            where: { id },
            create: {
              id,
              date: data,
              competenceYear: data.getUTCFullYear(),
              competenceMonth: data.getUTCMonth() + 1,
              channel: "Delivery",
              sourcePlatform: KEETA_SOURCE_PLATFORM,
              description: "Delivery Keeta — importado do portal",
              ...valores,
              status: "ACTIVE"
            },
            update: { ...valores, status: "ACTIVE" }
          });
        }
        feitos += 1;
      }
      return { previsao: atual, gravados: feitos };
    },
    { timeout: TIMEOUT_DA_GRAVACAO_MS }
  );

  await auditLog({
    userId: contexto.userId,
    action: AUDIT_ACTION,
    entity: "RevenueEntry",
    entityId: null,
    previousValue: { arquivo: nome.slice(0, NOME_MAXIMO_NA_AUDITORIA), anteriores },
    newValue: { gravados, totais: previsao.totais, mesesTravados: previsao.mesesTravados },
    ipAddress: contexto.ipAddress ?? null,
    userAgent: contexto.userAgent ?? null
  });

  return { ...previsao, gravados };
}
