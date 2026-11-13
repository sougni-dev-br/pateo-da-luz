import type { Decimo13Linha, Decimo13LinhaClt } from "../../api/client";

export type Parcela13 = 1 | 2;

export type ParcelaDaLinha = {
  valor: number;
  vencimento: string | null;
  /** SEM_CALCULO: a pessoa não tem 13º calculado (motivo na linha). */
  situacao: "LANCADA" | "A_LANCAR" | "SEM_CALCULO";
};

export function parcelaDaLinha(l: Decimo13Linha, n: Parcela13): ParcelaDaLinha {
  const c = l.calculo;
  if (!c) return { valor: 0, vencimento: null, situacao: "SEM_CALCULO" };
  const existe = n === 1 ? l.parcela1Existe : l.parcela2Existe;
  return {
    valor: n === 1 ? c.parcela1 : c.parcela2,
    vencimento: n === 1 ? c.vencimento1 : c.vencimento2,
    situacao: existe ? "LANCADA" : "A_LANCAR",
  };
}

export type ResumoParcela = {
  pessoas: number; semCalculo: number; aLancar: number; lancadas: number; totalALancar: number; totalLancado: number;
};

// Parcela de valor zero não vira título (o backend a ignora): não conta como "a lançar".
export function resumirParcela(parcelas: ParcelaDaLinha[]): ResumoParcela {
  const r: ResumoParcela = { pessoas: 0, semCalculo: 0, aLancar: 0, lancadas: 0, totalALancar: 0, totalLancado: 0 };
  for (const p of parcelas) {
    if (p.situacao === "SEM_CALCULO") { r.semCalculo += 1; continue; }
    if (p.valor <= 0) continue;
    r.pessoas += 1;
    if (p.situacao === "LANCADA") { r.lancadas += 1; r.totalLancado += p.valor; }
    else { r.aLancar += 1; r.totalALancar += p.valor; }
  }
  return r;
}

export function descreverParcela(n: Parcela13, vencimentoBr: string | null): string {
  const quando = vencimentoBr ? `Vence em ${vencimentoBr}` : n === 1 ? "Vence até 30/11" : "Vence até 20/12";
  return n === 1
    ? `${quando} · metade do 13º proporcional (avos). A média de variáveis entra no cálculo do total.`
    : `${quando} · o restante do 13º, já descontada a 1ª parcela.`;
}

export type ParcelaClt = { valor: number; situacao: "PAGA" | "LANCADA" | "AGUARDANDO_EXTRATO" };

/** CLT: o valor vem do extrato; sem lançamento, a pessoa aguarda o extrato da contabilidade. */
export function parcelaClt(l: Decimo13LinhaClt, n: Parcela13): ParcelaClt {
  const p = n === 1 ? l.parcela1 : l.parcela2;
  if (!p) return { valor: 0, situacao: "AGUARDANDO_EXTRATO" };
  return { valor: p.valor, situacao: p.pago ? "PAGA" : "LANCADA" };
}

export type ResumoClt = { pessoas: number; aguardando: number; total: number };
export function resumirClt(parcelas: ParcelaClt[]): ResumoClt {
  const r: ResumoClt = { pessoas: parcelas.length, aguardando: 0, total: 0 };
  for (const p of parcelas) {
    if (p.situacao === "AGUARDANDO_EXTRATO") r.aguardando += 1;
    else r.total += p.valor;
  }
  return r;
}
