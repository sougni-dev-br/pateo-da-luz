import { Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ItemDaPosicao, getPosicaoDoEstoque } from "../../../api/client";
import { EmptyState, Money } from "../../../design-system";
import { formatDate, formatNumber } from "../../../utils/format";
import "./inventario.css";

// Substitui o "Estoque atual", que listava o saldo do sistema — e esse saldo
// so soma compras, nunca baixa (o Salton Brut aparecia com 41 unidades e o
// alerta "zerado" na mesma linha). Aqui vale a ultima contagem aprovada de cada
// produto, pelo custo da base oficial, que e o mesmo numero que o CMV usa.

type Recorte = "todos" | "sem-custo" | "nunca" | "com-compras";
type Ordem = "setor" | "valor";

const SEM_SETOR = "Sem setor";
const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function qtd(valor: number, unidade: string | null) {
  return unidade ? `${formatoQuantidade.format(valor)} ${unidade}` : formatoQuantidade.format(valor);
}

function noRecorte(item: ItemDaPosicao, recorte: Recorte) {
  if (recorte === "sem-custo") return item.quantidade != null && item.quantidade > 0 && item.custoUnitario == null;
  if (recorte === "nunca") return item.quantidade == null;
  if (recorte === "com-compras") return item.comprasDesde > 0;
  return true;
}

export function PosicaoEstoque() {
  const [itens, setItens] = useState<ItemDaPosicao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [setor, setSetor] = useState("");
  const [recorte, setRecorte] = useState<Recorte>("todos");
  const [ordem, setOrdem] = useState<Ordem>("setor");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setItens((await getPosicaoDoEstoque()).itens);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar a posição do estoque.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const resumo = useMemo(() => {
    const lista = itens ?? [];
    const contados = lista.filter((i) => i.quantidade != null);
    return {
      valor: contados.reduce((s, i) => s + (i.valor ?? 0), 0),
      contados: contados.length,
      semCusto: lista.filter((i) => noRecorte(i, "sem-custo")).length,
      nunca: lista.filter((i) => i.quantidade == null).length,
      comCompras: lista.filter((i) => i.comprasDesde > 0).length,
      valorCompras: lista.reduce((s, i) => s + i.valorComprasDesde, 0),
      maisRecente: contados.reduce<string | null>((m, i) => (i.contadoEm && (!m || i.contadoEm > m) ? i.contadoEm : m), null)
    };
  }, [itens]);

  const setores = useMemo(
    () => [...new Set((itens ?? []).map((i) => i.sectorName ?? SEM_SETOR))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [itens]
  );

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (itens ?? []).filter((i) =>
      noRecorte(i, recorte)
      && (!setor || (i.sectorName ?? SEM_SETOR) === setor)
      && (!termo || i.productName.toLowerCase().includes(termo) || String(i.productCode ?? "").toLowerCase().includes(termo))
    );
  }, [itens, busca, setor, recorte]);

  const grupos = useMemo(() => {
    if (ordem === "valor") {
      const porValor = [...filtrados].sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1));
      return [{ setor: null as string | null, itens: porValor, valor: porValor.reduce((s, i) => s + (i.valor ?? 0), 0) }];
    }
    const mapa = new Map<string, ItemDaPosicao[]>();
    for (const item of filtrados) {
      const chave = item.sectorName ?? SEM_SETOR;
      mapa.set(chave, [...(mapa.get(chave) ?? []), item]);
    }
    return [...mapa.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([nome, lista]) => ({ setor: nome, itens: lista, valor: lista.reduce((s, i) => s + (i.valor ?? 0), 0) }));
  }, [filtrados, ordem]);

  if (!itens) {
    return (
      <section className="pos">
        {carregando && <p className="pos-estado" role="status"><Loader2 size={16} className="spin" aria-hidden="true" /> Carregando a posição do estoque…</p>}
        {erro && (
          <p className="pos-estado pos-estado--erro" role="alert">
            {erro} <button type="button" className="secondary-button" onClick={() => void carregar()}>Tentar de novo</button>
          </p>
        )}
      </section>
    );
  }

  const recortes: Array<[Recorte, string, number]> = [
    ["todos", "Todos", itens.length],
    ["com-compras", "Com compra depois da contagem", resumo.comCompras],
    ["sem-custo", "Contados sem custo", resumo.semCusto],
    ["nunca", "Nunca contados", resumo.nunca]
  ];

  return (
    <section className="pos" aria-labelledby="pos-titulo">
      <div className="pos-topo">
        <div className="pos-topo__principal">
          <h3 id="pos-titulo" className="pos-eyebrow">Estoque na última contagem aprovada</h3>
          <p className="pos-valor"><Money value={resumo.valor} /></p>
          <p className="pos-legenda">
            {formatNumber(resumo.contados)} produtos contados
            {resumo.maisRecente && <> · contagem mais recente em {formatDate(resumo.maisRecente)}</>}
          </p>
        </div>
        <div className="pos-topo__apoio">
          <p>
            <strong><Money value={resumo.valorCompras} /></strong> em compras recebidas depois das contagens.
            O sistema não registra o consumo, então o estoque de hoje fica entre o valor contado e o contado mais essas compras.
          </p>
          <button type="button" className="icon-button" aria-label="Atualizar posição" title="Atualizar posição" disabled={carregando} onClick={() => void carregar()}>
            <RefreshCw size={15} className={carregando ? "spin" : undefined} />
          </button>
        </div>
      </div>

      <div className="pos-controles">
        <div className="pos-recortes" role="group" aria-label="Recorte">
          {recortes.map(([valor, rotulo, total]) => (
            <button key={valor} type="button" className="invl-filtro" aria-pressed={recorte === valor} disabled={total === 0 && valor !== "todos"} onClick={() => setRecorte(valor)}>
              {rotulo} <span>{formatNumber(total)}</span>
            </button>
          ))}
        </div>
        <div className="pos-campos">
          <label className="pos-busca">
            <Search size={15} aria-hidden="true" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código ou produto" aria-label="Buscar por código ou produto" />
          </label>
          <label>
            <span className="pos-campo-rotulo">Setor</span>
            <select value={setor} onChange={(e) => setSetor(e.target.value)}>
              <option value="">Todos</option>
              {setores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            <span className="pos-campo-rotulo">Ordem</span>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
              <option value="setor">Por setor</option>
              <option value="valor">Maior valor primeiro</option>
            </select>
          </label>
        </div>
      </div>

      {erro && (
        <p className="pos-estado pos-estado--erro" role="alert">
          Não foi possível atualizar: {erro}. Os números abaixo são da carga anterior.
        </p>
      )}

      {recorte === "sem-custo" && (
        <p className="pos-nota">A base oficial desses itens não tem custo: eles entram no CMV valendo zero. Corrija o custo no inventário que gerou a base.</p>
      )}

      {filtrados.length === 0 && <EmptyState title="Nenhum produto neste recorte" description="Ajuste a busca, o setor ou o recorte." />}

      {grupos.filter((g) => g.itens.length > 0).map((grupo) => (
        <div key={grupo.setor ?? "todos"} className="pos-grupo">
          {grupo.setor && (
            <h4 className="pos-grupo__titulo">
              <span>{grupo.setor}</span>
              <span>{formatNumber(grupo.itens.length)} produtos · <Money value={grupo.valor} /></span>
            </h4>
          )}
          <ul className="pos-linhas">
            {grupo.itens.map((item) => <LinhaDaPosicao key={item.productId} item={item} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function LinhaDaPosicao({ item }: { item: ItemDaPosicao }) {
  const u = item.unit;
  return (
    <li className={`pos-linha${item.quantidade == null ? " pos-linha--nunca" : ""}`}>
      <span className="pos-linha__produto">
        <strong>{item.productName}</strong>
        <small>{[item.productCode, item.categoryName].filter(Boolean).join(" · ")}</small>
      </span>
      {item.quantidade == null ? (
        <span className="pos-linha__nunca">Nunca contado num inventário aprovado</span>
      ) : (
        <>
          <span className="pos-linha__qtd">
            <strong>{qtd(item.quantidade, u)}</strong>
            <small>{[item.inventarioCodigo, item.contadoEm ? formatDate(item.contadoEm) : null].filter(Boolean).join(" · ")}</small>
          </span>
          <span className="pos-linha__valor">
            {item.custoUnitario == null
              ? (item.quantidade > 0 ? <em>sem custo</em> : <small>—</small>)
              : <><Money value={item.valor} /><small><Money value={item.custoUnitario} />/{u ?? "un"}</small></>}
          </span>
        </>
      )}
      <span className="pos-linha__compras">
        {item.comprasDesde > 0
          ? <><strong>+ {qtd(item.comprasDesde, u)}</strong><small>comprado depois</small></>
          : <small>sem compra depois</small>}
      </span>
    </li>
  );
}
