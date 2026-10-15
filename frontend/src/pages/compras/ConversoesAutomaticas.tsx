import { Loader2, RefreshCw, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ProdutoComPropostasDeConversao,
  type PropostaDeConversao,
  aplicarConversoesAutomaticas,
  getConversoesAutomaticas
} from "../../api/client";
import { Money } from "../../design-system";
import "./revisao-embalagens.css";

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });

type Props = { onFechar: () => void; onAplicado?: () => void };

const chave = (productId: string, proposta: PropostaDeConversao) => `${productId}|${proposta.fromUnit}`;

// Conversao de unidade que o nome do produto e as compras ja dizem ("SACO C800"
// comprado em CX e contado em UN). As de alta confianca o sistema aplica sozinho
// nas compras novas; aqui elas entram em lote para o historico. As que o preco
// desmente ou que o nome deixa em duvida so entram marcadas pelo operador.
export function ConversoesAutomaticas({ onFechar, onAplicado }: Props) {
  const [produtos, setProdutos] = useState<ProdutoComPropostasDeConversao[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<"todas" | "alta" | "baixa">("todas");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setProdutos((await getConversoesAutomaticas()).produtos);
      setMarcadas(new Set());
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível montar as conversões automáticas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const resumo = useMemo(() => {
    const todas = (produtos ?? []).flatMap((p) => p.propostas);
    const altas = todas.filter((p) => p.confianca === "alta");
    return {
      altas: altas.length,
      baixas: todas.length - altas.length,
      linhasAltas: altas.reduce((s, p) => s + p.linhas, 0),
      valorAltas: altas.reduce((s, p) => s + p.valor, 0)
    };
  }, [produtos]);

  const visiveis = useMemo(
    () => (produtos ?? [])
      .map((p) => ({ ...p, propostas: p.propostas.filter((x) => filtro === "todas" || x.confianca === filtro) }))
      .filter((p) => p.propostas.length > 0),
    [produtos, filtro]
  );

  function alternar(id: string) {
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id); else nova.add(id);
      return nova;
    });
  }

  async function aplicar(payload: Parameters<typeof aplicarConversoesAutomaticas>[0], confirmacao: string) {
    if (!window.confirm(confirmacao)) return;
    setEnviando(true);
    setResultado(null);
    try {
      const r = await aplicarConversoesAutomaticas(payload);
      const fechadas = r.comprasEmPeriodoFechado
        ? ` ${r.comprasEmPeriodoFechado} compra(s) em mês travado ou CMV fechado ficaram como estavam.`
        : "";
      setResultado({
        tom: "ok",
        texto: `${r.conversoesCriadas} conversão(ões) cadastrada(s) e ${r.comprasConvertidas} compra(s) convertida(s) para a unidade de contagem.${fechadas}`
      });
      await carregar();
      onAplicado?.();
    } catch (error) {
      setResultado({ tom: "erro", texto: error instanceof Error ? error.message : "Não foi possível aplicar." });
    } finally {
      setEnviando(false);
    }
  }

  const aplicarAltas = () => void aplicar(
    { todasDeAltaConfianca: true },
    `Cadastrar ${resumo.altas} conversão(ões) de alta confiança e converter ${resumo.linhasAltas} compra(s)? O total das notas não muda.`
  );
  const aplicarMarcadas = () => void aplicar(
    { escolhas: [...marcadas].map((id) => { const [productId, fromUnit] = id.split("|"); return { productId, fromUnit }; }) },
    `Cadastrar ${marcadas.size} conversão(ões) marcada(s) e converter as compras delas? O total das notas não muda.`
  );

  return (
    <section className="emb" aria-labelledby="conv-auto-titulo">
      <header className="emb-topo">
        <div>
          <h2 id="conv-auto-titulo"><Wand2 size={18} aria-hidden="true" /> Conversões automáticas</h2>
          <p>
            O sistema lê a embalagem no nome do produto ("C800", "5KG", "500ML C/12") e confere com o preço das compras.
            As de alta confiança já são cadastradas sozinhas nas compras novas; aqui você aplica no histórico. As marcadas
            "conferir" só entram se você marcar. O total das notas nunca muda.
          </p>
        </div>
        <div className="emb-topo__acoes">
          <button type="button" className="icon-button" aria-label="Atualizar conversões" onClick={() => void carregar()} disabled={carregando}><RefreshCw size={16} /></button>
          <button type="button" className="icon-button" aria-label="Fechar conversões automáticas" onClick={onFechar}><X size={16} /></button>
        </div>
      </header>

      {resultado && (
        <p className={`emb-resultado emb-resultado--${resultado.tom}`} role={resultado.tom === "erro" ? "alert" : "status"}>
          {resultado.texto}
          <button type="button" className="icon-button" aria-label="Fechar aviso" onClick={() => setResultado(null)}><X size={14} /></button>
        </p>
      )}
      {carregando && !produtos && <p className="emb-estado" role="status"><Loader2 size={16} className="spin" aria-hidden="true" /> Lendo produtos e compras…</p>}
      {erro && <p className="emb-estado emb-estado--erro" role="alert">{erro}</p>}
      {produtos && produtos.length === 0 && <p className="emb-estado">Nenhuma conversão pendente: todo produto comprado em embalagem já converte.</p>}

      {produtos && produtos.length > 0 && (
        <div className="conv-auto-barra">
          <div className="conv-auto-filtros" role="group" aria-label="Filtrar por confiança">
            {(["todas", "alta", "baixa"] as const).map((f) => (
              <button key={f} type="button" className="secondary-button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                {f === "todas" ? `Todas (${resumo.altas + resumo.baixas})` : f === "alta" ? `Alta confiança (${resumo.altas})` : `Conferir (${resumo.baixas})`}
              </button>
            ))}
          </div>
          <div className="emb-produto__acoes">
            <button type="button" className="primary-button" disabled={enviando || resumo.altas === 0} onClick={aplicarAltas}>
              {enviando ? "Aplicando…" : <>Aplicar as {resumo.altas} de alta confiança{resumo.valorAltas > 0 && <> (<Money value={resumo.valorAltas} decimals={0} /> em compras)</>}</>}
            </button>
            <button type="button" className="secondary-button" disabled={enviando || marcadas.size === 0} onClick={aplicarMarcadas}>
              Aplicar {marcadas.size} marcada(s)
            </button>
          </div>
        </div>
      )}

      {visiveis.map((produto) => (
        <article key={produto.productId} className="emb-produto conv-auto-produto" aria-label={produto.nome}>
          <header className="emb-produto__topo">
            <div>
              <strong>{produto.codigo ? `${produto.codigo} — ` : ""}{produto.nome}</strong>
              <small>Contado em {produto.unidadeDeContagem}</small>
            </div>
          </header>
          <ul className="conv-auto-lista">
            {produto.propostas.map((proposta) => {
              const id = chave(produto.productId, proposta);
              return (
                <li key={id} className={`conv-auto-item conv-auto-item--${proposta.confianca}`}>
                  <label>
                    <input type="checkbox" checked={marcadas.has(id)} onChange={() => alternar(id)} aria-label={`Aplicar 1 ${proposta.fromUnit} = ${numero.format(proposta.factor)} ${proposta.toUnit} em ${produto.nome}`} />
                    <strong>1 {proposta.fromUnit} = {numero.format(proposta.factor)} {proposta.toUnit}</strong>
                  </label>
                  <span className={`conv-auto-selo conv-auto-selo--${proposta.confianca}`}>{proposta.confianca === "alta" ? "alta confiança" : "conferir"}</span>
                  <small>{proposta.motivo}</small>
                  <small>
                    {proposta.linhas > 0
                      ? <>{proposta.linhas} compra(s) sem conversão · <Money value={proposta.valor} /></>
                      : "Unidade de compra do cadastro: vale para as próximas notas."}
                  </small>
                </li>
              );
            })}
          </ul>
        </article>
      ))}
    </section>
  );
}
