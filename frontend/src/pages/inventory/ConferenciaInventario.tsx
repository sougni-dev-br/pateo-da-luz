import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ClasseConferencia,
  type ConferenciaDoInventario,
  type ItemDaConferencia,
  getConferenciaDoInventario
} from "../../api/client";
import { Money, StatusBadge, type StatusTone } from "../../design-system";
import { formatDate } from "../../utils/format";
import "./conferencia.css";

// A conferencia nao compara com o "saldo esperado" do sistema: esse saldo so
// soma compras e nunca baixa, entao 38% dos itens apareciam divergentes e
// nenhum dizia por que. Aqui cada item e lido contra a ultima contagem aprovada
// mais as compras recebidas desde entao, e a lista abre no que precisa de acao.

type DescricaoDaClasse = {
  rotulo: string;
  singular: string;
  plural: string;
  ajuda: string;
  /** O que o valor em R$ da linha mede nesta classe. */
  impacto: string;
  tom: "perigo" | "atencao" | "neutro" | "ok";
};

const CLASSES: Record<ClasseConferencia, DescricaoDaClasse> = {
  IMPOSSIVEL: {
    rotulo: "Impossíveis", singular: "impossível", plural: "impossíveis",
    ajuda: "Contou mais do que havia: erro de contagem, de unidade ou compra não lançada.",
    impacto: "sem origem", tom: "perigo"
  },
  ZERADO_SUSPEITO: {
    rotulo: "Zerados suspeitos", singular: "zerado suspeito", plural: "zerados suspeitos",
    ajuda: "Contado como zero, mas havia estoque ou entrou compra no período.",
    impacto: "havia", tom: "perigo"
  },
  FORA_DO_HISTORICO: {
    rotulo: "Fora do histórico", singular: "fora do histórico", plural: "fora do histórico",
    ajuda: "Possível, mas muito acima ou abaixo do que este produto costuma ter.",
    impacto: "desvio", tom: "atencao"
  },
  SEM_REFERENCIA: {
    rotulo: "Sem referência", singular: "sem referência", plural: "sem referência",
    ajuda: "Produto sem contagem aprovada anterior: não há com o que comparar.",
    impacto: "contado", tom: "neutro"
  },
  PENDENTE: {
    rotulo: "Pendentes", singular: "pendente", plural: "pendentes",
    ajuda: "Ainda sem quantidade lançada.",
    impacto: "", tom: "neutro"
  },
  COERENTE: {
    rotulo: "Coerentes", singular: "coerente", plural: "coerentes",
    ajuda: "Contado dentro do que havia. O valor é o consumo do período.",
    impacto: "consumido", tom: "ok"
  }
};

const ORDEM: ClasseConferencia[] = ["IMPOSSIVEL", "ZERADO_SUSPEITO", "FORA_DO_HISTORICO", "SEM_REFERENCIA", "PENDENTE", "COERENTE"];
const CLASSES_DE_ALERTA: ClasseConferencia[] = ["IMPOSSIVEL", "ZERADO_SUSPEITO"];
const ITENS_POR_PAGINA = 10;

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function qtd(valor: number | null, unidade: string | null): string {
  if (valor == null) return "—";
  const numero = formatoQuantidade.format(valor);
  return unidade ? `${numero} ${unidade}` : numero;
}

function contar(n: number, classe: ClasseConferencia): string {
  const d = CLASSES[classe];
  return `${formatoQuantidade.format(n)} ${n === 1 ? d.singular : d.plural}`;
}

function classeInicial(conferencia: ConferenciaDoInventario): ClasseConferencia {
  return ORDEM.find((classe) => classe !== "COERENTE" && conferencia.resumo[classe].itens > 0) ?? "COERENTE";
}

type Props = {
  inventoryId: string;
  /** Muda quando as quantidades foram salvas, para a conferencia recalcular. */
  versao?: string | number;
  onLocalizar: (item: ItemDaConferencia) => void;
  /** Avisa o pai a cada carga: a tabela e o assistente de aprovacao usam o resultado. */
  onCarregar?: (conferencia: ConferenciaDoInventario) => void;
};

export function ConferenciaInventario({ inventoryId, versao, onLocalizar, onCarregar }: Props) {
  const [conferencia, setConferencia] = useState<ConferenciaDoInventario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [classe, setClasse] = useState<ClasseConferencia | null>(null);
  const [limite, setLimite] = useState(ITENS_POR_PAGINA);
  // Salvar duas vezes seguidas dispara duas cargas; so a ultima vale.
  const ultimaCarga = useRef(0);
  const onCarregarRef = useRef(onCarregar);
  onCarregarRef.current = onCarregar;

  const carregar = useCallback(async () => {
    const esta = ++ultimaCarga.current;
    setCarregando(true);
    setErro(null);
    try {
      const resultado = await getConferenciaDoInventario(inventoryId);
      if (esta !== ultimaCarga.current) return;
      setConferencia(resultado);
      setClasse((atual) => (atual && resultado.resumo[atual].itens > 0 ? atual : classeInicial(resultado)));
      onCarregarRef.current?.(resultado);
    } catch (error) {
      if (esta !== ultimaCarga.current) return;
      setErro(error instanceof Error ? error.message : "Não foi possível conferir o inventário.");
    } finally {
      if (esta === ultimaCarga.current) setCarregando(false);
    }
  }, [inventoryId]);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  const itensDaClasse = useMemo(
    () => (conferencia && classe ? conferencia.itens.filter((item) => item.classe === classe) : []),
    [conferencia, classe]
  );

  function escolher(proxima: ClasseConferencia) {
    setClasse(proxima);
    setLimite(ITENS_POR_PAGINA);
  }

  if (!conferencia) {
    return (
      <section className="conf" aria-labelledby="conf-titulo">
        <CabecalhoDaConferencia carregando={carregando} onAtualizar={carregar} />
        {carregando && <p className="conf-estado" role="status"><Loader2 size={16} className="spin" aria-hidden="true" /> Conferindo os itens…</p>}
        {erro && (
          <p className="conf-estado conf-estado--erro" role="alert">
            {erro}
            <button type="button" className="secondary-button" onClick={() => void carregar()}>Tentar de novo</button>
          </p>
        )}
      </section>
    );
  }

  const alertas = CLASSES_DE_ALERTA.filter((c) => conferencia.resumo[c].itens > 0);
  const descricao = classe ? CLASSES[classe] : null;

  return (
    <section className="conf" aria-labelledby="conf-titulo">
      <CabecalhoDaConferencia carregando={carregando} onAtualizar={carregar} />

      {alertas.length > 0 ? (
        <p className="conf-veredito conf-veredito--alerta">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            {/* Cada valor com o que ele mede: "sem origem" e "havia" nao se somam. */}
            {alertas.map((c, indice) => (
              <span key={c}>
                {indice > 0 && " e "}
                <strong>{contar(conferencia.resumo[c].itens, c)}</strong>
                {conferencia.resumo[c].impacto > 0 && <> (<Money value={conferencia.resumo[c].impacto} decimals={0} /> {CLASSES[c].impacto})</>}
              </span>
            ))}
            . Confira antes de aprovar.
          </span>
        </p>
      ) : (
        <p className="conf-veredito conf-veredito--ok">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Nenhum item impossível ou zerado suspeito.</span>
        </p>
      )}
      {erro && <p className="conf-estado conf-estado--erro" role="alert">{erro}</p>}

      <div className="conf-classes" role="group" aria-label="Filtrar por resultado da conferência">
        {ORDEM.map((c) => {
          const { itens, impacto } = conferencia.resumo[c];
          return (
            <button
              key={c}
              type="button"
              className={`conf-classe conf-classe--${CLASSES[c].tom}`}
              aria-pressed={classe === c}
              disabled={itens === 0}
              onClick={() => escolher(c)}
            >
              <span className="conf-classe__rotulo">{CLASSES[c].rotulo}</span>
              <strong className="conf-classe__total">{formatoQuantidade.format(itens)}</strong>
              {impacto > 0 && c !== "PENDENTE" && <Money className="conf-classe__valor" value={impacto} decimals={0} />}
            </button>
          );
        })}
      </div>

      {descricao && <p className="conf-ajuda">{descricao.ajuda}</p>}

      <ul className="conf-lista">
        {itensDaClasse.slice(0, limite).map((item) => (
          <LinhaDaConferencia key={item.itemId} item={item} rotuloImpacto={descricao?.impacto ?? ""} onLocalizar={onLocalizar} />
        ))}
      </ul>

      {itensDaClasse.length > limite && (
        <button type="button" className="secondary-button conf-mais" onClick={() => setLimite((atual) => atual + ITENS_POR_PAGINA)}>
          Mostrar mais {Math.min(ITENS_POR_PAGINA, itensDaClasse.length - limite)} de {itensDaClasse.length - limite} restantes
        </button>
      )}
    </section>
  );
}

function CabecalhoDaConferencia({ carregando, onAtualizar }: { carregando: boolean; onAtualizar: () => void }) {
  return (
    <header className="conf-cabecalho">
      <div>
        <h4 id="conf-titulo">Conferência</h4>
        <p>Cada item comparado com a última contagem aprovada mais as compras recebidas desde então.</p>
      </div>
      <button type="button" className="icon-button" aria-label="Atualizar conferência" title="Atualizar conferência" disabled={carregando} onClick={onAtualizar}>
        <RefreshCw size={15} className={carregando ? "spin" : undefined} />
      </button>
    </header>
  );
}

const TOM_DO_SELO: Record<DescricaoDaClasse["tom"], StatusTone> = {
  perigo: "danger",
  atencao: "warning",
  neutro: "neutral",
  ok: "success"
};

/** Selo da tabela de lancamento: a classe do item, com o motivo no hover. */
export function SeloDaConferencia({ item }: { item: ItemDaConferencia | undefined }) {
  if (!item) return <span className="conf-selo-vazio">—</span>;
  const d = CLASSES[item.classe];
  return (
    <span className="conf-selo" title={item.motivo}>
      <StatusBadge tone={TOM_DO_SELO[d.tom]}>{d.singular}</StatusBadge>
      <span className="conf-sr">{item.motivo}</span>
    </span>
  );
}

type LinhaProps = {
  item: ItemDaConferencia;
  rotuloImpacto: string;
  onLocalizar: (item: ItemDaConferencia) => void;
};

function LinhaDaConferencia({ item, rotuloImpacto, onLocalizar }: LinhaProps) {
  const u = item.unit;
  const temConta = item.anterior != null;
  return (
    <li className={`conf-item conf-item--${CLASSES[item.classe].tom}`}>
      <div className="conf-item__topo">
        <div className="conf-item__produto">
          <strong>{item.productName}</strong>
          <small>{[item.productCode, item.sectorName].filter(Boolean).join(" · ") || "sem código"}</small>
        </div>
        {item.impacto != null && rotuloImpacto && (
          <div className="conf-item__impacto">
            <Money value={item.impacto} />
            <small>{rotuloImpacto}</small>
          </div>
        )}
      </div>

      <dl className="conf-conta">
        {temConta && (
          <>
            <div>
              <dt>Anterior</dt>
              <dd>{qtd(item.anterior, u)}</dd>
              <small>{[item.anteriorCodigo, item.anteriorData ? formatDate(item.anteriorData) : null].filter(Boolean).join(" · ")}</small>
            </div>
            <div className="conf-conta__op"><dt>Compras</dt><dd>+ {qtd(item.compras, u)}</dd></div>
            <div className="conf-conta__op"><dt>Disponível</dt><dd>{qtd(item.disponivel, u)}</dd></div>
          </>
        )}
        <div className="conf-conta__contado"><dt>Contado</dt><dd>{qtd(item.contado, u)}</dd></div>
      </dl>

      <p className="conf-item__motivo">{item.motivo}</p>

      <button
        type="button"
        className="secondary-button conf-item__localizar"
        aria-label={`Localizar ${item.productName} na lista`}
        onClick={() => onLocalizar(item)}
      >
        <Search size={14} aria-hidden="true" /> Localizar na lista
      </button>
    </li>
  );
}
