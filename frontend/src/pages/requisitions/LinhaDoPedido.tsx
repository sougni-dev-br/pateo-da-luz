import { Minus, Plus } from "lucide-react";
import { memo } from "react";
import type { RequisitionPurchaseItem } from "../../api/client";
import { Money } from "../../design-system";
import { formatarQuantidade } from "../desperdicio/quantidade";
import { passoDaUnidade, somarPasso } from "./catalogo";
import { situacaoDoItem, type DecisaoDoItem } from "./pedido";

type Props = {
  item: RequisitionPurchaseItem;
  decisao: DecisaoDoItem | undefined;
  fornecedores: Array<{ id: string; name: string }>;
  onMudar: (productId: string, parcial: Partial<DecisaoDoItem>) => void;
  onVoltarAoSugerido: (productId: string) => void;
};

function LinhaDoPedidoBase({ item, decisao, fornecedores, onMudar, onVoltarAoSugerido }: Props) {
  const unidade = item.unit ?? "UN";
  const s = situacaoDoItem(item, decisao);
  const passo = passoDaUnidade(unidade);
  const doHistorico = new Set(item.supplierOptions.map((o) => o.supplierId));
  const outros = fornecedores.filter((f) => !doHistorico.has(f.id));
  const problema = s.invalida || s.semFornecedor;

  return (
    <li className={`rp-linha${s.foraDoPedido ? " is-fora" : ""}${problema ? " has-problema" : ""}${s.alterada && !s.foraDoPedido && !problema ? " is-alterada" : ""}`} data-produto={item.productId}>
      <div className="rq-info">
        <strong className="rq-nome">{item.name}</strong>
        <span className="rq-meta">
          {item.code && <span>Cód. {item.code}</span>}
          <span>saiu {formatarQuantidade(item.withdrawn)} {unidade}</span>
          {item.balance != null && <span>saldo hoje {formatarQuantidade(item.balance)} {unidade}</span>}
          {item.estoqueMinimo != null && <span>mín. {formatarQuantidade(item.estoqueMinimo)}</span>}
        </span>
      </div>

      <div className="rq-controle">
        <button type="button" className="rq-passo" aria-label={`Diminuir ${item.name}`} disabled={s.quantidade <= 0} onClick={() => onMudar(item.productId, { quantity: somarPasso(decisao?.quantity ?? "", passo, -1) })}>
          <Minus size={18} aria-hidden />
        </button>
        <input
          className="rq-qtd"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          aria-label={`Quantidade a comprar de ${item.name}`}
          aria-invalid={s.invalida || undefined}
          value={decisao?.quantity ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onMudar(item.productId, { quantity: e.target.value })}
        />
        <button type="button" className="rq-passo" aria-label={`Aumentar ${item.name}`} onClick={() => onMudar(item.productId, { quantity: somarPasso(decisao?.quantity ?? "", passo, 1) })}>
          <Plus size={18} aria-hidden />
        </button>
        <span className="rp-unidade">{unidade}</span>
      </div>

      <div className="rp-detalhe">
        <label className="rp-fornecedor">
          <span className="rp-rotulo">Fornecedor</span>
          <select
            aria-label={`Fornecedor de ${item.name}`}
            value={decisao?.supplierId ?? ""}
            onChange={(e) => onMudar(item.productId, { supplierId: e.target.value || null })}
          >
            <option value="">Escolher fornecedor…</option>
            {item.supplierOptions.length > 0 && (
              <optgroup label="Já comprou deste item">
                {item.supplierOptions.map((o) => <option key={o.supplierId} value={o.supplierId}>{o.supplierName}</option>)}
              </optgroup>
            )}
            {outros.length > 0 && (
              <optgroup label="Outros fornecedores">
                {outros.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        <p className={`rq-status ${s.invalida ? "is-aviso" : s.semFornecedor ? "is-erro" : s.foraDoPedido ? "" : "is-ok"}`} role="status">
          {s.invalida
            ? "Quantidade inválida."
            : s.semFornecedor
              ? "Escolha o fornecedor ou deixe a quantidade vazia."
              : s.foraDoPedido
                ? "Fora do pedido."
                : s.total != null
                  ? <><Money value={s.preco ?? 0} />/{unidade} · total <b><Money value={s.total} /></b></>
                  : "Sem preço de referência deste fornecedor."}
        </p>

        {s.alterada && !s.invalida && (
          <button type="button" className="rq-tirar" onClick={() => onVoltarAoSugerido(item.productId)}>
            sugerido {formatarQuantidade(item.suggestedQuantity)} · voltar
          </button>
        )}
      </div>
    </li>
  );
}

/** Só a linha editada renderiza de novo: o pedido pode ter dezenas de itens. */
export const LinhaDoPedido = memo(LinhaDoPedidoBase);
