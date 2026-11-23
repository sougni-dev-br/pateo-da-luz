/**
 * Cenário de projeção do Salão (Planejamento > Cenários). É a aba "2027" da planilha do Marcos:
 * parte de um ano-base real e aplica, mês a mês, crescimento de clientes e de ticket médio por turno.
 *
 *   clientes projetados = clientes do ano-base × (1 + crescimento de clientes do turno)
 *   ticket projetado    = ticket do ano-base   × (1 + crescimento do ticket do turno)
 *   vendas projetadas   = clientes projetados × ticket projetado          (por turno; total = soma)
 *   CMV                 = vendas totais × % de CMV do mês
 *
 * Só um mês encerrado, com clientes completos nos dois turnos, serve de base: projetar em cima de mês parcial
 * ou sem clientes registrados daria venda falsa. Esses meses ficam sem projeção, com o motivo.
 * Percentuais trafegam como fração (0,05 = 5%).
 */

import type { MesDoSalao } from "./planejamento-comparativo.js";

export type PremissasDoMes = {
  mes: number;
  clientesAlmoco: number;
  clientesJantar: number;
  ticketAlmoco: number;
  ticketJantar: number;
  /** % de CMV sobre as vendas do mês; null = ainda não definido (sem margem calculada). */
  cmv: number | null;
};

export type MotivoSemBase = "SEM_DADO" | "EM_ANDAMENTO" | "CLIENTES_INCOMPLETOS" | "TURNO_SEM_CLIENTES";

export type Turnos = { almoco: number; jantar: number; total: number };

export type MesProjetado = {
  mes: number;
  motivoSemBase: MotivoSemBase | null;
  base: { clientes: Turnos; ticket: Turnos; vendas: Turnos } | null;
  projetado: { clientes: Turnos; ticket: Turnos; vendas: Turnos } | null;
  cmvPercentual: number | null;
  cmvValor: number | null;
  margemBruta: number | null;
};

export type TotalDaProjecao = {
  /** Meses que entram na soma (os que têm base). */
  meses: number[];
  base: { clientes: Turnos; vendas: Turnos; ticket: Turnos };
  projetado: { clientes: Turnos; vendas: Turnos; ticket: Turnos };
  variacaoVendas: number | null;
  variacaoClientes: number | null;
  variacaoTicket: number | null;
  cmvValor: number | null;
  /** CMV ÷ vendas, só dos meses com % definido. */
  cmvPercentual: number | null;
  margemBruta: number | null;
};

export type Projecao = { anoBase: number; meses: MesProjetado[]; total: TotalDaProjecao };

export const CRESCIMENTO_MINIMO = -0.9;
export const CRESCIMENTO_MAXIMO = 5;

const arredondar = (n: number, casas = 2): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const zero = (): Turnos => ({ almoco: 0, jantar: 0, total: 0 });

function razao(vendas: number, clientes: number): number {
  return clientes > 0 ? vendas / clientes : 0;
}

function variacao(atual: number, anterior: number): number | null {
  return anterior > 0 ? arredondar(atual / anterior - 1, 6) : null;
}

/** Premissas neutras (tudo em 0%) para os 12 meses: ponto de partida de um cenário novo. */
export function premissasNeutras(): PremissasDoMes[] {
  return Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, clientesAlmoco: 0, clientesJantar: 0, ticketAlmoco: 0, ticketJantar: 0, cmv: null }));
}

function motivoDeNaoServir(base: MesDoSalao | undefined, emAndamento: boolean): MotivoSemBase | null {
  if (!base) return "SEM_DADO";
  if (emAndamento) return "EM_ANDAMENTO";
  if (base.clientesIncompletos) return "CLIENTES_INCOMPLETOS";
  if (base.clientesAlmoco <= 0 || base.clientesJantar <= 0) return "TURNO_SEM_CLIENTES";
  return null;
}

function projetarMes(base: MesDoSalao, p: PremissasDoMes) {
  const clientesBase: Turnos = { almoco: base.clientesAlmoco, jantar: base.clientesJantar, total: base.clientesAlmoco + base.clientesJantar };
  const vendasBase: Turnos = { almoco: base.vendasAlmoco, jantar: base.vendasJantar, total: base.vendasAlmoco + base.vendasJantar };
  const ticketBase: Turnos = {
    almoco: razao(vendasBase.almoco, clientesBase.almoco),
    jantar: razao(vendasBase.jantar, clientesBase.jantar),
    total: razao(vendasBase.total, clientesBase.total)
  };

  const clientesAlmoco = clientesBase.almoco * (1 + p.clientesAlmoco);
  const clientesJantar = clientesBase.jantar * (1 + p.clientesJantar);
  const ticketAlmoco = ticketBase.almoco * (1 + p.ticketAlmoco);
  const ticketJantar = ticketBase.jantar * (1 + p.ticketJantar);
  const vendasAlmoco = clientesAlmoco * ticketAlmoco;
  const vendasJantar = clientesJantar * ticketJantar;
  const clientes: Turnos = { almoco: clientesAlmoco, jantar: clientesJantar, total: clientesAlmoco + clientesJantar };
  const vendas: Turnos = { almoco: vendasAlmoco, jantar: vendasJantar, total: vendasAlmoco + vendasJantar };
  const ticket: Turnos = { almoco: ticketAlmoco, jantar: ticketJantar, total: razao(vendas.total, clientes.total) };
  return { clientesBase, vendasBase, ticketBase, clientes, vendas, ticket };
}

const arredondarTurnos = (t: Turnos, casas = 2): Turnos => ({ almoco: arredondar(t.almoco, casas), jantar: arredondar(t.jantar, casas), total: arredondar(t.total, casas) });

function somarTurnos(a: Turnos, b: Turnos): Turnos {
  return { almoco: a.almoco + b.almoco, jantar: a.jantar + b.jantar, total: a.total + b.total };
}

/**
 * `mesesBase`: o ano-base já mesclado (ERP/histórico). `mesesEmAndamento`: meses do ano-base que ainda não
 * fecharam (o corrente); passam por aqui em vez de serem deduzidos, para o módulo seguir puro.
 */
export function montarProjecao(
  anoBase: number,
  mesesBase: readonly MesDoSalao[],
  premissas: readonly PremissasDoMes[],
  mesesEmAndamento: ReadonlySet<number>
): Projecao {
  const base = new Map(mesesBase.filter((m) => m.ano === anoBase).map((m) => [m.mes, m]));
  const porMes = new Map(premissas.map((p) => [p.mes, p]));

  const meses: MesProjetado[] = [];
  let somaBase = { clientes: zero(), vendas: zero() };
  let somaProj = { clientes: zero(), vendas: zero() };
  let cmvTotal = 0;
  let vendasComCmv = 0;
  const mesesSomados: number[] = [];

  for (let mes = 1; mes <= 12; mes += 1) {
    const dadoBase = base.get(mes);
    const motivo = motivoDeNaoServir(dadoBase, mesesEmAndamento.has(mes));
    const p = porMes.get(mes) ?? { mes, clientesAlmoco: 0, clientesJantar: 0, ticketAlmoco: 0, ticketJantar: 0, cmv: null };
    if (motivo || !dadoBase) {
      meses.push({ mes, motivoSemBase: motivo ?? "SEM_DADO", base: null, projetado: null, cmvPercentual: p.cmv, cmvValor: null, margemBruta: null });
      continue;
    }

    const r = projetarMes(dadoBase, p);
    const cmvValor = p.cmv === null ? null : r.vendas.total * p.cmv;
    meses.push({
      mes,
      motivoSemBase: null,
      base: { clientes: arredondarTurnos(r.clientesBase, 0), ticket: arredondarTurnos(r.ticketBase), vendas: arredondarTurnos(r.vendasBase) },
      projetado: { clientes: arredondarTurnos(r.clientes, 1), ticket: arredondarTurnos(r.ticket), vendas: arredondarTurnos(r.vendas) },
      cmvPercentual: p.cmv,
      cmvValor: cmvValor === null ? null : arredondar(cmvValor),
      margemBruta: cmvValor === null ? null : arredondar(r.vendas.total - cmvValor)
    });

    mesesSomados.push(mes);
    somaBase = { clientes: somarTurnos(somaBase.clientes, r.clientesBase), vendas: somarTurnos(somaBase.vendas, r.vendasBase) };
    somaProj = { clientes: somarTurnos(somaProj.clientes, r.clientes), vendas: somarTurnos(somaProj.vendas, r.vendas) };
    if (cmvValor !== null) {
      cmvTotal += cmvValor;
      vendasComCmv += r.vendas.total;
    }
  }

  const ticketDe = (v: Turnos, c: Turnos): Turnos => ({ almoco: razao(v.almoco, c.almoco), jantar: razao(v.jantar, c.jantar), total: razao(v.total, c.total) });
  const ticketBase = ticketDe(somaBase.vendas, somaBase.clientes);
  const ticketProj = ticketDe(somaProj.vendas, somaProj.clientes);
  const temCmv = vendasComCmv > 0;
  const todosComCmv = temCmv && mesesSomados.every((m) => meses[m - 1].cmvValor !== null);

  return {
    anoBase,
    meses,
    total: {
      meses: mesesSomados,
      base: { clientes: arredondarTurnos(somaBase.clientes, 0), vendas: arredondarTurnos(somaBase.vendas), ticket: arredondarTurnos(ticketBase) },
      projetado: { clientes: arredondarTurnos(somaProj.clientes, 0), vendas: arredondarTurnos(somaProj.vendas), ticket: arredondarTurnos(ticketProj) },
      variacaoVendas: variacao(somaProj.vendas.total, somaBase.vendas.total),
      variacaoClientes: variacao(somaProj.clientes.total, somaBase.clientes.total),
      variacaoTicket: variacao(ticketProj.total, ticketBase.total),
      cmvValor: temCmv ? arredondar(cmvTotal) : null,
      cmvPercentual: temCmv ? arredondar(cmvTotal / vendasComCmv, 4) : null,
      // Margem do ano só quando todos os meses somados têm CMV: senão misturaria meses com e sem custo.
      margemBruta: todosComCmv ? arredondar(somaProj.vendas.total - cmvTotal) : null
    }
  };
}
