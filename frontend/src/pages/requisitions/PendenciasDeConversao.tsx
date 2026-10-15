import { CheckCircle2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  cadastrarConversao,
  getConversoesPendentes,
  getRequisitionCatalog,
  getUnits,
  type PendenciaDeConversao,
  type ProdutoComPendenciaDeConversao,
  type RequisitionCatalogItem,
  type UnitMeasure
} from "../../api/client";
import { Button, Money } from "../../design-system";
import { formatarQuantidade } from "../desperdicio/quantidade";
import { normalizarBusca } from "./catalogo";

type Props = {
  /** Produto que a pessoa pediu para converter a partir da requisição ("+ unidade" na linha). */
  produtoInicial: { id: string; nome: string; unidade: string | null } | null;
  /** Avisa que uma conversão entrou: a lista de produtos da requisição precisa ser recarregada. */
  onCadastrada: (mensagem: string) => void;
};

const ROTULO_DA_ORIGEM: Record<PendenciaDeConversao["origem"], string> = {
  COMPRA: "Já foi comprado nessa unidade",
  CADASTRO: "É a unidade de compra do cadastro",
  NOME_PECA: "O nome diz peça: quanto pesa 1 peça?"
};

/** Peça é a UN do sistema: a tela diz isso para ninguém procurar uma unidade "PEÇA" que não existe. */
const nomeDaUnidade = (unidade: string) => (unidade === "UN" ? "UN (unidade ou peça)" : unidade);

const fatorEmTexto = (valor: number) => String(valor).replace(".", ",");

type FormularioProps = {
  produtoId: string;
  contagem: string;
  unidade: string;
  sugestao: number | null;
  rotuloDaSugestao?: string;
  aoSalvar: (mensagem: string) => void;
};

function FormularioDaConversao({ produtoId, contagem, unidade, sugestao, rotuloDaSugestao, aoSalvar }: FormularioProps) {
  const [fator, setFator] = useState(sugestao != null ? fatorEmTexto(sugestao) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await cadastrarConversao({ productId: produtoId, fromUnit: unidade, factor: fator });
      aoSalvar(`1 ${r.conversao.fromUnit} = ${formatarQuantidade(r.conversao.factor)} ${r.conversao.toUnit} cadastrada${r.comprasConvertidas > 0 ? ` · ${r.comprasConvertidas} compras convertidas` : ""}.`);
    } catch (falha) {
      setErro(falha instanceof ApiError || falha instanceof Error ? falha.message : "Não foi possível cadastrar a conversão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="cv-form">
      <span className="cv-igual">1 {nomeDaUnidade(unidade)} =</span>
      <input
        className="cv-fator"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,0"
        aria-label={`Quanto vale 1 ${unidade} em ${contagem}`}
        value={fator}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setFator(e.target.value); setErro(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void salvar(); } }}
      />
      <span className="cv-igual">{contagem}</span>
      <Button variant="primary" leadingIcon={<CheckCircle2 size={14} />} disabled={salvando || fator.trim() === ""} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
      {sugestao != null && rotuloDaSugestao && <small className="cv-sugestao">{rotuloDaSugestao}</small>}
      {erro && <p className="req-banner is-erro cv-erro" role="alert"><span>{erro}</span></p>}
    </div>
  );
}

function CartaoDoProduto({ produto, aoSalvar }: { produto: ProdutoComPendenciaDeConversao; aoSalvar: (mensagem: string) => void }) {
  return (
    <li className="cv-cartao" data-produto={produto.productId}>
      <div className="cv-topo">
        <strong>{produto.nome}</strong>
        <span className="muted">
          {produto.codigo ? `Cód. ${produto.codigo} · ` : ""}estoque em {produto.unidadeDeContagem}
          {produto.saldo != null ? ` · saldo ${formatarQuantidade(produto.saldo)} ${produto.unidadeDeContagem}` : ""}
        </span>
      </div>
      {produto.pendencias.map((p) => (
        <div key={p.unidade} className="cv-linha">
          <p className="cv-origem">
            <b>{nomeDaUnidade(p.unidade)}</b> — {ROTULO_DA_ORIGEM[p.origem]}
            {p.linhas > 0 && <> · {p.linhas} {p.linhas === 1 ? "compra" : "compras"} (<Money value={p.valor} />)</>}
          </p>
          <FormularioDaConversao
            produtoId={produto.productId}
            contagem={produto.unidadeDeContagem}
            unidade={p.unidade}
            sugestao={p.proposta?.factor ?? null}
            rotuloDaSugestao={p.proposta ? `Sugestão do sistema (${p.proposta.confianca === "alta" ? "alta confiança" : "confira"}): ${p.proposta.motivo}` : undefined}
            aoSalvar={aoSalvar}
          />
        </div>
      ))}
    </li>
  );
}

function NovaConversao({ catalogo, unidades, inicial, aoSalvar }: { catalogo: RequisitionCatalogItem[]; unidades: UnitMeasure[]; inicial: Props["produtoInicial"]; aoSalvar: (mensagem: string) => void }) {
  const [busca, setBusca] = useState(inicial?.nome ?? "");
  const [produtoId, setProdutoId] = useState<string | null>(inicial?.id ?? null);
  const [unidade, setUnidade] = useState("UN");

  const produto = catalogo.find((c) => c.id === produtoId) ?? null;
  const resultados = useMemo(() => {
    const termos = normalizarBusca(busca).split(" ").filter(Boolean);
    if (termos.length === 0 || produto) return [];
    return catalogo.filter((c) => termos.every((t) => normalizarBusca(`${c.name} ${c.code ?? ""}`).includes(t))).slice(0, 8);
  }, [busca, catalogo, produto]);
  const opcoes = unidades.filter((u) => u.code !== (produto?.unit ?? "")).map((u) => u.code);

  return (
    <section className="rq-bloco cv-nova" aria-label="Cadastrar conversão de outro produto">
      <h3><Plus size={16} aria-hidden /> Cadastrar conversão de outro produto</h3>
      <p className="muted">Para o que não está na lista acima: escolha o produto e diga quanto vale 1 unidade.</p>
      <div className="rq-busca">
        <Search size={18} aria-hidden />
        <input type="search" autoComplete="off" placeholder="Buscar produto" aria-label="Buscar produto para converter" value={busca} onChange={(e) => { setBusca(e.target.value); setProdutoId(null); }} />
      </div>
      {resultados.length > 0 && (
        <ul className="cv-resultados" role="listbox">
          {resultados.map((c) => (
            <li key={c.id}><button type="button" role="option" aria-selected={false} onClick={() => { setProdutoId(c.id); setBusca(c.name); }}><strong>{c.name}</strong> <span className="muted">estoque em {c.unit}</span></button></li>
          ))}
        </ul>
      )}
      {produto && (
        <div className="cv-linha">
          <label className="cv-unidade">
            <span className="rp-rotulo">Unidade a converter</span>
            <select aria-label="Unidade a converter" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
              {opcoes.map((u) => <option key={u} value={u}>{nomeDaUnidade(u)}</option>)}
            </select>
          </label>
          <FormularioDaConversao key={`${produto.id}-${unidade}`} produtoId={produto.id} contagem={produto.unit ?? ""} unidade={unidade} sugestao={null} aoSalvar={(m) => { aoSalvar(m); setProdutoId(null); setBusca(""); }} />
        </div>
      )}
    </section>
  );
}

export function PendenciasDeConversao({ produtoInicial, onCadastrada }: Props) {
  const [produtos, setProdutos] = useState<ProdutoComPendenciaDeConversao[] | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [catalogo, setCatalogo] = useState<RequisitionCatalogItem[]>([]);
  const [unidades, setUnidades] = useState<UnitMeasure[]>([]);
  const [filtro, setFiltro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setFalhou(false);
    getConversoesPendentes().then((r) => ativo && setProdutos(r.produtos)).catch(() => ativo && setFalhou(true));
    return () => { ativo = false; };
  }, [tentativa]);

  useEffect(() => {
    let ativo = true;
    getRequisitionCatalog().then((c) => ativo && setCatalogo(c)).catch(() => {});
    getUnits().then((u) => ativo && setUnidades(u.filter((x) => x.isActive !== false))).catch(() => {});
    return () => { ativo = false; };
  }, []);

  const visiveis = useMemo(() => {
    const termos = normalizarBusca(filtro).split(" ").filter(Boolean);
    return (produtos ?? []).filter((p) => termos.every((t) => normalizarBusca(`${p.nome} ${p.codigo ?? ""}`).includes(t)));
  }, [produtos, filtro]);

  function aoSalvar(texto: string) {
    setMensagem(texto);
    setTentativa((n) => n + 1);
    onCadastrada(texto);
  }

  return (
    <div className="rq">
      <section className="rq-cabecalho cv-intro">
        <h3>Conversões pendentes</h3>
        <p className="muted">
          Unidades em que o produto já foi comprado (ou se chama “peça”) e que o sistema ainda não sabe converter para a unidade do estoque.
          Cadastre quanto vale 1 unidade: ela passa a valer na requisição, no pedido de compra e nas compras já lançadas.
        </p>
      </section>

      {mensagem && <div className="req-banner is-info" role="status"><span><CheckCircle2 size={14} aria-hidden /> {mensagem}</span><button type="button" aria-label="Fechar aviso" onClick={() => setMensagem(null)}>×</button></div>}

      <section className="rq-bloco" aria-label="Pendências">
        <div className="rq-fixos">
          <div className="rq-busca">
            <Search size={18} aria-hidden />
            <input type="search" autoComplete="off" placeholder="Filtrar pendências por produto ou código" aria-label="Filtrar pendências" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          {produtos && <p className="muted cv-contagem">{visiveis.length} {visiveis.length === 1 ? "produto" : "produtos"} com conversão pendente</p>}
        </div>

        {falhou && <div className="req-banner is-erro" role="alert"><span>Não consegui carregar as pendências.</span><Button variant="secondary" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</Button></div>}
        {produtos == null && !falhou && <ul className="rq-lista rq-esqueleto" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <li key={i} className="rq-linha" />)}</ul>}
        {produtos != null && visiveis.length === 0 && (
          <div className="rq-vazio"><strong>{filtro ? "Nenhuma pendência com esse nome." : "Nada pendente."}</strong><p>{filtro ? "Confira a escrita." : "Todas as unidades em uso já convertem."}</p></div>
        )}
        {visiveis.length > 0 && <ul className="cv-lista">{visiveis.map((p) => <CartaoDoProduto key={p.productId} produto={p} aoSalvar={aoSalvar} />)}</ul>}
      </section>

      <NovaConversao catalogo={catalogo} unidades={unidades} inicial={produtoInicial} aoSalvar={aoSalvar} />
    </div>
  );
}
