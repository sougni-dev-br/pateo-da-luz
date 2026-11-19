import type { TipComputation } from "../../api/client";
import { money } from "./gorjetaUtils";

// Cada pessoa recebe o valor arredondado ao centavo; a soma pode ficar alguns centavos abaixo do
// líquido. Isso é arredondamento, não "livre para distribuir": não pede decisão de ninguém.
// Margem: um centavo por pessoa no rateio (mínimo de 5 centavos). Acima disso, é saldo de verdade.
// E, mesmo abaixo, só é arredondamento quando nada mais explica a diferença (gorjeta real no lugar
// da calculada, rescisão quitada abaixo do direito, sobra de quem saiu indo ao livre): nesses casos
// o saldo é intencional e continua sendo mostrado como livre.
const CENTAVO = 0.01;
const MINIMO_REAIS = 0.05;
const SALDO_MINIMO = 0.005; // abaixo disso não há saldo (já é zero em centavos)

export function limiteDeArredondamento(pessoasNoRateio: number): number {
  return Math.max(MINIMO_REAIS, Math.round(pessoasNoRateio * CENTAVO * 100) / 100);
}

export function ehArredondamento(saldo: number, pessoasNoRateio: number): boolean {
  return saldo > SALDO_MINIMO && saldo <= limiteDeArredondamento(pessoasNoRateio) + 1e-9;
}

type Base = Pick<TipComputation, "saldo" | "participants"> & Partial<Pick<TipComputation, "sobraRescisaoParaSaldo" | "rescisoes" | "destinoEfetivo" | "destinoSobra" | "status">>;

export const pessoasNoRateio = (comp: Pick<TipComputation, "participants">): number =>
  (comp.participants ?? []).filter((p) => !p.foraDaGorjeta && p.tipoCalculo !== "FORA_DO_PERIODO").length;

// Algo além do arredondamento mexeu no saldo: o responsável precisa enxergá-lo como livre.
function temOutraCausa(comp: Base): boolean {
  const gente = comp.participants ?? [];
  const gorjetaRealNoCalculo = gente.some((p) => p.gorjetaReal != null && p.tipoCalculo === "MES");
  const quitadaAbaixoDoDireito = gente.some((p) => p.tipoCalculo === "RESCISAO_QUITADA");
  const sobraDeQuemSaiu = comp.sobraRescisaoParaSaldo === true && ((comp.rescisoes?.valor ?? 0) > 0 || (comp.rescisoes?.pontos ?? 0) > 0);
  return gorjetaRealNoCalculo || quitadaAbaixoDoDireito || sobraDeQuemSaiu;
}

export type ExplicacaoDoSaldo = { tipo: "estouro" | "arredondamento" | "livre" | "zerado"; valor: number };

export function classificarSaldo(comp: Base): ExplicacaoDoSaldo {
  if (comp.saldo < -SALDO_MINIMO) return { tipo: "estouro", valor: Math.abs(comp.saldo) };
  if (comp.saldo <= SALDO_MINIMO) return { tipo: "zerado", valor: 0 };
  const centavos = ehArredondamento(comp.saldo, pessoasNoRateio(comp)) && !temOutraCausa(comp);
  return { tipo: centavos ? "arredondamento" : "livre", valor: comp.saldo };
}

/** Para onde vão os centavos, nas palavras do destino do período (e no tempo certo: fechado ou não). */
export function destinoDosCentavos(destino: string | undefined, fechado = false): string {
  if (destino === "LIVRE") return fechado ? "Ficaram no período como saldo livre." : "Ficam no período como saldo livre.";
  if (destino === "REDISTRIBUIR") return "Os pontos foram redistribuídos entre as pessoas.";
  return fechado ? "Entraram no fundo de reserva no fechamento." : "No fechamento entram no fundo de reserva.";
}

export const textoArredondamento = (comp: Pick<TipComputation, "saldo" | "destinoEfetivo" | "destinoSobra"> & Partial<Pick<TipComputation, "status">>) =>
  `Sobram ${money(comp.saldo)} de arredondamento: cada pessoa recebe o valor arredondado ao centavo. ${destinoDosCentavos(comp.destinoEfetivo ?? comp.destinoSobra, comp.status === "CLOSED")}`;

/** O nome do saldo nas telas do ciclo atual: o mesmo em todas. */
export const rotuloDoSaldoNaTela = (comp: Base): string => {
  const t = classificarSaldo(comp).tipo;
  return t === "estouro" ? "Estouro" : t === "arredondamento" ? "Arredondamento" : "Saldo não distribuído";
};
