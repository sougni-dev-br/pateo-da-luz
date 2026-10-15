import { Minus, Plus, Tag } from "lucide-react";
import { memo } from "react";
import type { RequisitionPurchaseItem } from "../../api/client";
import { Money } from "../../design-system";
import { formatCurrencyString } from "../../utils/format";
import { formatarQuantidade } from "../desperdicio/quantidade";
import { passoDaUnidade, somarPasso } from "./catalogo";
import { recomendados, situacaoDoItem, type DecisaoDoItem } from "./pedido";

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
  const escolhido = decisao?.supplierId ?? null;
  const ranking = recomendados(item);
  // O mais barato só vira alerta quando não é o escolhido: quem já escolheu o menor preço não precisa ser avisado.
  const maisBarato = item.hasCheaperAlternative && item.bestPriceSupplierId && item.bestPriceSupplierId !== escolhido ? item : null;

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
        {ranking.length > 0 && (
          <div className="rp-recomendados" role="group" aria-label={`Fornecedores recomendados para ${item.name}, do menor preço`}>
            <span className="rp-rotulo">Recomendado pelo menor preço</span>
            <div className="rp-recomendados-lista">
              {ranking.map((opcao, indice) => (
                <button
                  key={opcao.supplierId}
                  type="button"
                  className={`rp-recomendado${escolhido === opcao.supplierId ? " is-ativo" : ""}`}
                  aria-pressed={escolhido === opcao.supplierId}
                  onClick={() => onMudar(item.productId, { supplierId: opcao.supplierId })}
                >
                  <strong>{opcao.supplierName}</strong>
                  <span><Money value={opcao.bestUnitPrice} />/{opcao.unit ?? unidade}{indice === 0 ? " · menor preço" : ""}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="rp-fornecedor">
          <span className="rp-rotulo">Fornecedor</span>
          <select
            aria-label={`Fornecedor de ${item.name}`}
            value={escolhido ?? ""}
            onChange={(e) => onMudar(item.productId, { supplierId: e.target.value || null })}
          >
            <option value="">Escolher fornecedor…</option>
            {item.supplierOptions.length > 0 && (
              <optgroup label="Já comprou deste item (menor preço primeiro)">
                {item.supplierOptions.map((o) => <option key={o.supplierId} value={o.supplierId}>{`${o.supplierName} — ${formatCurrencyString(o.bestUnitPrice)}`}</option>)}
              </optgroup>
            )}
            {outros.length > 0 && (
              <optgroup label="Outros fornecedores">
                {outros.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        {maisBarato && (
          <button type="button" className="rp-alerta" title={maisBarato.priceComparisonNote ?? undefined} onClick={() => onMudar(item.productId, { supplierId: maisBarato.bestPriceSupplierId })}>
            <Tag size={13} aria-hidden /> Menor preço: {maisBarato.bestPriceSupplierName} · <Money value={maisBarato.bestUnitPrice ?? 0} /> — usar
          </button>
        )}

        <p className={`rq-status ${s.invalida ? "is-aviso" : s.semFornecedor ? "is-erro" : s.foraDoPedido ? "" : "is-ok"}`} role="status">
          {s.invalida
            ? "Quantidade inválida."
            : s.semFornecedor
              ? "Escolha o fornecedor ou deixe a quantidade vazia."
              : s.foraDoPedido
                ? "Fora do pedido."
                : s.total != null
                  ? <><Money value={s.preco ?? 0} />/{unidade} · total <b><Money value={s.total} /></b></>
                  : "Sem histórico de preço deste item."}
        </p>

        {s.revisarUnidade && <p className="rq-status is-aviso" role="status">O preço do histórico pode ser da embalagem, não de {unidade}: revise a unidade antes de enviar.</p>}

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
