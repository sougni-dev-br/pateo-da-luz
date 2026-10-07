// Quem pode mexer nas quantidades de um inventario, e o que fica registrado.
//
// Em revisao o inventario era somente leitura: para corrigir um item que a
// conferencia acusou (o sache de palito contado em unidades), o unico caminho
// era rejeitar, corrigir e reenviar. Quem aprova agora corrige ali mesmo, e
// cada correcao vai para a auditoria com o valor de antes e o de depois —
// depois da aprovacao essas quantidades viram a base do CMV.

export type ModoDeEdicao = "rascunho" | "revisao" | null;

const STATUS_DE_RASCUNHO = new Set(["RASCUNHO", "REJEITADO"]);

export function modoDeEdicao(status: string, podeAprovar: boolean): ModoDeEdicao {
  if (STATUS_DE_RASCUNHO.has(status)) return "rascunho";
  if (status === "EM_REVISAO" && podeAprovar) return "revisao";
  return null;
}

export type Correcao = { itemId: string; produto: string; antes: number | null; depois: number };

const DIFERENCA_MINIMA = 0.0001;

export function correcoesDaRevisao(
  antes: ReadonlyMap<string, { produto: string; quantidade: number | null }>,
  novos: ReadonlyArray<{ id: string; quantidade: number }>
): Correcao[] {
  const correcoes: Correcao[] = [];
  for (const item of novos) {
    const atual = antes.get(item.id);
    if (!atual) continue;
    if (atual.quantidade != null && Math.abs(atual.quantidade - item.quantidade) < DIFERENCA_MINIMA) continue;
    correcoes.push({ itemId: item.id, produto: atual.produto, antes: atual.quantidade, depois: item.quantidade });
  }
  return correcoes;
}
