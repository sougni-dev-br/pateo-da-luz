// Textos e leitura das recusas das travas da folha (duplicidade, depois da saída,
// baixa em duplicidade). Usado pela Folha (lançamento manual) e por Contas a Pagar.
import { ApiError } from "../api/client";

export type ResumoItemFolha = {
  id: string | null;
  tipo: string;
  tipoRotulo: string;
  rotulo: string | null;
  competencia: string;
  inicioPeriodo: string | null;
  valor: number;
  valorPago: number | null;
  status: string;
  vencimento: string | null;
  pagoEm: string | null;
};

export type RecusaFolha = {
  code: string;
  message: string;
  existentes?: ResumoItemFolha[];
  jaPagos?: ResumoItemFolha[];
  pessoa?: string;
  saida?: string;
};

export type SuspeitoLote = { item: ResumoItemFolha; pessoa: string; jaPagos: ResumoItemFolha[]; noLote: ResumoItemFolha[] };

export function recusaDaFolha(err: unknown, code: string): RecusaFolha | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.body?.code !== code) return null;
  return err.body as unknown as RecusaFolha;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// toLocaleString põe espaço fino (U+00A0) depois do "R$"; nos textos fica o espaço comum.
const real = (v: number) => brl(v).replace(/ /g, " ");
export const dataBr = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export function descreverExistente(r: ResumoItemFolha): string {
  const situacao = r.pagoEm
    ? `pago em ${dataBr(r.pagoEm)}${r.valorPago != null ? ` (${real(r.valorPago)})` : ""}`
    : `em aberto · vence ${dataBr(r.vencimento)}`;
  return `${r.rotulo ?? r.tipoRotulo} · ${real(r.valor)} · ${situacao}`;
}

export function fraseJaPago(pessoa: string, pago: ResumoItemFolha): string {
  const valor = pago.valorPago ?? pago.valor;
  return `Já foi pago ${pago.tipoRotulo.toLowerCase()} ${pago.competencia} de ${pessoa} em ${dataBr(pago.pagoEm)} (${real(valor)}). Baixar mesmo assim?`;
}

export function descreverSuspeito(s: SuspeitoLote): string {
  const partes = [
    ...s.jaPagos.map((p) => `já pago em ${dataBr(p.pagoEm)} (${real(p.valorPago ?? p.valor)})`),
    ...(s.noLote.length > 0 ? [`repetido neste lote (${s.noLote.map((o) => o.rotulo ?? o.tipoRotulo).join(", ")})`] : []),
  ];
  return `${s.pessoa} — ${s.item.tipoRotulo.toLowerCase()} ${s.item.competencia}: ${partes.join("; ")}`;
}
