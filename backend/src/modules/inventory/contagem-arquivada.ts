// Arquivar uma contagem concluída: ela some das listas do dia a dia, mas continua valendo como histórico
// (ciclos de estoque, medianas de contagem). É diferente de cancelar, que tira a contagem de inventário, CMV,
// compras e fechamento. Serve para contagens que já cumpriram o papel (como preparar um pedido) e não têm mais uso.

export const STATUS_CONTAGEM_ARQUIVADA = "ARQUIVADA";

type ContagemParaArquivar = { status: string; generatedInventoryId: string | null; generatedInventoryStatus?: string | null };

export function podeArquivarContagem(contagem: ContagemParaArquivar): boolean {
  if (contagem.status !== "CONCLUIDA") return false;
  // Quem gerou inventário ativo já tem destino e continua visível pelo inventário.
  return !contagem.generatedInventoryId || contagem.generatedInventoryStatus === "CANCELADO";
}

export function podeDesarquivarContagem(contagem: { status: string }): boolean {
  return contagem.status === STATUS_CONTAGEM_ARQUIVADA;
}
