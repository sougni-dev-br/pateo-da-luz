/**
 * Gastos e lucro do cenário (Planejamento > Cenários, Fase 3a). Continua a aba "2027" da planilha do Marcos:
 * depois da margem bruta vêm os gastos por tipo, e o que sobra é o lucro líquido.
 *
 *   gasto FIXO        = valor do mês (R$)
 *   gasto PERCENTUAL  = vendas projetadas do mês × percentual (fração)
 *   serviço           = vendas × % de serviço; abate da folha (a folha informada é a total, com o serviço dentro)
 *   lucro líquido     = margem bruta − (gastos − abatimento do serviço)
 *   ponto de equilíbrio = vendas em que o lucro zera, a partir do CMV e dos percentuais do mês
 *
 * Mês sem projeção (sem base) não tem gasto nem lucro. Sem % de CMV não há margem, logo não há lucro.
 */

import type { Projecao } from "./planejamento-projecao.js";

export const GRUPOS_DE_GASTO = ["OCUPACAO", "TARIFAS_PUBLICAS", "FOLHA", "TRIBUTOS", "DIVIDA", "CONTRATOS", "SEGUROS", "TARIFAS_BANCARIAS", "OUTROS"] as const;
export type GrupoDeGasto = (typeof GRUPOS_DE_GASTO)[number];
export type ModoDoGasto = "FIXO" | "PERCENTUAL";

export const ROTULO_DO_GRUPO: Record<GrupoDeGasto, string> = {
  OCUPACAO: "Ocupação",
  TARIFAS_PUBLICAS: "Tarifas públicas",
  FOLHA: "Folha de pagamento",
  TRIBUTOS: "Tributos",
  DIVIDA: "Dívida",
  CONTRATOS: "Contratos recorrentes",
  SEGUROS: "Seguros",
  TARIFAS_BANCARIAS: "Tarifas bancárias",
  OUTROS: "Outros"
};

export type LinhaDeGasto = {
  grupo: GrupoDeGasto;
  nome: string;
  modo: ModoDoGasto;
  /** 12 valores (jan a dez): R$ no modo FIXO, fração das vendas (0,05 = 5%) no PERCENTUAL. */
  valores: number[];
};

export type MesDeResultado = {
  mes: number;
  gastosPorGrupo: Partial<Record<GrupoDeGasto, number>>;
  /** Parte da folha paga pelo serviço dos garçons: abate dos gastos. */
  abatimentoDoServico: number;
  gastosTotal: number;
  lucro: number | null;
  equilibrioVendas: number | null;
  equilibrioClientes: number | null;
};

export type Resultado = {
  meses: (MesDeResultado | null)[];
  total: {
    gastosPorGrupo: Partial<Record<GrupoDeGasto, number>>;
    abatimentoDoServico: number;
    gastosTotal: number;
    /** Só quando todos os meses somados têm CMV; senão misturaria meses com e sem custo. */
    lucro: number | null;
  };
};

/** Uma linha por grupo, zeradas: ponto de partida de um cenário novo. Tributos já nasce como % das vendas. */
export function linhasPadrao(): LinhaDeGasto[] {
  const zeros = () => Array.from({ length: 12 }, () => 0);
  return GRUPOS_DE_GASTO.map((grupo) => ({
    grupo,
    nome: ROTULO_DO_GRUPO[grupo],
    modo: grupo === "TRIBUTOS" ? ("PERCENTUAL" as const) : ("FIXO" as const),
    valores: zeros()
  }));
}

const arredondar = (n: number, casas = 2): number => {
  const f = 10 ** casas;
  return Math.round((n + Number.EPSILON) * f) / f;
};

function somarPorGrupo(destino: Partial<Record<GrupoDeGasto, number>>, grupo: GrupoDeGasto, valor: number) {
  destino[grupo] = (destino[grupo] ?? 0) + valor;
}

const arredondarGrupos = (g: Partial<Record<GrupoDeGasto, number>>): Partial<Record<GrupoDeGasto, number>> =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, arredondar(v as number)]));

type DadosDoEquilibrio = { cmv: number; fixos: number; percentuais: number; folhaFixa: number; folhaPercentual: number; servico: number };

/**
 * Vendas em que o lucro zera. O serviço abate da folha só até o teto da folha (fixa + % das vendas), então a conta
 * tem dois trechos: abaixo do teto o abatimento é servico × V; acima dele, a folha inteira já foi abatida.
 */
function pontoDeEquilibrio(d: DadosDoEquilibrio): number | null {
  const semAbatimento = 1 - d.cmv - d.percentuais;
  const abateAteOTeto = d.servico > 0 && (d.folhaFixa > 0 || d.folhaPercentual > 0);
  if (!abateAteOTeto) return semAbatimento > 0 ? d.fixos / semAbatimento : null;

  // Trecho A: abatimento = servico × V (vale enquanto servico × V ≤ folhaFixa + folhaPercentual × V).
  const denominadorA = semAbatimento + d.servico;
  const vendasA = denominadorA > 0 ? d.fixos / denominadorA : null;
  const folgaDoTeto = d.servico - d.folhaPercentual;
  if (vendasA !== null && (folgaDoTeto <= 0 || vendasA * folgaDoTeto <= d.folhaFixa)) return vendasA;

  // Trecho B: a folha já foi toda abatida (abatimento = folhaFixa + folhaPercentual × V).
  const denominadorB = semAbatimento + d.folhaPercentual;
  return denominadorB > 0 ? (d.fixos - d.folhaFixa) / denominadorB : null;
}

export function montarResultado(projecao: Projecao, linhas: readonly LinhaDeGasto[], servicoPercentual: number | null): Resultado {
  const meses: (MesDeResultado | null)[] = [];
  const totalPorGrupo: Partial<Record<GrupoDeGasto, number>> = {};
  let abatimentoTotal = 0;
  let gastosTotal = 0;
  let lucroTotal = 0;
  let todosComLucro = true;
  let somou = false;

  for (const m of projecao.meses) {
    const vendas = m.projetado?.vendas.total;
    const ticket = m.projetado?.ticket.total;
    if (!m.projetado || vendas === undefined || ticket === undefined) {
      meses.push(null);
      continue;
    }

    const porGrupo: Partial<Record<GrupoDeGasto, number>> = {};
    let fixos = 0;
    let percentuais = 0;
    let folhaBruta = 0;
    let folhaFixa = 0;
    let folhaPercentual = 0;
    for (const linha of linhas) {
      const valor = linha.valores[m.mes - 1] ?? 0;
      const emReais = linha.modo === "FIXO" ? valor : vendas * valor;
      somarPorGrupo(porGrupo, linha.grupo, emReais);
      if (linha.modo === "FIXO") fixos += valor;
      else percentuais += valor;
      if (linha.grupo === "FOLHA") {
        folhaBruta += emReais;
        if (linha.modo === "FIXO") folhaFixa += valor;
        else folhaPercentual += valor;
      }
    }

    const servico = servicoPercentual === null ? 0 : vendas * servicoPercentual;
    const abatimento = folhaBruta > 0 ? Math.min(servico, folhaBruta) : 0;
    const gastos = Object.values(porGrupo).reduce((s, v) => s + v, 0) - abatimento;
    const lucro = m.margemBruta === null ? null : m.margemBruta - gastos;

    const equilibrio = m.cmvPercentual === null ? null : pontoDeEquilibrio({ cmv: m.cmvPercentual, fixos, percentuais, folhaFixa, folhaPercentual, servico: servicoPercentual ?? 0 });

    meses.push({
      mes: m.mes,
      gastosPorGrupo: arredondarGrupos(porGrupo),
      abatimentoDoServico: arredondar(abatimento),
      gastosTotal: arredondar(gastos),
      lucro: lucro === null ? null : arredondar(lucro),
      equilibrioVendas: equilibrio === null ? null : arredondar(equilibrio),
      equilibrioClientes: equilibrio === null || ticket <= 0 ? null : Math.round(equilibrio / ticket)
    });

    somou = true;
    for (const [g, v] of Object.entries(porGrupo)) somarPorGrupo(totalPorGrupo, g as GrupoDeGasto, v);
    abatimentoTotal += abatimento;
    gastosTotal += gastos;
    if (lucro === null) todosComLucro = false;
    else lucroTotal += lucro;
  }

  return {
    meses,
    total: {
      gastosPorGrupo: arredondarGrupos(totalPorGrupo),
      abatimentoDoServico: arredondar(abatimentoTotal),
      gastosTotal: arredondar(gastosTotal),
      lucro: somou && todosComLucro ? arredondar(lucroTotal) : null
    }
  };
}
