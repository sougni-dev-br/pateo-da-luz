import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { calcularDreDoMes } from "../dre/dre.routes.js";
import { REVENUE_CHANNEL_SALON } from "../monthly/revenue-channels.js";
import { hojeEmBrasilia } from "../monthly/revenue-coverage.service.js";
import { mesclarFontes, mesesEncerradosAte, montarComparativo, type Comparativo, type MesDoSalao } from "./planejamento-comparativo.js";
import { mesesEncerradosDoAno, montarRealizado, type MesDoDre, type Realizado } from "./planejamento-realizado.js";
import { montarProjecao, type PremissasDoMes, type Projecao } from "./planejamento-projecao.js";

type LinhaDoErp = {
  ano: number;
  mes: number;
  dias: number;
  vendasAlmoco: Prisma.Decimal | null;
  vendasJantar: Prisma.Decimal | null;
  clientesAlmoco: bigint | number | null;
  clientesJantar: bigint | number | null;
  servico: Prisma.Decimal | null;
  semPessoas: number;
};

/**
 * Venda do salão por mês e turno, direto do faturamento diário.
 *
 * O Agile PDV grava a venda do turno COM serviço (vl_total) e o serviço do turno à parte (shift1Service /
 * shift2Service). A planilha de planejamento usa Mesas SEM serviço, então o serviço do turno sai aqui.
 * Linhas vindas de importação de planilha não têm serviço por turno (zero) e já chegam sem serviço.
 */
async function mesesDoErp(anos: readonly number[]): Promise<MesDoSalao[]> {
  const linhas = await prisma.$queryRaw<LinhaDoErp[]>`
    SELECT "competenceYear" AS "ano",
           "competenceMonth" AS "mes",
           COUNT(DISTINCT "date"::date)::int AS "dias",
           SUM("salesFirstShift" - "shift1Service") AS "vendasAlmoco",
           SUM("salesSecondShift" - "shift2Service") AS "vendasJantar",
           SUM(COALESCE("peopleFirstShift", 0)) AS "clientesAlmoco",
           SUM(COALESCE("peopleSecondShift", 0)) AS "clientesJantar",
           SUM("serviceAmount") AS "servico",
           COUNT(*) FILTER (
             WHERE ("peopleFirstShift" IS NULL AND "salesFirstShift" > 0)
                OR ("peopleSecondShift" IS NULL AND "salesSecondShift" > 0)
           )::int AS "semPessoas"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED'
      AND "channel" = ${REVENUE_CHANNEL_SALON}
      AND "competenceYear" IN (${Prisma.join(anos as number[])})
    GROUP BY "competenceYear", "competenceMonth"
  `;
  return linhas.map((l) => ({
    ano: l.ano,
    mes: l.mes,
    vendasAlmoco: Number(l.vendasAlmoco ?? 0),
    vendasJantar: Number(l.vendasJantar ?? 0),
    clientesAlmoco: Number(l.clientesAlmoco ?? 0),
    clientesJantar: Number(l.clientesJantar ?? 0),
    servico: Number(l.servico ?? 0),
    fonte: "ERP" as const,
    diasComVenda: l.dias,
    clientesIncompletos: l.semPessoas > 0
  }));
}

async function mesesDoHistorico(anos: readonly number[]): Promise<MesDoSalao[]> {
  const linhas = await prisma.salaoHistoricoMensal.findMany({ where: { ano: { in: [...anos] } } });
  return linhas.map((l) => ({
    ano: l.ano,
    mes: l.mes,
    vendasAlmoco: Number(l.vendasAlmoco),
    vendasJantar: Number(l.vendasJantar),
    clientesAlmoco: l.clientesAlmoco,
    clientesJantar: l.clientesJantar,
    servico: Number(l.servico),
    fonte: "HISTORICO" as const
  }));
}

/** Salão por mês dos anos pedidos, com o ERP valendo quando cobre o mês e o histórico importado no resto. */
async function carregarMesesDoSalao(anos: readonly number[]): Promise<MesDoSalao[]> {
  const [erp, historico] = await Promise.all([mesesDoErp(anos), mesesDoHistorico(anos)]);
  return mesclarFontes(erp, historico);
}

export async function carregarComparativo(anoBase: number, anoComparado: number): Promise<Comparativo & { hoje: string }> {
  const anos = [...new Set([anoBase, anoComparado])];
  const meses = await carregarMesesDoSalao(anos);
  const hoje = hojeEmBrasilia();
  const comparativo = montarComparativo(meses, anoBase, anoComparado, mesesEncerradosAte(hoje, anos), hoje.slice(0, 7));
  return { ...comparativo, hoje };
}

/** Projeta o cenário sobre o ano-base real. Só o mês corrente do ano-base conta como "em andamento". */
export async function carregarProjecao(anoBase: number, premissas: readonly PremissasDoMes[]): Promise<Projecao> {
  const meses = await carregarMesesDoSalao([anoBase]);
  const hoje = hojeEmBrasilia();
  const emAndamento = new Set<number>();
  if (Number(hoje.slice(0, 4)) === anoBase) emAndamento.add(Number(hoje.slice(5, 7)));
  return montarProjecao(anoBase, meses, premissas, emAndamento);
}

// Um mês por vez: cada mês do DRE já roda várias consultas e o pool do banco é pequeno e compartilhado com o resto do ERP.
const MESES_EM_PARALELO = 1;
// O DRE de um mês encerrado muda pouco, e cada mês roda várias consultas. Guarda a PROMESSA por alguns minutos:
// cliques repetidos e abas abertas juntas dividem a mesma consulta em vez de empilhar no banco.
const VALIDADE_DO_DRE_EM_MS = 5 * 60 * 1000;
const cacheDoDre = new Map<string, { ate: number; dados: Promise<Omit<MesDoDre, "mes">> }>();

function dreDoMesEncerrado(ano: number, mes: number): Promise<Omit<MesDoDre, "mes">> {
  const chave = `${ano}-${mes}`;
  const agora = Date.now();
  const guardado = cacheDoDre.get(chave);
  if (guardado && guardado.ate > agora) return guardado.dados;
  const dados = calcularDreDoMes(ano, mes);
  cacheDoDre.set(chave, { ate: agora + VALIDADE_DO_DRE_EM_MS, dados });
  // Consulta que falhou não fica guardada: a próxima tentativa refaz.
  dados.catch(() => { if (cacheDoDre.get(chave)?.dados === dados) cacheDoDre.delete(chave); });
  return dados;
}

async function calcularRealizado(ano: number, ignorarMesesSemLancamento: boolean): Promise<Realizado> {
  const encerrados = mesesEncerradosDoAno(ano, hojeEmBrasilia());
  const meses: MesDoDre[] = [];
  for (let i = 0; i < encerrados.length; i += MESES_EM_PARALELO) {
    const bloco = encerrados.slice(i, i + MESES_EM_PARALELO);
    meses.push(...(await Promise.all(bloco.map(async (mes) => ({ mes, ...(await dreDoMesEncerrado(ano, mes)) })))));
  }
  return montarRealizado(ano, meses, encerrados, ignorarMesesSemLancamento);
}

// Bloqueio de módulo: uma apuração por vez no processo (as demais esperam a fila), e o mesmo pedido em curso é
// reaproveitado em vez de repetido.
let filaDoRealizado: Promise<unknown> = Promise.resolve();
const realizadoEmCurso = new Map<string, Promise<Realizado>>();

/** Gastos realizados do ano por grupo, a partir do DRE (só meses encerrados). Serializado: cada mês do DRE roda várias consultas. */
export function carregarRealizado(ano: number, ignorarMesesSemLancamento: boolean): Promise<Realizado> {
  const chave = `${ano}:${ignorarMesesSemLancamento}`;
  const emCurso = realizadoEmCurso.get(chave);
  if (emCurso) return emCurso;
  const execucao = filaDoRealizado.then(() => calcularRealizado(ano, ignorarMesesSemLancamento));
  filaDoRealizado = execucao.catch(() => undefined);
  realizadoEmCurso.set(chave, execucao);
  const liberar = () => { if (realizadoEmCurso.get(chave) === execucao) realizadoEmCurso.delete(chave); };
  execucao.then(liberar, liberar);
  return execucao;
}
