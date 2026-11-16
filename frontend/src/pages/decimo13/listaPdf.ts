// PDF da lista de pagamento do 13º: o mesmo desenho da lista do adiantamento e da 1ª quinzena
// (gerarPdfListaPagamento). Só monta o que muda: linhas, selo e regras.
import type { ListaDecimo13, TipLinhaFolha } from "../../api/client";
import type { ListaPagamentoPdf } from "../gorjeta/pdfFolhaLiquidos";
import type { Selo } from "../gorjeta/pdfTema";

/** Os pagos saem da lista (vão para "Já pagos"); quem falta lançar sai marcado, pelo aviso da linha. */
export function listaDecimoParaPdf(lista: ListaDecimo13): ListaPagamentoPdf {
  const linhas: TipLinhaFolha[] = lista.linhas.filter((l) => l.situacao !== "PAGO").map((l) => ({
    employeeId: l.employeeId, nome: l.nome, grupo: l.grupo, origem: l.origem, valor: l.valor,
    pix: l.pix, pixTipo: l.pixTipo, contaBancaria: l.contaBancaria, aviso: l.aviso,
  }));
  const jaPagos = lista.linhas.filter((l) => l.situacao === "PAGO")
    .map((l) => ({ nome: l.nome, valor: l.valorPago ?? l.valor, pagoEm: l.pagoEm ?? l.vencimento }));
  return { linhas, jaPagos, total: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100 };
}

/** Prévia enquanto falta lançar alguém; "lançado" só com a lista toda no Contas a Pagar. */
export function seloDaListaDecimo(lista: ListaDecimo13): Selo {
  const n = lista.aLancar.pessoas + lista.linhas.filter((l) => l.situacao !== "PAGO" && l.atualizarPara != null).length
    + (lista.aguardandoExtrato?.length ?? 0);
  return n > 0
    ? { texto: `PRÉVIA - ${n === 1 ? "FALTA LANÇAR 1" : `FALTAM LANÇAR ${n}`}`, tom: "aviso" }
    : { texto: "LANÇADO NO CONTAS A PAGAR", tom: "ok" };
}

export function regrasDaListaDecimo(parcela: 1 | 2, aguardandoExtrato: readonly string[] = []): string[] {
  const aviso = aguardandoExtrato.length > 0
    ? [`ATENÇÃO - falta a diferença do salário combinado de ${aguardandoExtrato.join(", ")}: aguardam o extrato do 13º, não estão nesta lista.`]
    : [];
  return [...aviso, ...regrasBase(parcela)];
}

function regrasBase(parcela: 1 | 2): string[] {
  return parcela === 1
    ? [
      "CLT: 1ª parcela do 13º pelo extrato da contabilidade; com salário combinado, soma a diferença sobre o registrado.",
      "Sem registro: metade do 13º proporcional (avos), com a média das variáveis dos meses apurados.",
    ]
    : [
      "CLT: 2ª parcela do 13º pelo extrato da contabilidade; com salário combinado, soma a diferença sobre o registrado.",
      "Sem registro: o 13º completo menos o que a 1ª parcela pagou (acerto).",
    ];
}

export const codigoDaListaDecimo = (ano: number, parcela: 1 | 2) => `13O-P${parcela}-${ano}`;
