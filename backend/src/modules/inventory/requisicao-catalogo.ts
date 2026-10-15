import type { ConversaoDoProduto } from "../../shared/unidades/conversao.js";
import { conversoesDoInsumo, textoDaEmbalagem, unidadeDoInsumo, type ProdutoComUnidades } from "../../shared/unidades/insumo.js";

export type ProdutoDoCatalogo = ProdutoComUnidades & { id: string; externalCode: string | null; inventorySectorId: string | null };

/** Uma linha da lista de onde a pessoa escolhe o que retirar: o produto, o saldo e o que ele sabe converter. */
export type ItemDoCatalogo = {
  id: string;
  name: string;
  code: string | null;
  /** Unidade do estoque: nela o saldo é guardado e a retirada é baixada. */
  unit: string | null;
  conversions: ConversaoDoProduto[];
  embalagemInferida: string | null;
  sectorId: string | null;
  /** Saldo na unidade do estoque; 0 quando o item não tem registro de saldo (é assim que o servidor decide). */
  balance: number;
};

export function itemDoCatalogo(produto: ProdutoDoCatalogo, saldo: number | undefined): ItemDoCatalogo {
  const conversoes = conversoesDoInsumo(produto);
  return {
    id: produto.id,
    name: produto.name,
    code: produto.externalCode,
    unit: unidadeDoInsumo(produto),
    conversions: conversoes,
    embalagemInferida: textoDaEmbalagem(produto, conversoes),
    sectorId: produto.inventorySectorId,
    balance: saldo != null && Number.isFinite(saldo) ? saldo : 0
  };
}
