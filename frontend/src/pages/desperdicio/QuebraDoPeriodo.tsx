import { useState } from "react";
import type { WasteAnalysis, WasteAnalysisGroup, WasteAnalysisProduct } from "../../api/client";
import { Tabs } from "../../design-system";
import { formatNumber } from "../../utils/format";
import type { FiltroDaLista } from "./filtros";

type Aba = "motivo" | "setor" | "item";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = {
  analise: WasteAnalysis;
  veCusto: boolean;
  filtro: FiltroDaLista;
  /** Clicar numa linha recorta a lista de lançamentos; clicar de novo desfaz. */
  onFiltrar: (parcial: Partial<FiltroDaLista>) => void;
};

const medida = (g: Pick<WasteAnalysisGroup, "valor" | "lancamentos">, veCusto: boolean) => (veCusto ? g.valor ?? 0 : g.lancamentos);

function Mudanca({ g, veCusto }: { g: WasteAnalysisGroup; veCusto: boolean }) {
  const atual = medida(g, veCusto);
  const antes = veCusto ? g.anteriorValor ?? 0 : g.anteriorLancamentos;
  if (antes === 0) return atual > 0 ? <span className="waste-delta waste-delta--neutro">novo</span> : null;
  const diferenca = Math.round((atual - antes) * 100) / 100;
  if (diferenca === 0) return null;
  const texto = veCusto ? brl(Math.abs(diferenca)) : String(Math.abs(diferenca));
  return (
    <span className={diferenca > 0 ? "waste-delta waste-delta--ruim" : "waste-delta waste-delta--bom"}>
      <span className="waste-sr">{diferenca > 0 ? "Subiu" : "Caiu"} </span>{diferenca > 0 ? "▲" : "▼"} {texto}
    </span>
  );
}

type LinhaProps = { g: WasteAnalysisGroup | WasteAnalysisProduct; total: number; veCusto: boolean; ativa: boolean; onClick: () => void };

function Linha({ g, total, veCusto, ativa, onClick }: LinhaProps) {
  const parte = total > 0 ? medida(g, veCusto) / total : 0;
  const produto = "dias" in g ? g : null;
  return (
    <li>
      <button type="button" className={ativa ? "waste-rank-row waste-rank-row--ativa" : "waste-rank-row"} aria-pressed={ativa} onClick={onClick}>
        <span className="waste-rank-top">
          <span className="waste-rank-name">{g.nome}</span>
          <span className="waste-rank-value">{veCusto && g.valor != null ? (g.semCusto === g.lancamentos ? "sem custo" : brl(g.valor)) : `${g.lancamentos}×`}</span>
        </span>
        <span className="waste-bar" aria-hidden><span style={{ width: `${Math.max(parte * 100, medida(g, veCusto) > 0 ? 2 : 0)}%` }} /></span>
        <span className="waste-rank-meta">
          {veCusto && <span>{Math.round(parte * 100)}% do total</span>}
          <span>{formatNumber(g.lancamentos)} {g.lancamentos === 1 ? "lançamento" : "lançamentos"}</span>
          {produto && produto.dias > 1 && <span>em {produto.dias} dias</span>}
          {produto && <span>{produto.motivoPrincipalRotulo}</span>}
          {produto?.quantidade != null && produto.unidade && (
            <span>
              {produto.quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {produto.unidade}
              {produto.comprado != null && produto.taxaDePerda != null && ` de ${produto.comprado.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${produto.unidade} comprados (${produto.taxaDePerda.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`}
            </span>
          )}
          <Mudanca g={g} veCusto={veCusto} />
        </span>
      </button>
    </li>
  );
}

/** De onde vem a perda: por motivo (causa), setor (onde) e item (o quê). Cada linha filtra os lançamentos abaixo. */
export function QuebraDoPeriodo({ analise, veCusto, filtro, onFiltrar }: Props) {
  const [aba, setAba] = useState<Aba>("motivo");
  const grupos = aba === "motivo" ? analise.porMotivo : aba === "setor" ? analise.porSetor : analise.porProduto;
  // A aba Item mostra só os maiores: o "% do total" é sobre o total do período, não sobre a soma dos que cabem na lista.
  const total = aba === "item"
    ? (veCusto ? analise.total.valor ?? 0 : analise.total.lancamentos)
    : grupos.reduce((s, g) => s + medida(g, veCusto), 0);
  const ativa = (g: WasteAnalysisGroup) => (aba === "motivo" ? filtro.motivo === g.chave : aba === "setor" ? filtro.setor === g.chave : filtro.item?.chave === g.chave);
  const alternar = (g: WasteAnalysisGroup) => {
    if (aba === "motivo") onFiltrar({ motivo: filtro.motivo === g.chave ? null : g.chave });
    else if (aba === "setor") onFiltrar({ setor: filtro.setor === g.chave ? null : g.chave });
    else onFiltrar({ item: filtro.item?.chave === g.chave ? null : { chave: g.chave, rotulo: g.nome } });
  };

  return (
    <section className="waste-card" aria-labelledby="waste-quebra-titulo">
      <div className="waste-card-head">
        <h3 id="waste-quebra-titulo">De onde vem a perda</h3>
        <Tabs
          aria-label="Agrupar por"
          value={aba}
          onChange={(valor) => setAba(valor as Aba)}
          tabs={[{ value: "motivo", label: "Motivo" }, { value: "setor", label: "Setor" }, { value: "item", label: "Item" }]}
        />
      </div>
      {grupos.length === 0 ? (
        <p className="waste-note">Nada neste recorte.</p>
      ) : (
        <ul className="waste-rank">
          {grupos.map((g) => <Linha key={g.chave} g={g} total={total} veCusto={veCusto} ativa={ativa(g)} onClick={() => alternar(g)} />)}
        </ul>
      )}
      {aba === "item" && analise.produtosTotal > analise.porProduto.length && (
        <p className="waste-note">Mostrando os {analise.porProduto.length} maiores de {analise.produtosTotal} itens.</p>
      )}
    </section>
  );
}
