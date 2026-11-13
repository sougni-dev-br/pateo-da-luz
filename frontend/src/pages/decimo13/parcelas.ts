import type { Decimo13Linha, Decimo13LinhaClt } from "../../api/client";

export type Parcela13 = 1 | 2;

export type ParcelaDaLinha = {
  /** O que a parcela vale: o lançado (ou, sem lançamento, o devido pelo cálculo de hoje). */
  valor: number;
  vencimento: string | null;
  /**
   * SEM_CALCULO: sem 13º calculado (o motivo vai na linha). EXCLUIDA: foi excluída à mão e o gerador não a recria.
   */
  situacao: "PAGA" | "LANCADA" | "A_LANCAR" | "EXCLUIDA" | "SEM_CALCULO";
  /** Lançada e não paga, mas o cálculo de hoje deu outro valor: gerar de novo atualiza para este. */
  atualizarPara: number | null;
  /** O botão de gerar mexe nesta pessoa (cria ou atualiza). */
  gerar: boolean;
};

export function parcelaDaLinha(l: Decimo13Linha, n: Parcela13): ParcelaDaLinha {
  const c = l.calculo;
  if (!c) return { valor: 0, vencimento: null, situacao: "SEM_CALCULO", atualizarPara: null, gerar: false };
  const p = n === 1 ? l.p1 : l.p2;
  const lancado = p.lancado != null;
  const mudou = lancado && !p.paga && p.devido != null && Math.abs((p.lancado ?? 0) - p.devido) >= 0.01;
  return {
    valor: p.lancado ?? p.devido ?? 0,
    vencimento: n === 1 ? c.vencimento1 : c.vencimento2,
    situacao: p.paga ? "PAGA" : lancado ? "LANCADA" : p.existe ? "EXCLUIDA" : "A_LANCAR",
    atualizarPara: mudou ? p.devido : null,
    gerar: p.gerar,
  };
}

export type ResumoParcela = {
  /** Pessoas com 13º calculado e valor na parcela. */
  pessoas: number; semCalculo: number;
  /** A criar (ainda sem título) e a atualizar (título em aberto com outro valor). */
  novas: number; atualizar: number;
  lancadas: number; excluidas: number;
  totalNovas: number; totalLancado: number;
};

// Parcela de valor zero não vira título (o gerador a ignora): não entra na conta.
export function resumirParcela(parcelas: ParcelaDaLinha[]): ResumoParcela {
  const r: ResumoParcela = { pessoas: 0, semCalculo: 0, novas: 0, atualizar: 0, lancadas: 0, excluidas: 0, totalNovas: 0, totalLancado: 0 };
  for (const p of parcelas) {
    if (p.situacao === "SEM_CALCULO") { r.semCalculo += 1; continue; }
    if (p.situacao === "EXCLUIDA") { r.excluidas += 1; continue; }
    if (p.valor <= 0) continue;
    r.pessoas += 1;
    if (p.situacao === "A_LANCAR") {
      if (p.gerar) { r.novas += 1; r.totalNovas += p.valor; }
      continue;
    }
    r.lancadas += 1;
    r.totalLancado += p.valor;
    if (p.gerar && p.atualizarPara != null) r.atualizar += 1;
  }
  return r;
}

export function descreverParcela(n: Parcela13, vencimentoBr: string | null): string {
  const quando = vencimentoBr ? `Vence em ${vencimentoBr}` : n === 1 ? "Vence até 30/11" : "Vence até 20/12";
  return n === 1
    ? `${quando} · metade do 13º proporcional (avos), com a média das variáveis dos meses já apurados.`
    : `${quando} · o 13º completo menos o que a 1ª parcela pagou (acerto).`;
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
