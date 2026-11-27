import type { PurchaseOrderItem } from "../../api/client";
import { Table } from "../../design-system";
import { formatNumber } from "../../utils/format";

export type ItemRascunho = { requestedQuantity: string; receivedQuantity: string; notes: string };

type Props = {
  itens: PurchaseOrderItem[];
  valores: Record<string, ItemRascunho>;
  /** Rascunho: pode mudar a quantidade solicitada e a observação. */
  editavel: boolean;
  /** Enviado ou recebido parcial: pode informar o que chegou. */
  recebendo: boolean;
  onMudar: (itemId: string, campo: keyof ItemRascunho, valor: string) => void;
};

type Campo = { item: PurchaseOrderItem } & Pick<Props, "valores" | "onMudar">;

function Solicitada({ item, valores, onMudar, editavel }: Campo & { editavel: boolean }) {
  if (!editavel) return <span className="po-num">{formatNumber(item.requestedQuantity)}</span>;
  return (
    <input className="po-qtd" type="number" min="0" step="any" inputMode="decimal"
      aria-label={`Quantidade solicitada de ${item.productNameSnapshot}`}
      value={valores[item.id]?.requestedQuantity ?? ""}
      onChange={(e) => onMudar(item.id, "requestedQuantity", e.target.value)} />
  );
}

function Recebida({ item, valores, onMudar, recebendo }: Campo & { recebendo: boolean }) {
  if (!recebendo) return <span className="po-num">{formatNumber(item.receivedQuantity)}</span>;
  return (
    <input className="po-qtd" type="number" min="0" step="any" inputMode="decimal"
      aria-label={`Quantidade recebida de ${item.productNameSnapshot}`}
      value={valores[item.id]?.receivedQuantity ?? ""}
      onChange={(e) => onMudar(item.id, "receivedQuantity", e.target.value)} />
  );
}

function Observacao({ item, valores, onMudar, editavel }: Campo & { editavel: boolean }) {
  if (!editavel) return <span className="po-obs-texto" title={item.notes ?? undefined}>{item.notes || "—"}</span>;
  return (
    <input className="po-obs" aria-label={`Observação de ${item.productNameSnapshot}`} placeholder="Observação"
      value={valores[item.id]?.notes ?? ""}
      onChange={(e) => onMudar(item.id, "notes", e.target.value)} />
  );
}

const detalheProduto = (item: PurchaseOrderItem) => [item.productCodeSnapshot, item.unitSnapshot].filter(Boolean).join(" · ") || "—";
const minIdeal = (item: PurchaseOrderItem) => `mín ${formatNumber(item.estoqueMinimoSnapshot)} · ideal ${formatNumber(item.estoqueIdealSnapshot)}`;

/** Tabela no computador; no celular, um cartão por item com os campos um embaixo do outro. */
export function ItensDoPedido({ itens, valores, editavel, recebendo, onMudar }: Props) {
  const campo = { valores, onMudar };
  return (
    <>
      <div className="po-itens">
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Produto</Table.Th>
              <Table.Th align="right" style={{ width: 120 }}>Estoque</Table.Th>
              <Table.Th align="right" style={{ width: 100 }}>Sugestão</Table.Th>
              <Table.Th align="right" style={{ width: 110 }}>Solicitada</Table.Th>
              <Table.Th align="right" style={{ width: 90 }}>Aprovada</Table.Th>
              <Table.Th align="right" style={{ width: 110 }}>Recebida</Table.Th>
              <Table.Th style={{ width: 170 }}>Obs.</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {itens.map((item) => (
              <Table.Row key={item.id}>
                <Table.Td className="po-celula" title={item.productNameSnapshot}>
                  <strong className="po-fornecedor">{item.productNameSnapshot}</strong>
                  <small>{detalheProduto(item)}</small>
                </Table.Td>
                <Table.Td align="right" className="po-celula po-celula--num">
                  <strong>{formatNumber(item.lastCountedQuantity)}</strong>
                  <small title="Estoque mínimo e ideal">{minIdeal(item)}</small>
                </Table.Td>
                <Table.Td align="right" className="po-celula po-celula--num">
                  <strong title={item.alertSnapshot ?? undefined}>{formatNumber(item.suggestedQuantity)}</strong>
                  {item.suggestionTypeSnapshot && <small>{item.suggestionTypeSnapshot}</small>}
                </Table.Td>
                <Table.Td align="right"><Solicitada item={item} editavel={editavel} {...campo} /></Table.Td>
                <Table.Td align="right"><span className="po-num">{formatNumber(item.approvedQuantity ?? item.requestedQuantity)}</span></Table.Td>
                <Table.Td align="right"><Recebida item={item} recebendo={recebendo} {...campo} /></Table.Td>
                <Table.Td><Observacao item={item} editavel={editavel} {...campo} /></Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      <ul className="po-itens-mobile">
        {itens.map((item) => (
          <li key={`${item.id}-mobile`} className="po-item">
            <div className="po-item-topo">
              <strong>{item.productNameSnapshot}</strong>
              <small>{detalheProduto(item)}</small>
            </div>
            <dl className="po-item-numeros">
              <div><dt>Estoque</dt><dd>{formatNumber(item.lastCountedQuantity)}<small>{minIdeal(item)}</small></dd></div>
              <div><dt>Sugestão</dt><dd>{formatNumber(item.suggestedQuantity)}{item.suggestionTypeSnapshot && <small>{item.suggestionTypeSnapshot}</small>}</dd></div>
              <div><dt>Aprovada</dt><dd>{formatNumber(item.approvedQuantity ?? item.requestedQuantity)}</dd></div>
            </dl>
            <div className="po-item-campos">
              <label><span>Solicitada</span><Solicitada item={item} editavel={editavel} {...campo} /></label>
              <label><span>Recebida</span><Recebida item={item} recebendo={recebendo} {...campo} /></label>
            </div>
            {(editavel || item.notes) && <Observacao item={item} editavel={editavel} {...campo} />}
          </li>
        ))}
      </ul>
    </>
  );
}
