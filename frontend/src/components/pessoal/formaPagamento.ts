// Forma de pagamento de quem não tem registro, no cadastro: uma escolha só na tela, gravada
// em dois campos (recebeAdiantamento e pagamentoQuinzenal). O backend recusa os dois juntos.

export type FormaPagamento = "PAGAMENTO" | "ADIANTAMENTO" | "QUINZENA";

type Campos = { recebeAdiantamento: boolean; pagamentoQuinzenal?: boolean };

export const OPCOES_FORMA_PAGAMENTO: Array<{ value: FormaPagamento; label: string }> = [
  { value: "PAGAMENTO", label: "Recebe só no pagamento (até o 5º dia útil)" },
  { value: "ADIANTAMENTO", label: "Recebe adiantamento no dia 20" },
  { value: "QUINZENA", label: "Recebe por quinzena (dias 15 e 30)" },
];

// A quinzena prevalece se um cadastro antigo tiver as duas (o cálculo faz o mesmo).
export function formaPagamentoDe(c: Campos): FormaPagamento {
  if (c.pagamentoQuinzenal) return "QUINZENA";
  return c.recebeAdiantamento ? "ADIANTAMENTO" : "PAGAMENTO";
}

export function camposDaForma(forma: FormaPagamento): Required<Campos> {
  return { recebeAdiantamento: forma === "ADIANTAMENTO", pagamentoQuinzenal: forma === "QUINZENA" };
}

export function dicaFormaPagamento(forma: FormaPagamento): string {
  if (forma === "QUINZENA") return "metade do salário base no dia 15; a lista de pagamento da gorjeta (dia 30) desconta essa 1ª quinzena";
  if (forma === "ADIANTAMENTO") return "a lista de pagamento da gorjeta desconta o adiantamento já pago (% e dia em Folha → Configurações)";
  return "salário inteiro na lista de pagamento da gorjeta";
}

/** Troca de modalidade no cadastro: registrado (CLT) não recebe por quinzena — o campo some e o backend recusaria. */
export function camposDaModalidade<M extends "CLT" | "NAO_CLT">(modality: M, c: Campos): { modality: M; pagamentoQuinzenal: boolean } {
  return { modality, pagamentoQuinzenal: modality === "CLT" ? false : Boolean(c.pagamentoQuinzenal) };
}
