import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Search, Wand2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ClasseConferencia,
  type ConferenciaDoInventario,
  type ItemDaConferencia,
  type NotaDoItemDaConferencia,
  getComprasDoItemDaConferencia,
  getConferenciaDoInventario
} from "../../api/client";
import { Money, StatusBadge, type StatusTone } from "../../design-system";
import { formatDate } from "../../utils/format";
import { SEM_SETOR, filtrarConferencia, produtosParecidos, resumirItens } from "./conferencia-ajuda";
import { quantityToApi, sanitizeQuantityInput } from "./shared";
import "./conferencia.css";

const formatoDataHora = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

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
  /** Inventario ja aprovado: os alertas ja estao na base do CMV. */
  jaAprovado?: boolean;
  /** Corrigir a quantidade no proprio cartao (rascunho, ou revisao para quem aprova). */
  podeCorrigir?: boolean;
  /** Salva a quantidade; devolve false se nao salvou (o pai ja avisou o motivo). */
  onCorrigir?: (item: ItemDaConferencia, quantidade: string) => Promise<boolean>;
};

const VALORES_MINIMOS = [
  { valor: 0, rotulo: "Qualquer valor" },
  { valor: 50, rotulo: "A partir de R$ 50" },
  { valor: 500, rotulo: "A partir de R$ 500" }
];

export function ConferenciaInventario({ inventoryId, versao, onLocalizar, onCarregar, jaAprovado = false, podeCorrigir = false, onCorrigir }: Props) {
  const [conferencia, setConferencia] = useState<ConferenciaDoInventario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [classe, setClasse] = useState<ClasseConferencia | null>(null);
  const [limite, setLimite] = useState(ITENS_POR_PAGINA);
  const [setor, setSetor] = useState("");
  const [valorMinimo, setValorMinimo] = useState(0);
  // Depois de corrigir, o cursor vai para o proximo item da lista (que pode ter
  // mudado de lugar na recarga).
  const [focarItem, setFocarItem] = useState<string | null>(null);
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

  const filtrados = useMemo(
    () => (conferencia ? filtrarConferencia(conferencia.itens, { setor, valorMinimo }) : []),
    [conferencia, setor, valorMinimo]
  );
  const resumoDoRecorte = useMemo(() => resumirItens(filtrados), [filtrados]);
  const setores = useMemo(
    () => [...new Set((conferencia?.itens ?? []).map((i) => i.sectorName ?? SEM_SETOR))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [conferencia]
  );
  const itensDaClasse = useMemo(
    () => (classe ? filtrados.filter((item) => item.classe === classe) : []),
    [filtrados, classe]
  );

  useEffect(() => {
    if (!focarItem || carregando) return;
    const campo = document.querySelector<HTMLInputElement>(`[data-conf-input="${focarItem}"]`);
    if (campo) {
      campo.focus();
      campo.select();
      campo.scrollIntoView({ block: "center" });
    }
    setFocarItem(null);
  }, [focarItem, carregando, itensDaClasse]);

  async function corrigir(item: ItemDaConferencia, quantidade: string) {
    if (!onCorrigir) return false;
    const posicao = itensDaClasse.findIndex((i) => i.itemId === item.itemId);
    // Sem proximo, volta ao primeiro que sobrou na lista.
    const proximo = itensDaClasse[posicao + 1] ?? itensDaClasse.find((i) => i.itemId !== item.itemId) ?? null;
    const salvou = await onCorrigir(item, quantidade);
    if (salvou && proximo) {
      // O corrigido costuma sair da classe; o proximo sobe uma posicao. Garante
      // que ele esteja dentro da pagina mostrada.
      const indiceDoProximo = itensDaClasse.indexOf(proximo);
      if (indiceDoProximo >= limite) setLimite(indiceDoProximo + 1);
      setFocarItem(proximo.itemId);
    }
    return salvou;
  }

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
            {jaAprovado ? ". Esses números já estão na base do CMV: corrigir exige reabrir o inventário." : ". Confira antes de aprovar."}
          </span>
        </p>
      ) : (
        <p className="conf-veredito conf-veredito--ok">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>Nenhum item impossível ou zerado suspeito.</span>
        </p>
      )}
      {erro && <p className="conf-estado conf-estado--erro" role="alert">{erro}</p>}

      <div className="conf-recorte">
        <label>
          <span>Setor</span>
          <select value={setor} onChange={(e) => { setSetor(e.target.value); setLimite(ITENS_POR_PAGINA); }}>
            <option value="">Todos os setores</option>
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          <span>Valor</span>
          <select value={valorMinimo} onChange={(e) => { setValorMinimo(Number(e.target.value)); setLimite(ITENS_POR_PAGINA); }}>
            {VALORES_MINIMOS.map((v) => <option key={v.valor} value={v.valor}>{v.rotulo}</option>)}
          </select>
        </label>
        {(setor || valorMinimo > 0) && (
          <button type="button" className="conf-recorte__limpar" onClick={() => { setSetor(""); setValorMinimo(0); }}>
            Mostrando {formatoQuantidade.format(filtrados.length)} de {formatoQuantidade.format(conferencia.itens.length)} · limpar
          </button>
        )}
      </div>

      <div className="conf-classes" role="group" aria-label="Filtrar por resultado da conferência">
        {ORDEM.map((c) => {
          const { itens, impacto } = resumoDoRecorte[c];
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
          <LinhaDaConferencia
            key={item.itemId}
            inventoryId={inventoryId}
            item={item}
            todos={conferencia.itens}
            rotuloImpacto={descricao?.impacto ?? ""}
            onLocalizar={onLocalizar}
            podeCorrigir={podeCorrigir && Boolean(onCorrigir)}
            onCorrigir={corrigir}
          />
        ))}
      </ul>

      {itensDaClasse.length === 0 && classe && (
        <p className="conf-ajuda">Nada nesta classe com o recorte atual.</p>
      )}

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
        <h4 id="conf-titulo" className="conf-sr">Conferência</h4>
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
  inventoryId: string;
  item: ItemDaConferencia;
  todos: ItemDaConferencia[];
  rotuloImpacto: string;
  onLocalizar: (item: ItemDaConferencia) => void;
  podeCorrigir: boolean;
  onCorrigir: (item: ItemDaConferencia, quantidade: string) => Promise<boolean>;
};

function quantidadeParaCampo(valor: number | null) {
  return valor == null ? "" : String(valor).replace(".", ",");
}

// O cartao e onde se decide: a conta, o motivo, as notas que entraram, o
// produto vizinho que pode ter levado a contagem e o campo para corrigir. Antes
// cada correcao era localizar, trocar de aba, salvar e voltar procurando.
function LinhaDaConferencia({ inventoryId, item, todos, rotuloImpacto, onLocalizar, podeCorrigir, onCorrigir }: LinhaProps) {
  const u = item.unit;
  const temConta = item.anterior != null;
  const [valor, setValor] = useState(quantidadeParaCampo(item.contado));
  const [salvando, setSalvando] = useState(false);
  const [notasAbertas, setNotasAbertas] = useState(false);
  const campo = useRef<HTMLInputElement | null>(null);
  // O valor pode mudar por fora (aba Itens, outra pessoa). Acompanha o novo
  // valor salvo, mas nao atropela o que a pessoa estiver digitando.
  const base = useRef(quantidadeParaCampo(item.contado));
  useEffect(() => {
    const novo = quantidadeParaCampo(item.contado);
    setValor((atual) => (atual === base.current ? novo : atual));
    base.current = novo;
  }, [item.contado]);
  const parecidos = useMemo(
    () => (item.classe === "ZERADO_SUSPEITO" || item.classe === "SEM_REFERENCIA" ? produtosParecidos(item, todos) : []),
    [item, todos]
  );
  // Compara numero, nao texto: "12,50" e o 12,5 salvo sao a mesma coisa.
  const normalizado = quantityToApi(valor);
  const mudou = normalizado === undefined
    ? valor.trim() !== ""
    : normalizado === "" ? item.contado != null : Number(normalizado) !== item.contado;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!mudou || salvando) return;
    setSalvando(true);
    try {
      await onCorrigir(item, valor);
    } finally {
      setSalvando(false);
    }
  }

  function usarSugestao() {
    if (!item.sugestao) return;
    setValor(quantidadeParaCampo(item.sugestao.quantidade));
    campo.current?.focus();
  }

  return (
    <li className={`conf-item conf-item--${CLASSES[item.classe].tom}`}>
      <div className="conf-item__produto">
        <strong>{item.productName}</strong>
        <small>{[item.productCode, item.sectorName].filter(Boolean).join(" · ") || "sem código"}</small>
        {item.contadoPor && (
          <small className="conf-item__quem">
            Contado por {item.contadoPor}{item.contadoEm ? ` em ${formatoDataHora.format(new Date(item.contadoEm))}` : ""}
          </small>
        )}
      </div>

      <dl className="conf-conta">
        {temConta && (
          <>
            <div title={[item.anteriorCodigo, item.anteriorData ? formatDate(item.anteriorData) : null].filter(Boolean).join(" · ")}>
              <dt>Anterior</dt>
              <dd>{qtd(item.anterior, u)}</dd>
            </div>
            <span className="conf-conta__sinal" aria-hidden="true">+</span>
            <div><dt>Compras</dt><dd>{qtd(item.compras, u)}</dd></div>
            <span className="conf-conta__sinal" aria-hidden="true">=</span>
            <div><dt>Disponível</dt><dd>{qtd(item.disponivel, u)}</dd></div>
            <span className="conf-conta__sinal" aria-hidden="true">→</span>
          </>
        )}
        <div className="conf-conta__contado"><dt>Contado</dt><dd>{qtd(item.contado, u)}</dd></div>
      </dl>

      <div className="conf-item__impacto">
        {item.impacto != null && rotuloImpacto ? (
          <>
            <Money value={item.impacto} />
            <small>{rotuloImpacto}</small>
          </>
        ) : <small>sem custo</small>}
      </div>

      <div className="conf-item__acoes">
        {podeCorrigir && (
          <form className="conf-corrigir" onSubmit={(e) => void salvar(e)}>
            <label className="conf-sr" htmlFor={`conf-qtd-${item.itemId}`}>Quantidade certa de {item.productName}</label>
            <input
              ref={campo}
              id={`conf-qtd-${item.itemId}`}
              data-conf-input={item.itemId}
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(sanitizeQuantityInput(e.target.value))}
              aria-describedby={`conf-motivo-${item.itemId}`}
            />
            {u && <span className="conf-corrigir__unidade">{u}</span>}
            <button type="submit" className={mudou ? "primary-button" : "secondary-button"} disabled={!mudou || salvando}>
              {salvando && <Loader2 size={14} className="spin" aria-hidden="true" />}
              Salvar
            </button>
          </form>
        )}
        <button
          type="button"
          className="icon-button conf-item__localizar"
          aria-label={`Localizar ${item.productName} na lista`}
          title="Abrir na lista de itens (observação, setor)"
          onClick={() => onLocalizar(item)}
        >
          <Search size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="conf-item__detalhes">
        <p className="conf-item__motivo" id={`conf-motivo-${item.itemId}`}>
          {item.motivo}
          {temConta && item.anteriorCodigo && (
            <span className="conf-item__origem"> Contagem anterior: {item.anteriorCodigo}{item.anteriorData ? `, ${formatDate(item.anteriorData)}` : ""}.</span>
          )}
        </p>

        {item.sugestao && podeCorrigir && (
          <button type="button" className="conf-sugestao" onClick={usarSugestao}>
            <Wand2 size={14} aria-hidden="true" />
            Usar {quantidadeParaCampo(item.sugestao.quantidade)}{u ? ` ${u}` : ""} ({formatoQuantidade.format(item.contado ?? 0)} ÷ embalagem de {formatoQuantidade.format(item.sugestao.embalagem)})
          </button>
        )}

        {parecidos.length > 0 && (
          <p className="conf-parecidos">
            <strong>Contado em produto parecido?</strong>{" "}
            {parecidos.map((p, i) => (
              <span key={p.itemId}>
                {i > 0 && " · "}
                {p.productName} — {qtd(p.contado, p.unit)}
              </span>
            ))}
          </p>
        )}

        {item.compras > 0 && (
          <NotasDoPeriodo inventoryId={inventoryId} itemId={item.itemId} aberto={notasAbertas} onAlternar={() => setNotasAbertas((v) => !v)} />
        )}
      </div>
    </li>
  );
}

type NotasProps = { inventoryId: string; itemId: string; aberto: boolean; onAlternar: () => void };

function NotasDoPeriodo({ inventoryId, itemId, aberto, onAlternar }: NotasProps) {
  const [notas, setNotas] = useState<NotaDoItemDaConferencia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || notas) return;
    let vivo = true;
    getComprasDoItemDaConferencia(inventoryId, itemId)
      .then((resultado) => { if (vivo) setNotas(resultado); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Não foi possível carregar as notas."); });
    return () => { vivo = false; };
  }, [aberto, notas, inventoryId, itemId]);

  let conteudo = null;
  if (aberto) {
    if (erro) conteudo = <p className="conf-estado conf-estado--erro" role="alert">{erro}</p>;
    else if (!notas) conteudo = <p className="conf-estado" role="status"><Loader2 size={14} className="spin" aria-hidden="true" /> Carregando…</p>;
    else if (notas.length === 0) conteudo = <p className="conf-ajuda">Nenhuma nota no período.</p>;
    else conteudo = (
      <table className="conf-notas__tabela">
        <thead><tr><th>Data</th><th>Nota</th><th>Fornecedor</th><th>Quantidade</th><th>Valor</th></tr></thead>
        <tbody>
          {notas.map((n, i) => (
            <tr key={`${n.purchaseId}-${i}`}>
              <td>{formatDate(n.data)}</td>
              <td>{n.notaFiscal ? `NF ${n.notaFiscal}` : n.numero ?? "—"}</td>
              <td>{n.fornecedor ?? "—"}</td>
              <td>
                {formatoQuantidade.format(n.quantidade)} {n.unidade ?? ""}
                {n.quantidadeConvertida != null && n.unidadeConvertida && (
                  <small> = {formatoQuantidade.format(n.quantidadeConvertida)} {n.unidadeConvertida}</small>
                )}
              </td>
              <td>{n.valor != null ? <Money value={n.valor} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="conf-notas">
      <button type="button" className="conf-notas__abrir" aria-expanded={aberto} onClick={onAlternar}>
        <ChevronDown size={14} aria-hidden="true" className={aberto ? "conf-notas__seta--aberta" : undefined} />
        Notas de compra do período
      </button>
      {conteudo}
    </div>
  );
}
