import type { ReactNode } from "react";
import type { DimensaoRankingMetaCmv, RankingMetaCmv, VisoesMetaCmv } from "../../api/client";
import { Money, Tabs } from "../../design-system";
import { pontosDeCmv, rotuloDaComparacao, variacao } from "./logic";

export type AbaDistribuicao = "setor" | DimensaoRankingMetaCmv;

export const ABAS_DISTRIBUICAO: Array<{ value: AbaDistribuicao; label: string }> = [
  { value: "setor", label: "Setor" },
  { value: "categoria", label: "Categoria" },
  { value: "subcategoria", label: "Subcategoria" },
  { value: "fornecedor", label: "Fornecedor" },
  { value: "produto", label: "Produto" },
];

export const ehAbaDistribuicao = (v: string | null): v is AbaDistribuicao => ABAS_DISTRIBUICAO.some((a) => a.value === v);

const pct1 = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const pontos = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pts`);

/** Compra subindo é ruim: a cor segue o julgamento, a seta segue o sinal. Base quase zero vira ">999%", não um número gritando. */
function Variacao({ atual, anterior, contra }: { atual: number; anterior: number; contra: string }) {
  const v = variacao(atual, anterior);
  if (v == null) return <span className="mt-var mt-var--neutra" title={`Sem compra em ${contra}`}>novo</span>;
  const arred = Math.round(v);
  const tom = arred === 0 ? "neutra" : arred > 0 ? "pior" : "melhor";
  return (
    <span className={`mt-var mt-var--${tom}`} title={`Variação contra ${contra}`}>
      {arred > 0 ? "▲" : arred < 0 ? "▼" : "="} {Math.abs(arred) > 999 ? ">999" : Math.abs(arred)}%
    </span>
  );
}

function Barras({ ranking, faturamento, contra }: { ranking: RankingMetaCmv; faturamento: number; contra: string }) {
  if (ranking.total <= 0 && ranking.totalAnterior <= 0) return <p className="mt-ajuda">Nenhuma compra de CMV neste mês.</p>;
  const maior = Math.max(...ranking.linhas.map((l) => l.compras), ranking.outros.compras, 1);
  const linhas = [
    ...ranking.linhas.map((l, i) => ({ chave: `${l.id ?? "sem"}-${l.nome}`, posicao: String(i + 1), ...l, resto: false })),
    ...(ranking.outros.quantidade > 0
      ? [{ chave: "outros", posicao: "", id: null, nome: `Outros ${ranking.outros.quantidade}`, compras: ranking.outros.compras, comprasAnterior: ranking.outros.comprasAnterior, resto: true }]
      : []),
  ];
  return (
    <ol className="mt-barras">
      {linhas.map((l) => {
        const parte = ranking.total > 0 ? (l.compras / ranking.total) * 100 : 0;
        return (
          <li key={l.chave} className={`mt-barras-linha${l.resto ? " is-resto" : ""}`}>
            <span className="mt-barras-pos" aria-hidden>{l.posicao}</span>
            <span className="mt-barras-nome" title={l.nome}>{l.nome}</span>
            <span className="mt-barras-valor"><Money value={l.compras} /></span>
            <span className="mt-barras-pts" title="Quanto este item pesa no CMV do mês: compra ÷ faturamento">{pontos(pontosDeCmv(l.compras, faturamento))}</span>
            <span className="mt-barras-parte">{pct1(parte)}</span>
            <Variacao atual={l.compras} anterior={l.comprasAnterior} contra={contra} />
            <span className="mt-barras-trilho" aria-hidden>
              <span className="mt-barras-cheio" style={{ width: `${Math.max((l.compras / maior) * 100, l.compras > 0 ? 1.5 : 0)}%` }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type Props = {
  visoes: VisoesMetaCmv | null;
  aba: AbaDistribuicao;
  onAba: (aba: AbaDistribuicao) => void;
  /** Tabela de setores com meta e situação (já existente na tela). */
  setores: ReactNode;
};

/** Onde foram as compras do mês, como no Dashboard: uma dimensão por aba, com peso no CMV e variação. */
export function DistribuicaoCompras({ visoes, aba, onAba, setores }: Props) {
  const contra = visoes ? rotuloDaComparacao(visoes.mesAnterior, visoes.comparacaoAteODia, visoes.diasNoMesAnterior) : "";
  return (
    <div className="mt-bloco">
      <h3>Onde foram as compras</h3>
      <Tabs tabs={ABAS_DISTRIBUICAO} value={aba} onChange={(v) => onAba(v as AbaDistribuicao)} aria-label="Distribuir compras de CMV por" />
      <div role="tabpanel" aria-label={`Compras de CMV por ${ABAS_DISTRIBUICAO.find((a) => a.value === aba)?.label.toLowerCase()}`}>
        {aba === "setor" ? (
          setores
        ) : !visoes ? (
          <p className="mt-ajuda">Carregando…</p>
        ) : (
          <>
            <Barras ranking={visoes.distribuicao[aba]} faturamento={visoes.faturamento} contra={contra} />
            <p className="mt-ajuda">
              Só compras de CMV. "pts" é o peso no CMV do mês (compra ÷ faturamento); somados, dão as compras ÷ faturamento do mês. A variação compara com {contra}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
