import type { Purchase } from "../../api/client";

/** Quantos dias à frente contam como "vence em breve". */
export const DIAS_PROXIMOS = 7;

export type TomVencimento = "vencido" | "hoje" | "semana" | "futuro" | "pago" | "sem" | "neutro";

export type FaixaVencimento = "todas" | "abertas" | "vencidas" | "vence7" | "pagas" | "sem";

export type ResumoVencimento = {
  tom: TomVencimento;
  /** Data da próxima parcela em aberto (ou da última baixa, quando paga), AAAA-MM-DD. */
  data: string | null;
  /** Linha principal da célula: a data, ou o motivo de não haver uma. */
  rotulo: string;
  /** "há 3 dias", "vence hoje", "em 12 dias". */
  prazo: string;
  /** "2 de 6 em aberto"; só quando há mais de uma parcela. */
  parcelas: string | null;
  /** Dias até a próxima parcela em aberto (negativo = vencida); null quando não há. */
  dias: number | null;
  qtdAbertas: number;
  qtdVencidas: number;
  qtdVence7: number;
  abertoTotal: number;
  vencidoTotal: number;
  vence7Total: number;
  pagoTotal: number;
};

type CompraParaVencimento = Pick<Purchase, "status" | "cycleStatus" | "creditCardId" | "reimbursementPayeeId" | "installments">;
type Parcela = Purchase["installments"][number];

const QUITADAS = new Set(["PAID", "PAID_LATE"]);

const ZERADO = {
  data: null,
  prazo: "",
  parcelas: null,
  dias: null,
  qtdAbertas: 0,
  qtdVencidas: 0,
  qtdVence7: 0,
  abertoTotal: 0,
  vencidoTotal: 0,
  vence7Total: 0,
  pagoTotal: 0
} as const;

/** "2026-10-01T00:00:00.000Z" → "2026-10-01"; qualquer outra coisa → null. */
export function chaveData(valor?: string | null): string | null {
  if (!valor) return null;
  const chave = String(valor).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(chave) ? chave : null;
}

export function formatarChave(chave: string): string {
  const [ano, mes, dia] = chave.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Dias de `de` até `ate` (ambos AAAA-MM-DD); negativo quando `ate` é anterior. */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

function numero(valor?: string | null): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

function estaEmAberto(parcela: Parcela): boolean {
  return !QUITADAS.has(parcela.status ?? "") && !chaveData(parcela.paidDate);
}

function textoPrazo(dias: number): string {
  if (dias < 0) return dias === -1 ? "há 1 dia" : `há ${-dias} dias`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `em ${dias} dias`;
}

function tomDoPrazo(dias: number): TomVencimento {
  if (dias < 0) return "vencido";
  if (dias === 0) return "hoje";
  return dias <= DIAS_PROXIMOS ? "semana" : "futuro";
}

/** Compra sem parcela própria: o vencimento mora em outro lugar (ciclo, fatura, reembolso). */
function semParcelas(compra: CompraParaVencimento): ResumoVencimento {
  if (compra.cycleStatus != null) return { ...ZERADO, tom: "neutro", rotulo: "No ciclo do fornecedor" };
  if (compra.creditCardId) return { ...ZERADO, tom: "neutro", rotulo: "Na fatura do cartão" };
  if (compra.reimbursementPayeeId) return { ...ZERADO, tom: "neutro", rotulo: "No reembolso" };
  return { ...ZERADO, tom: "sem", rotulo: "Sem vencimento" };
}

/**
 * Resume o vencimento de uma compra a partir das parcelas: a próxima em aberto manda
 * (a mais atrasada, se houver atraso); quando tudo foi pago mostra a última baixa.
 * `hoje` é AAAA-MM-DD no fuso local.
 */
export function resumirVencimento(compra: CompraParaVencimento, hoje: string): ResumoVencimento {
  if (compra.status === "CANCELLED") return { ...ZERADO, tom: "neutro", rotulo: "Cancelada" };

  const parcelas = compra.installments.filter((p) => p.status !== "CANCELLED");
  if (parcelas.length === 0) return semParcelas(compra);

  const abertas = parcelas.filter(estaEmAberto);
  const pagas = parcelas.filter((p) => !estaEmAberto(p));
  const pagoTotal = pagas.reduce((soma, p) => soma + numero(p.paidAmount ?? p.amount), 0);

  if (abertas.length === 0) {
    const ultimaBaixa = pagas.map((p) => chaveData(p.paidDate)).filter((d): d is string => d !== null).sort().pop() ?? null;
    return {
      ...ZERADO,
      tom: "pago",
      data: ultimaBaixa,
      rotulo: "Paga",
      prazo: ultimaBaixa ? `em ${formatarChave(ultimaBaixa)}` : "",
      parcelas: parcelas.length > 1 ? `${parcelas.length} parcelas pagas` : null,
      pagoTotal
    };
  }

  const comData = abertas
    .map((p) => ({ chave: chaveData(p.dueDate), valor: numero(p.amount) }))
    .filter((p): p is { chave: string; valor: number } => p.chave !== null);

  const abertoTotal = abertas.reduce((soma, p) => soma + numero(p.amount), 0);
  const vencidas = comData.filter((p) => p.chave < hoje);
  const proximas = comData.filter((p) => {
    const dias = diasEntre(hoje, p.chave);
    return dias >= 0 && dias <= DIAS_PROXIMOS;
  });
  const base = {
    qtdAbertas: abertas.length,
    qtdVencidas: vencidas.length,
    qtdVence7: proximas.length,
    abertoTotal,
    vencidoTotal: vencidas.reduce((soma, p) => soma + p.valor, 0),
    vence7Total: proximas.reduce((soma, p) => soma + p.valor, 0),
    pagoTotal,
    parcelas: parcelas.length > 1 ? `${abertas.length} de ${parcelas.length} em aberto` : null
  };

  if (comData.length === 0) return { ...ZERADO, ...base, tom: "sem", rotulo: "Sem vencimento" };

  const proxima = comData.map((p) => p.chave).sort()[0];
  const dias = diasEntre(hoje, proxima);
  return {
    ...ZERADO,
    ...base,
    tom: tomDoPrazo(dias),
    data: proxima,
    rotulo: formatarChave(proxima),
    prazo: textoPrazo(dias),
    dias
  };
}

export function pertenceFaixa(resumo: ResumoVencimento, faixa: FaixaVencimento): boolean {
  switch (faixa) {
    case "abertas": return resumo.qtdAbertas > 0;
    case "vencidas": return resumo.qtdVencidas > 0;
    case "vence7": return resumo.qtdVence7 > 0;
    case "pagas": return resumo.tom === "pago";
    case "sem": return resumo.tom === "sem";
    default: return true;
  }
}

export type TotaisCompras = {
  quantidade: number;
  total: number;
  aberto: { valor: number; compras: number };
  vencido: { valor: number; compras: number };
  vence7: { valor: number; compras: number };
  pago: { valor: number; compras: number };
};

/** Soma o que está na tela. Compras canceladas não entram. */
export function totalizar(linhas: Array<{ totalAmount: string; status?: string; vencimento: ResumoVencimento }>): TotaisCompras {
  const totais: TotaisCompras = {
    quantidade: 0,
    total: 0,
    aberto: { valor: 0, compras: 0 },
    vencido: { valor: 0, compras: 0 },
    vence7: { valor: 0, compras: 0 },
    pago: { valor: 0, compras: 0 }
  };
  for (const linha of linhas) {
    if (linha.status === "CANCELLED") continue;
    const v = linha.vencimento;
    totais.quantidade += 1;
    totais.total += numero(linha.totalAmount);
    if (v.qtdAbertas > 0) { totais.aberto.valor += v.abertoTotal; totais.aberto.compras += 1; }
    if (v.qtdVencidas > 0) { totais.vencido.valor += v.vencidoTotal; totais.vencido.compras += 1; }
    if (v.qtdVence7 > 0) { totais.vence7.valor += v.vence7Total; totais.vence7.compras += 1; }
    // Só compras quitadas: é o que o cartão "Pagas" abre ao ser clicado.
    if (v.tom === "pago") { totais.pago.valor += v.pagoTotal; totais.pago.compras += 1; }
  }
  return totais;
}
