// Regras puras das metas de CMV %: sem banco, para poder testar sem mock.
// O "realizado" aqui é compras ÷ faturamento do mês (proxy do CMV enquanto a contagem não fecha).

export type StatusMeta = "VERDE" | "AMARELO" | "VERMELHO" | "SEM_DADOS";

export type MetaVigencia = {
  id: string;
  escopo: "GERAL" | "SETOR";
  sectorId: string | null;
  alvoPercentual: number;
  alertaPercentual: number;
  vigenciaInicio: string; // yyyy-mm-dd
  vigenciaFim: string | null;
};

export const arredondar = (valor: number, casas = 2) => {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
};

export function percentualDe(parte: number, total: number): number | null {
  if (!Number.isFinite(parte) || !Number.isFinite(total) || total <= 0) return null;
  return arredondar((parte / total) * 100);
}

export function classificarMeta(realizado: number | null, alvo: number, alerta: number): StatusMeta {
  if (realizado == null) return "SEM_DADOS";
  if (realizado > alvo) return "VERMELHO";
  if (realizado >= alerta) return "AMARELO";
  return "VERDE";
}

/** Meta vigente no dia de referência: a de início mais recente que já começou e ainda não terminou. */
export function metaVigente(metas: MetaVigencia[], escopo: "GERAL" | "SETOR", sectorId: string | null, dia: string): MetaVigencia | null {
  const candidatas = metas
    .filter((m) => m.escopo === escopo && (m.sectorId ?? null) === (sectorId ?? null))
    .filter((m) => m.vigenciaInicio <= dia && (m.vigenciaFim == null || m.vigenciaFim >= dia))
    .sort((a, b) => b.vigenciaInicio.localeCompare(a.vigenciaInicio));
  return candidatas[0] ?? null;
}

export type EntradaProjecao = {
  comprasAteHoje: number;
  pedidosAbertos: number;
  faturamentoAteHoje: number;
  diasDecorridos: number;
  diasNoMes: number;
  alvoPercentual: number;
};

export type Projecao = {
  faturamentoProjetado: number | null;
  comprasComprometidas: number;
  percentualProjetado: number | null;
  tetoDeCompras: number | null;
  margemParaComprar: number | null;
};

/** Projeta o fim do mês: faturamento no ritmo atual; compras = já feitas + pedidos ainda não recebidos. */
export function projetarMes(e: EntradaProjecao): Projecao {
  const comprasComprometidas = arredondar(e.comprasAteHoje + e.pedidosAbertos);
  const temRitmo = e.diasDecorridos > 0 && e.faturamentoAteHoje > 0;
  if (!temRitmo) return { faturamentoProjetado: null, comprasComprometidas, percentualProjetado: null, tetoDeCompras: null, margemParaComprar: null };
  const faturamentoProjetado = arredondar((e.faturamentoAteHoje / e.diasDecorridos) * e.diasNoMes);
  const tetoDeCompras = arredondar((faturamentoProjetado * e.alvoPercentual) / 100);
  return {
    faturamentoProjetado,
    comprasComprometidas,
    percentualProjetado: percentualDe(comprasComprometidas, faturamentoProjetado),
    tetoDeCompras,
    margemParaComprar: arredondar(tetoDeCompras - comprasComprometidas),
  };
}

export function validarPercentuais(alvo: number, alerta: number): string | null {
  if (!Number.isFinite(alvo) || !Number.isFinite(alerta)) return "Informe a meta e o alerta em %.";
  if (alvo <= 0 || alvo > 100) return "A meta deve ficar entre 0 e 100%.";
  if (alerta <= 0 || alerta > alvo) return "O alerta deve ser maior que 0 e não passar da meta.";
  return null;
}

/** CmvPeriod.cmvPercentual é guardado como razão (0,58 = 58%); o painel trabalha em pontos percentuais. */
export const razaoParaPercentual = (razao: number): number => arredondar(razao * 100);
