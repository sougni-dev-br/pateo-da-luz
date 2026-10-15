import { Trash2 } from "lucide-react";
import { Select } from "../../design-system";
import { formatarQuantidade } from "../desperdicio/quantidade";
import { normalizarUnidade } from "../../lib/fichaTecnica";
import { situacaoDaLinha, unidadesDaLinha, type LinhaDaRequisicao } from "./linhas";

type Props = {
  linha: LinhaDaRequisicao;
  /** undefined: item sem registro de saldo. null: saldos ainda não carregaram (não dá para julgar). */
  saldo: number | undefined | null;
  onQuantidade: (productId: string, valor: string) => void;
  onUnidade: (productId: string, valor: string) => void;
  onRemover: (productId: string) => void;
  onEnter: (productId: string) => void;
};

function Status({ linha, saldo }: Pick<Props, "linha" | "saldo">) {
  const base = normalizarUnidade(linha.stockUnit) || linha.unit;
  const situacao = situacaoDaLinha(linha, saldo === null ? Number.POSITIVE_INFINITY : saldo);
  const outraUnidade = normalizarUnidade(linha.unit) !== normalizarUnidade(base);

  if (situacao.tipo === "VAZIA") {
    return <p className="req-item-status">{saldo == null ? "Saldo indisponível" : `Saldo ${formatarQuantidade(saldo)} ${base}`}</p>;
  }
  if (situacao.tipo === "SEM_CONVERSAO") {
    return <p className="req-item-status is-aviso" role="alert">Não sei converter {linha.unit} para {base} neste item. Escolha outra unidade.</p>;
  }
  if (situacao.tipo === "FALTA") {
    return (
      <p className="req-item-status is-erro" role="alert">
        {saldo === undefined ? "Sem saldo em estoque" : `Faltam ${formatarQuantidade(situacao.falta)} ${base} (saldo ${formatarQuantidade(situacao.saldo)})`}
        {outraUnidade && ` · ${formatarQuantidade(Number(linha.quantity.replace(",", ".")))} ${linha.unit} = ${formatarQuantidade(situacao.emEstoque)} ${base}`}
      </p>
    );
  }
  return (
    <p className="req-item-status is-ok">
      {outraUnidade && `${formatarQuantidade(Number(linha.quantity.replace(",", ".")))} ${linha.unit} = ${formatarQuantidade(situacao.emEstoque)} ${base} · `}
      {saldo == null ? "Saldo indisponível" : `Saldo ${formatarQuantidade(situacao.saldo)} → fica com ${formatarQuantidade(situacao.ficaCom)} ${base}`}
    </p>
  );
}

export function LinhaDoItem({ linha, saldo, onQuantidade, onUnidade, onRemover, onEnter }: Props) {
  const situacao = situacaoDaLinha(linha, saldo === null ? Number.POSITIVE_INFINITY : saldo);
  const problema = situacao.tipo === "FALTA" || situacao.tipo === "SEM_CONVERSAO";
  const opcoes = unidadesDaLinha(linha).map((u) => ({ value: u, label: u }));

  return (
    <li className={`req-item${problema ? " has-problema" : ""}`} data-produto={linha.productId}>
      <div className="req-item-nome">
        <strong>{linha.productName}</strong>
        {linha.productCode && <small>Cód. {linha.productCode}</small>}
      </div>
      <input
        className="req-qty-input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="Qtd"
        aria-label={`Quantidade de ${linha.productName}`}
        aria-invalid={problema || undefined}
        value={linha.quantity}
        onChange={(e) => onQuantidade(linha.productId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter(linha.productId);
          }
        }}
      />
      <Select
        aria-label={`Unidade de ${linha.productName}`}
        value={linha.unit}
        options={opcoes}
        disabled={opcoes.length <= 1}
        onChange={(e) => onUnidade(linha.productId, e.target.value)}
        containerClassName="req-item-unidade"
      />
      <button type="button" className="req-item-remover" onClick={() => onRemover(linha.productId)} aria-label={`Remover ${linha.productName}`}>
        <Trash2 size={16} />
      </button>
      <Status linha={linha} saldo={saldo} />
    </li>
  );
}
