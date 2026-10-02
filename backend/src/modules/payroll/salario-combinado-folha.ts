// Salário de quem tem salário combinado: o que vai ao Contas a Pagar (e à folha de
// líquidos) é o valor INTEGRAL do recebimento, não só o líquido do extrato.
// Regra do dono: (combinado − adiantamento) + gorjeta calculada na íntegra (pelos
// pontos — não a gorjeta informada à contabilidade pelo teto do IR). Só regra, sem banco.

const round2 = (v: number) => Math.round(v * 100) / 100;
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function valorIntegralCombinado(a: { combinado: number; adiantamento: number; gorjeta: number }): number {
  return round2(a.combinado - a.adiantamento + a.gorjeta);
}

// Gorjeta da pessoa na apuração da competência. pagoNaRescisao: a gorjeta já foi paga no
// termo de rescisão (não soma de novo no salário).
export type GorjetaDaApuracao = { noPeriodo: boolean; gorjetaLiquida: number; pagoNaRescisao?: boolean };

// A gorjeta de uma pessoa a partir do mapa da competência. Sem apuração (mapa null) =
// pendente (null). Apuração existe e a pessoa não está nela (em teste, fora do período) =
// gorjeta zero, como na folha de líquidos — não fica pendente para sempre.
export function gorjetaDaPessoa(mapa: Map<string, GorjetaDaApuracao> | null | undefined, employeeId: string): GorjetaDaApuracao | null {
  if (mapa == null) return null;
  return mapa.get(employeeId) ?? { noPeriodo: false, gorjetaLiquida: 0 };
}

export type DetalhesSalario = {
  liquidoExtrato: number;
  combinado?: number;
  adiantamento?: number | null;
  gorjetaIntegral?: number;
  complemento?: number;
  composicao?: string;
  origemValor?: "SALARIO_COMBINADO";
  pendenteGorjeta?: true;
};

export type SalarioDaFolha = { valor: number; detalhes: DetalhesSalario; pendenteGorjeta: boolean; aviso: string | null };

export function salarioDaFolha(e: {
  liquidoExtrato: number; adiantamento: number | null; combinado: number | null; gorjeta: GorjetaDaApuracao | null | undefined;
}): SalarioDaFolha {
  const liquidoExtrato = round2(e.liquidoExtrato);
  if (e.combinado == null) return { valor: liquidoExtrato, detalhes: { liquidoExtrato }, pendenteGorjeta: false, aviso: null };
  if (!e.gorjeta) {
    return {
      valor: liquidoExtrato,
      detalhes: { liquidoExtrato, combinado: e.combinado, adiantamento: e.adiantamento, pendenteGorjeta: true },
      pendenteGorjeta: true, aviso: null,
    };
  }
  const adiantamento = e.adiantamento ?? 0;
  const gorjetaIntegral = e.gorjeta.noPeriodo && !e.gorjeta.pagoNaRescisao ? round2(e.gorjeta.gorjetaLiquida) : 0;
  const valor = valorIntegralCombinado({ combinado: e.combinado, adiantamento, gorjeta: gorjetaIntegral });
  const complemento = round2(valor - liquidoExtrato);
  return {
    valor,
    detalhes: {
      liquidoExtrato, combinado: e.combinado, adiantamento, gorjetaIntegral, complemento, origemValor: "SALARIO_COMBINADO",
      composicao: `(${reais(e.combinado)} − adiantamento ${reais(adiantamento)}) + gorjeta ${reais(gorjetaIntegral)} = ${reais(valor)} `
        + `(líquido do extrato ${reais(liquidoExtrato)} + diferença do salário combinado ${reais(complemento)})`,
    },
    pendenteGorjeta: false,
    aviso: e.adiantamento == null ? "adiantamento não lido no extrato: considerado zero" : null,
  };
}

// Chaves que só existem por causa do salário combinado: saem antes de gravar o cálculo novo
// (o combinado pode ter sido tirado; o pendente pode ter virado calculado).
const CHAVES_DO_COMBINADO = ["combinado", "gorjetaIntegral", "complemento", "composicao", "origemValor", "pendenteGorjeta"];

export function mesclarDetalhes(antigos: unknown, novos: DetalhesSalario): Record<string, unknown> {
  const base = antigos && typeof antigos === "object" && !Array.isArray(antigos) ? (antigos as Record<string, unknown>) : {};
  const limpos = Object.fromEntries(Object.entries(base).filter(([k]) => !CHAVES_DO_COMBINADO.includes(k)));
  return { ...limpos, ...novos };
}

export type ComposicaoSalario = {
  tipo: "SALARIO_COMBINADO" | "PENDENTE_GORJETA";
  liquidoExtrato: number;
  complemento: number;
  total: number;
  combinado: number | null;
  adiantamento: number | null;
  gorjetaIntegral: number | null;
};

const numOuNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// O que o detalhe do Contas a Pagar mostra (só para quem pode ver salários).
export function composicaoParaTela(details: unknown, valor: number): ComposicaoSalario | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const liquidoExtrato = numOuNull(d.liquidoExtrato);
  if (liquidoExtrato == null) return null;
  const comuns = { liquidoExtrato, combinado: numOuNull(d.combinado), adiantamento: numOuNull(d.adiantamento), gorjetaIntegral: numOuNull(d.gorjetaIntegral) };
  if (d.origemValor === "SALARIO_COMBINADO") {
    return { tipo: "SALARIO_COMBINADO", ...comuns, complemento: numOuNull(d.complemento) ?? round2(valor - liquidoExtrato), total: valor };
  }
  if (d.pendenteGorjeta === true) {
    return { tipo: "PENDENTE_GORJETA", ...comuns, adiantamento: null, gorjetaIntegral: null, complemento: 0, total: valor };
  }
  return null;
}
