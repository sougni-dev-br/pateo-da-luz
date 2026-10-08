import { AlertTriangle, Check, CheckCircle2, ChevronDown, ClipboardList, Loader2, Pencil, RefreshCw, Search, Undo2, Wand2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ClasseConferencia,
  type ConferenciaDoInventario,
  type ItemDaConferencia,
  type MotivoDeConferencia,
  type NotaDoItemDaConferencia,
  type RecontagemDaConferencia,
  aplicarRecontagem,
  getComprasDoItemDaConferencia,
  getConferenciaDoInventario,
  marcarItemConferido,
  pedirRecontagem
} from "../../api/client";
import { Money, StatusBadge, type StatusTone } from "../../design-system";
import { formatDate } from "../../utils/format";
import { SEM_SETOR, type Situacao, estaConferido, filtrarConferencia, produtosParecidos, progressoDaConferencia, resumirItens } from "./conferencia-ajuda";
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
  /** Marcar conferido e pedir recontagem: so na revisao, por quem aprova. */
  podeConferir?: boolean;
  /** Recontagem aplicada mudou quantidades: o pai recarrega a lista de itens. */
  onRecontagemAplicada?: () => void;
};

export const ROTULO_DO_MOTIVO: Record<MotivoDeConferencia, string> = {
  CORRETO: "Está certo",
  COMPRA_NAO_LANCADA: "Compra não lançada",
  ERRO_DE_UNIDADE: "Erro de unidade",
  CORRIGIDO: "Corrigido",
  OUTRO: "Outro",
  RECONTAR: "Recontar"
};

// O que quem revisa escolhe no cartao. "Corrigido" e automatico ao salvar.
const MOTIVOS_DO_CARTAO: MotivoDeConferencia[] = ["CORRETO", "COMPRA_NAO_LANCADA", "ERRO_DE_UNIDADE", "RECONTAR"];

const SITUACOES: Array<{ valor: Situacao; rotulo: string }> = [
  { valor: "faltam", rotulo: "Faltam conferir" },
  { valor: "conferidos", rotulo: "Conferidos" },
  { valor: "todos", rotulo: "Todos" }
];

const VALORES_MINIMOS = [
  { valor: 0, rotulo: "Qualquer valor" },
  { valor: 50, rotulo: "A partir de R$ 50" },
  { valor: 500, rotulo: "A partir de R$ 500" }
];

export function ConferenciaInventario({ inventoryId, versao, onLocalizar, onCarregar, jaAprovado = false, podeCorrigir = false, podeConferir = false, onCorrigir, onRecontagemAplicada }: Props) {
  const [conferencia, setConferencia] = useState<ConferenciaDoInventario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [classe, setClasse] = useState<ClasseConferencia | null>(null);
  const [limite, setLimite] = useState(ITENS_POR_PAGINA);
  const [setor, setSetor] = useState("");
  const [valorMinimo, setValorMinimo] = useState(0);
  // Quem confere comeca no que falta; os demais, em tudo.
  const [situacao, setSituacao] = useState<Situacao>(podeConferir ? "faltam" : "todos");
  const [recontando, setRecontando] = useState(false);
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
    () => (conferencia
      ? filtrarConferencia(conferencia.itens, { setor, valorMinimo, situacao, limite: conferencia.limiteDeConferencia })
      : []),
    [conferencia, setor, valorMinimo, situacao]
  );
  const progresso = useMemo(
    () => (conferencia ? progressoDaConferencia(conferencia.itens, conferencia.limiteDeConferencia) : { exigidos: 0, conferidos: 0 }),
    [conferencia]
  );
  const paraRecontar = useMemo(
    () => (conferencia?.itens ?? []).filter((i) => i.conferido?.motivo === "RECONTAR" && !i.recontagemId),
    [conferencia]
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

  // Ao conferir tudo de uma classe (ou trocar o recorte), passa para a proxima
  // que ainda tem item — em vez de mostrar uma lista vazia.
  useEffect(() => {
    if (!conferencia || (classe && resumoDoRecorte[classe].itens > 0)) return;
    const proxima = ORDEM.find((c) => resumoDoRecorte[c].itens > 0);
    if (proxima && proxima !== classe) setClasse(proxima);
  }, [conferencia, classe, resumoDoRecorte]);

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
    if (salvou) {
      // Na revisao, corrigir e conferir: o item conta como visto.
      // O aviso vem depois da recarga, que limpa o erro anterior.
      let aviso: string | null = null;
      if (podeConferir) {
        await marcarItemConferido(inventoryId, item.itemId, "CORRIGIDO").catch(() => {
          aviso = `Quantidade de ${item.productName} salva, mas não foi possível marcar como conferido. Marque no cartão.`;
        });
      }
      await carregar();
      if (aviso) setErro(aviso);
    }
    if (salvou && proximo) {
      // O corrigido costuma sair da classe; o proximo sobe uma posicao. Garante
      // que ele esteja dentro da pagina mostrada.
      const indiceDoProximo = itensDaClasse.indexOf(proximo);
      if (indiceDoProximo >= limite) setLimite(indiceDoProximo + 1);
      setFocarItem(proximo.itemId);
    }
    return salvou;
  }

  async function marcar(item: ItemDaConferencia, motivo: MotivoDeConferencia | null, observacao?: string) {
    const posicao = itensDaClasse.findIndex((i) => i.itemId === item.itemId);
    const proximo = itensDaClasse[posicao + 1] ?? null;
    try {
      await marcarItemConferido(inventoryId, item.itemId, motivo, observacao);
      if (motivo && proximo && situacao === "faltam") setFocarItem(proximo.itemId);
      await carregar();
      return true;
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível marcar a conferência.");
      return false;
    }
  }

  async function mandarRecontar() {
    setRecontando(true);
    setErro(null);
    try {
      await pedirRecontagem(inventoryId);
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível pedir a recontagem.");
    } finally {
      setRecontando(false);
    }
  }

  async function aplicar(recontagem: RecontagemDaConferencia) {
    setRecontando(true);
    setErro(null);
    try {
      await aplicarRecontagem(inventoryId, recontagem.id);
      await carregar();
      onRecontagemAplicada?.();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível aplicar a recontagem.");
    } finally {
      setRecontando(false);
    }
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

      {alertas.length > 0 && progresso.exigidos > 0 && progresso.conferidos >= progresso.exigidos ? (
        <p className="conf-veredito conf-veredito--ok">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            <strong>Os alertas que pesam foram conferidos.</strong>
            {(() => {
              const opcionais = conferencia.itens.filter((i) => CLASSES_DE_ALERTA.includes(i.classe) && !estaConferido(i)).length;
              return opcionais > 0 ? ` Restam ${opcionais} alerta(s) abaixo de R$ ${conferencia.limiteDeConferencia}, de conferência opcional.` : "";
            })()}
          </span>
        </p>
      ) : alertas.length > 0 ? (
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

      {progresso.exigidos > 0 && (
        <div className="conf-progresso">
          <div className="conf-progresso__texto">
            <strong>{formatoQuantidade.format(progresso.conferidos)} de {formatoQuantidade.format(progresso.exigidos)} conferidos</strong>
            <span>
              {progresso.conferidos >= progresso.exigidos
                ? (jaAprovado ? "Tudo conferido." : "Tudo conferido: pode aprovar.")
                : `Exigem conferência os alertas a partir de R$ ${conferencia.limiteDeConferencia} e os sem custo.${jaAprovado ? "" : " A aprovação libera quando todos estiverem conferidos."}`}
            </span>
          </div>
          <div className="conf-progresso__barra" role="progressbar" aria-valuemin={0} aria-valuemax={progresso.exigidos} aria-valuenow={progresso.conferidos} aria-label="Conferidos">
            <span style={{ width: `${Math.round((progresso.conferidos / progresso.exigidos) * 100)}%` }} />
          </div>
        </div>
      )}

      <PainelDeRecontagem
        paraRecontar={paraRecontar.length}
        recontagens={conferencia.recontagens}
        podeAgir={podeConferir}
        ocupado={recontando}
        onPedir={() => void mandarRecontar()}
        onAplicar={(r) => void aplicar(r)}
      />

      <div className="conf-recorte">
        <label>
          <span>Situação</span>
          <select value={situacao} onChange={(e) => { setSituacao(e.target.value as Situacao); setLimite(ITENS_POR_PAGINA); }}>
            {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
          </select>
        </label>
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
            podeConferir={podeConferir}
            onMarcar={marcar}
            limiteDeConferencia={conferencia.limiteDeConferencia}
          />
        ))}
      </ul>

      {itensDaClasse.length === 0 && (
        <p className="conf-ajuda">
          {situacao === "faltam" && progresso.conferidos >= progresso.exigidos
            ? "Nada falta conferir. Use \"Situação: Todos\" para rever os itens."
            : "Nada nesta classe com o recorte atual."}
        </p>
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
  podeConferir: boolean;
  onCorrigir: (item: ItemDaConferencia, quantidade: string) => Promise<boolean>;
  onMarcar: (item: ItemDaConferencia, motivo: MotivoDeConferencia | null, observacao?: string) => Promise<boolean>;
  limiteDeConferencia: number;
};

function quantidadeParaCampo(valor: number | null) {
  return valor == null ? "" : String(valor).replace(".", ",");
}

// O cartao e onde se decide: a conta, o motivo, as notas que entraram, o
// produto vizinho que pode ter levado a contagem e o campo para corrigir. Antes
// cada correcao era localizar, trocar de aba, salvar e voltar procurando.
function LinhaDaConferencia({ inventoryId, item, todos, rotuloImpacto, onLocalizar, podeCorrigir, podeConferir, onCorrigir, onMarcar }: LinhaProps) {
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
    <li className={`conf-item conf-item--${CLASSES[item.classe].tom}${estaConferido(item) ? " conf-item--conferido" : ""}`}>
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

        <MarcacaoDoItem item={item} podeMarcar={podeConferir} onMarcar={onMarcar} />

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

type MarcacaoProps = {
  item: ItemDaConferencia;
  podeMarcar: boolean;
  onMarcar: (item: ItemDaConferencia, motivo: MotivoDeConferencia | null, observacao?: string) => Promise<boolean>;
};

// "Conferido" com motivo: o que tira o item da lista do que falta. Sem isso, um
// zerado que estava certo seguia como alerta para sempre.
function MarcacaoDoItem({ item, podeMarcar, onMarcar }: MarcacaoProps) {
  // A justificativa vale para qualquer motivo ("esta certo: a caixa estava
  // fechada no corredor"); so "Outro" exige texto.
  const [justificando, setJustificando] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(motivo: MotivoDeConferencia | null, observacao?: string) {
    setEnviando(true);
    try {
      const ok = await onMarcar(item, motivo, observacao);
      if (ok) { setJustificando(false); setTexto(""); }
    } finally {
      setEnviando(false);
    }
  }

  const campoDaJustificativa = (
    <input
      autoFocus
      value={texto}
      maxLength={500}
      placeholder="Por quê? Ex.: caixa fechada não foi vista na contagem anterior"
      aria-label={`Justificativa da conferência de ${item.productName}`}
      onChange={(e) => setTexto(e.target.value)}
    />
  );

  if (item.conferido) {
    const conferido = item.conferido;
    const recontar = conferido.motivo === "RECONTAR";
    return (
      <div className={`conf-marcado${recontar ? " conf-marcado--recontar" : ""}`}>
        {recontar ? <ClipboardList size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        <span>
          <strong>{recontar ? (item.recontagemId ? "Em recontagem" : "Marcado para recontar") : ROTULO_DO_MOTIVO[conferido.motivo]}</strong>
          {conferido.observacao && <> — {conferido.observacao}</>}
          {conferido.por && <small> · {conferido.por}{conferido.em ? `, ${formatoDataHora.format(new Date(conferido.em))}` : ""}</small>}
        </span>
        {podeMarcar && justificando && (
          <form className="conf-marcar__outro" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) void enviar(conferido.motivo, texto); }}>
            {campoDaJustificativa}
            <button type="submit" className="secondary-button" aria-label="Salvar justificativa" disabled={!texto.trim() || enviando}>Salvar</button>
          </form>
        )}
        {podeMarcar && !justificando && !recontar && (
          <button type="button" className="conf-marcado__desfazer" disabled={enviando} onClick={() => { setTexto(conferido.observacao ?? ""); setJustificando(true); }}>
            <Pencil size={13} aria-hidden="true" /> {conferido.observacao ? "Editar justificativa" : "Justificar"}
          </button>
        )}
        {podeMarcar && (
          <button type="button" className="conf-marcado__desfazer" disabled={enviando} onClick={() => void enviar(null)}>
            <Undo2 size={13} aria-hidden="true" /> Desfazer
          </button>
        )}
      </div>
    );
  }

  if (!podeMarcar) return null;

  const observacao = texto.trim() || undefined;
  return (
    <div className="conf-marcar" role="group" aria-label={`Conferir ${item.productName}`}>
      <span className="conf-marcar__rotulo">Conferido:</span>
      {MOTIVOS_DO_CARTAO.map((motivo) => (
        <button key={motivo} type="button" className={`conf-marcar__opcao conf-marcar__opcao--${motivo.toLowerCase()}`} disabled={enviando} onClick={() => void enviar(motivo, observacao)}>
          {ROTULO_DO_MOTIVO[motivo]}
        </button>
      ))}
      {justificando ? (
        <form className="conf-marcar__outro" onSubmit={(e) => { e.preventDefault(); if (observacao) void enviar("OUTRO", observacao); }}>
          {campoDaJustificativa}
          <button type="submit" className="secondary-button" disabled={!observacao || enviando}>Outro</button>
        </form>
      ) : (
        <button type="button" className="conf-marcar__opcao" disabled={enviando} onClick={() => setJustificando(true)}>Justificar…</button>
      )}
      {justificando && <small className="conf-marcar__dica">Escreva e escolha o motivo acima, ou "Outro".</small>}
    </div>
  );
}

type PainelDeRecontagemProps = {
  paraRecontar: number;
  recontagens: RecontagemDaConferencia[];
  podeAgir: boolean;
  ocupado: boolean;
  onPedir: () => void;
  onAplicar: (recontagem: RecontagemDaConferencia) => void;
};

// Os itens marcados "recontar" viram uma contagem para o estoquista; quando
// ela e concluida, "Aplicar" traz as quantidades de volta para o inventario.
function PainelDeRecontagem({ paraRecontar, recontagens, podeAgir, ocupado, onPedir, onAplicar }: PainelDeRecontagemProps) {
  const pendentes = recontagens.filter((r) => !r.aplicada);
  if (paraRecontar === 0 && pendentes.length === 0) return null;
  return (
    <div className="conf-recontagem">
      {paraRecontar > 0 && (
        <div className="conf-recontagem__linha">
          <span>
            <strong>{paraRecontar} {paraRecontar === 1 ? "item marcado" : "itens marcados"} para recontar.</strong>{" "}
            A recontagem mede o estoque de hoje, não o do dia da contagem: use para item de pouco giro.
          </span>
          {podeAgir && (
            <button type="button" className="primary-button" disabled={ocupado} onClick={onPedir}>
              {ocupado ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ClipboardList size={14} aria-hidden="true" />}
              Pedir recontagem
            </button>
          )}
        </div>
      )}
      {pendentes.map((r) => (
        <div key={r.id} className="conf-recontagem__linha">
          {r.status === "CONCLUIDA" ? (
            <>
              <span><strong>Recontagem {r.code} concluída</strong> — {r.itens} {r.itens === 1 ? "item" : "itens"}. Aplique para trazer as quantidades para este inventário.</span>
              {podeAgir && (
                <button type="button" className="primary-button" disabled={ocupado} onClick={() => onAplicar(r)}>
                  {ocupado && <Loader2 size={14} className="spin" aria-hidden="true" />}
                  Aplicar recontagem
                </button>
              )}
            </>
          ) : (
            <span>
              <strong>Recontagem {r.code}</strong> aguardando o estoquista em Contagem de Estoque — {r.contados} de {r.itens} contados.
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
