import { CheckCircle2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getRotinaDeConversoes, getUnits, type ProdutoDaRotinaDeConversao, type RotinaDeConversoes, type StatusDaConversao } from "../api/client";
import { Button } from "../design-system";
import { normalizarBusca } from "./requisitions/catalogo";
import { CartaoDeConversao } from "./conversoes/CartaoDeConversao";

type Visao = "A_FAZER" | StatusDaConversao | "TODOS";

const POR_PAGINA = 30;

const VISOES: Array<{ valor: Visao; rotulo: string }> = [
  { valor: "A_FAZER", rotulo: "A fazer" },
  { valor: "PENDENTE", rotulo: "Pendentes" },
  { valor: "PARCIAL", rotulo: "Falta uma unidade" },
  { valor: "CADASTRADO", rotulo: "Cadastradas" },
  { valor: "NAO_PRECISA", rotulo: "Não precisa" },
  { valor: "TODOS", rotulo: "Todos" }
];

const dentroDaVisao = (status: StatusDaConversao, visao: Visao) =>
  visao === "TODOS" ? true : visao === "A_FAZER" ? status === "PENDENTE" || status === "PARCIAL" : status === visao;

/**
 * Rotina do estoquista (menu Estoque > Conversões): todo produto que controla estoque com a situação da conversão.
 * Ele vai da fila "A fazer" cadastrando quanto vale 1 unidade (ou marcando "não precisa") até zerar, e acompanha o progresso.
 */
export function ConversoesDeUnidade() {
  const [parametros] = useSearchParams();
  const produtoDestacado = parametros.get("produto");
  const [rotina, setRotina] = useState<RotinaDeConversoes | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [visao, setVisao] = useState<Visao>(produtoDestacado ? "TODOS" : "A_FAZER");
  const [localId, setLocalId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [paginas, setPaginas] = useState(1);
  const [tentativa, setTentativa] = useState(0);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setFalhou(false);
    getRotinaDeConversoes()
      .then((r) => {
        if (!ativo) return;
        setRotina(r);
        // Vindo do "+ unidade" da requisição: o produto já aparece filtrado.
        if (produtoDestacado) setBusca((atual) => atual || r.produtos.find((p) => p.productId === produtoDestacado)?.nome || "");
      })
      .catch(() => ativo && setFalhou(true));
    return () => { ativo = false; };
    // o produto destacado só vale na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tentativa]);

  useEffect(() => {
    let ativo = true;
    getUnits().then((u) => ativo && setUnidades(u.filter((x) => x.isActive !== false).map((x) => x.code))).catch(() => {});
    return () => { ativo = false; };
  }, []);

  useEffect(() => { setPaginas(1); }, [visao, localId, busca]);

  const aoMudar = useCallback((texto: string) => {
    setMensagem(texto);
    setTentativa((n) => n + 1);
  }, []);

  const visiveis = useMemo(() => {
    const termos = normalizarBusca(busca).split(" ").filter(Boolean);
    return (rotina?.produtos ?? []).filter((p) =>
      dentroDaVisao(p.status, visao)
      && (localId == null || p.sectorId === localId)
      && termos.every((t) => normalizarBusca(`${p.nome} ${p.codigo ?? ""}`).includes(t))
    );
  }, [rotina, visao, localId, busca]);

  const resumo = rotina?.resumo;
  const resolvidos = resumo ? resumo.cadastrados + resumo.naoPrecisa : 0;
  const percentual = resumo && resumo.total > 0 ? Math.round((resolvidos / resumo.total) * 100) : 0;
  const unidadesPara = (p: ProdutoDaRotinaDeConversao) => {
    const cadastradas = new Set(p.conversoes.map((c) => c.fromUnit));
    return unidades.filter((u) => u !== p.unidadeDeContagem && !cadastradas.has(u));
  };
  const contagemDe = (v: Visao) => !resumo ? null : v === "TODOS" ? resumo.total : v === "A_FAZER" ? resumo.pendentes + resumo.parciais : v === "PENDENTE" ? resumo.pendentes : v === "PARCIAL" ? resumo.parciais : v === "CADASTRADO" ? resumo.cadastrados : resumo.naoPrecisa;

  return (
    <div className="rq cv-pagina">
      <section className="rq-cabecalho cv-intro">
        <p className="muted">
          Todo produto precisa saber converter as unidades em que é comprado e pedido para a unidade em que o estoque é contado (quanto pesa 1 peça, quantas unidades tem 1 caixa).
          Vá pela fila “A fazer”: cadastre quanto vale 1 unidade ou marque “não precisa”. A conversão passa a valer nas requisições, nos pedidos de compra e nas compras já lançadas.
        </p>
        {resumo && (
          <div className="cv-progresso" role="group" aria-label="Progresso">
            <div className="cv-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentual} aria-label="Produtos resolvidos"><span style={{ width: `${percentual}%` }} /></div>
            <p><strong>{resolvidos}</strong> de {resumo.total} produtos resolvidos ({percentual}%) · <strong>{resumo.pendentes + resumo.parciais}</strong> a fazer</p>
          </div>
        )}
      </section>

      {mensagem && <div className="req-banner is-info" role="status"><span><CheckCircle2 size={14} aria-hidden /> {mensagem}</span><button type="button" aria-label="Fechar aviso" onClick={() => setMensagem(null)}>×</button></div>}

      <section className="rq-bloco" aria-label="Produtos">
        <div className="rq-fixos">
          <div className="rq-busca">
            <Search size={18} aria-hidden />
            <input type="search" autoComplete="off" placeholder="Buscar produto ou código" aria-label="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="rq-chips" role="group" aria-label="Situação">
            {VISOES.map((v) => (
              <button key={v.valor} type="button" aria-pressed={visao === v.valor} className={visao === v.valor ? "is-ativo" : undefined} onClick={() => setVisao(v.valor)}>
                {v.rotulo} {contagemDe(v.valor) != null && <span className="rq-chip-n">{contagemDe(v.valor)}</span>}
              </button>
            ))}
          </div>
        </div>
        {rotina && rotina.locais.length > 0 && (
          <div className="rq-extras">
            <div className="rq-chips rq-locais" role="group" aria-label="Local do estoque">
              <button type="button" aria-pressed={localId === null} className={localId === null ? "is-ativo" : undefined} onClick={() => setLocalId(null)}>Todos os locais</button>
              {rotina.locais.map((l) => (
                <button key={l.id} type="button" aria-pressed={localId === l.id} className={localId === l.id ? "is-ativo" : undefined} onClick={() => setLocalId(localId === l.id ? null : l.id)}>{l.nome}</button>
              ))}
            </div>
          </div>
        )}

        {falhou && <div className="req-banner is-erro" role="alert"><span>Não consegui carregar as conversões.</span><Button variant="secondary" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</Button></div>}
        {rotina == null && !falhou && <ul className="rq-lista rq-esqueleto" aria-busy="true" aria-label="Carregando">{Array.from({ length: 4 }, (_, i) => <li key={i} className="rq-linha" />)}</ul>}
        {rotina != null && visiveis.length === 0 && (
          <div className="rq-vazio">
            <strong>{busca || localId ? "Nenhum produto com esse filtro." : visao === "A_FAZER" ? "Nada a fazer. Todas as conversões estão em dia." : `Nenhum produto em “${VISOES.find((v) => v.valor === visao)?.rotulo}”.`}</strong>
            {(busca || localId) && <p>Confira a escrita ou limpe os filtros.</p>}
          </div>
        )}
        {visiveis.length > 0 && (
          <>
            <ul className="cv-lista">
              {visiveis.slice(0, paginas * POR_PAGINA).map((p) => (
                <CartaoDeConversao key={p.productId} produto={p} unidadesParaAdicionar={unidadesPara(p)} destacado={p.productId === produtoDestacado} aoMudar={aoMudar} />
              ))}
            </ul>
            {visiveis.length > paginas * POR_PAGINA && (
              <div className="cv-mais"><Button variant="secondary" onClick={() => setPaginas((n) => n + 1)}>Mostrar mais ({visiveis.length - paginas * POR_PAGINA} restantes)</Button></div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

