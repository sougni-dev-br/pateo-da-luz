import { Minus, Plus } from "lucide-react";
import { memo } from "react";
import type { RequisitionCatalogItem } from "../../api/client";
import { normalizarUnidade } from "../../lib/fichaTecnica";
import { formatarQuantidade } from "../desperdicio/quantidade";
import { linhaDe, passoDaUnidade, somarPasso, type Escolha } from "./catalogo";
import { situacaoDaLinha, unidadesDaLinha, type SituacaoDaLinha } from "./linhas";

type Props = {
  item: RequisitionCatalogItem;
  escolha: Escolha | undefined;
  onMudar: (item: RequisitionCatalogItem, parcial: Partial<Escolha>) => void;
  onTirar: (productId: string) => void;
  onProxima: (productId: string, direcao: 1 | -1) => void;
};

const MAXIMO_NO_SEGMENTADO = 3;

function Situacao({ item, situacao, escolha }: { item: RequisitionCatalogItem; situacao: SituacaoDaLinha; escolha: Escolha }) {
  const base = normalizarUnidade(item.unit) || escolha.unit;
  const trocouDeUnidade = normalizarUnidade(escolha.unit) !== normalizarUnidade(base);
  const digitado = `${escolha.quantity} ${escolha.unit}`;

  if (situacao.tipo === "SEM_CONVERSAO") {
    return <p className="rq-status is-aviso" role="status">Não sei converter {escolha.unit} para {base} neste item. Troque a unidade.</p>;
  }
  if (situacao.tipo === "FALTA") {
    return (
      <p className="rq-status is-erro" role="status">
        {item.balance <= 0 ? "Sem saldo em estoque." : `Faltam ${formatarQuantidade(situacao.falta)} ${base}.`}
        {trocouDeUnidade && ` ${digitado} = ${formatarQuantidade(situacao.emEstoque)} ${base}.`}
      </p>
    );
  }
  if (situacao.tipo === "OK") {
    return (
      <p className="rq-status is-ok">
        {trocouDeUnidade && <>{digitado} = <b>{formatarQuantidade(situacao.emEstoque)} {base}</b> · </>}
        fica com {formatarQuantidade(situacao.ficaCom)} {base}
      </p>
    );
  }
  if (escolha.quantity.trim() !== "") {
    return <p className="rq-status is-aviso" role="status">Digite uma quantidade maior que zero.</p>;
  }
  return null;
}

function SeletorDeUnidade({ item, valor, onEscolher }: { item: RequisitionCatalogItem; valor: string; onEscolher: (unidade: string) => void }) {
  const opcoes = unidadesDaLinha({ stockUnit: item.unit, conversions: item.conversions });
  if (opcoes.length <= 1) return <span className="rq-unidade-unica">{opcoes[0] ?? valor}</span>;
  if (opcoes.length <= MAXIMO_NO_SEGMENTADO) {
    return (
      <div className="rq-segmentos" role="group" aria-label={`Unidade de ${item.name}`}>
        {opcoes.map((u) => (
          <button key={u} type="button" aria-pressed={u === valor} className={u === valor ? "is-ativo" : undefined} onClick={() => onEscolher(u)}>{u}</button>
        ))}
      </div>
    );
  }
  return (
    <select className="rq-unidade-select" aria-label={`Unidade de ${item.name}`} value={valor} onChange={(e) => onEscolher(e.target.value)}>
      {opcoes.map((u) => <option key={u} value={u}>{u}</option>)}
    </select>
  );
}

function LinhaDoCatalogoBase({ item, escolha, onMudar, onTirar, onProxima }: Props) {
  const base = normalizarUnidade(item.unit) || "UN";
  const semSaldo = item.balance <= 0;
  const escolhida = escolha != null;
  const unidade = escolha?.unit ?? base;
  const passo = passoDaUnidade(unidade);
  const situacao = escolha ? situacaoDaLinha(linhaDe(item, escolha), item.balance) : null;
  const invalida = situacao?.tipo === "VAZIA" && (escolha?.quantity.trim() ?? "") !== "";
  const problema = situacao?.tipo === "FALTA" || situacao?.tipo === "SEM_CONVERSAO" || invalida;
  const bloqueada = semSaldo && !escolhida;

  return (
    <li
      className={`rq-linha${escolhida ? " is-escolhida" : ""}${problema ? " has-problema" : ""}${bloqueada ? " is-sem-saldo" : ""}`}
      data-produto={item.id}
    >
      <div className="rq-info">
        <strong className="rq-nome">{item.name}</strong>
        <span className="rq-meta">
          {item.code && <span>Cód. {item.code}</span>}
          <span className={`rq-saldo${semSaldo ? " is-zero" : ""}`}>{semSaldo ? "sem saldo" : `saldo ${formatarQuantidade(item.balance)} ${base}`}</span>
        </span>
      </div>

      <div className="rq-controle">
        <button
          type="button"
          className="rq-passo"
          aria-label={`Diminuir ${item.name}`}
          disabled={!escolhida}
          onClick={() => {
            if (!escolha) return;
            const proxima = somarPasso(escolha.quantity, passo, -1);
            if (proxima === "") onTirar(item.id);
            else onMudar(item, { quantity: proxima });
          }}
        >
          <Minus size={18} aria-hidden />
        </button>
        <input
          className="rq-qtd"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          placeholder="0"
          disabled={bloqueada}
          aria-label={`Quantidade de ${item.name}`}
          aria-invalid={problema || undefined}
          value={escolha?.quantity ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onMudar(item, { quantity: e.target.value })}
          onBlur={() => {
            // Campo deixado vazio: o produto sai da requisição (e a unidade escolhida volta ao padrão).
            if (escolha && escolha.quantity.trim() === "") onTirar(item.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "ArrowDown") {
              e.preventDefault();
              onProxima(item.id, 1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              onProxima(item.id, -1);
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="rq-passo"
          aria-label={`Aumentar ${item.name}`}
          disabled={bloqueada}
          onClick={() => onMudar(item, { quantity: somarPasso(escolha?.quantity ?? "", passo, 1) })}
        >
          <Plus size={18} aria-hidden />
        </button>
      </div>

      {escolha && situacao && (
        <div className="rq-detalhe">
          <SeletorDeUnidade item={item} valor={escolha.unit} onEscolher={(u) => onMudar(item, { unit: u })} />
          <Situacao item={item} situacao={situacao} escolha={escolha} />
          <button type="button" className="rq-tirar" onClick={() => onTirar(item.id)}>Tirar</button>
        </div>
      )}
    </li>
  );
}

/** Só a linha que mudou renderiza de novo: a lista tem centenas de produtos e cada tecla altera uma. */
export const LinhaDoCatalogo = memo(LinhaDoCatalogoBase);
