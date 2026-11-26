import type { PlanejamentoComparativo } from "../../api/client";
import { NOMES_DOS_MESES_CURTOS, textoDaVariacao } from "./formato";
import { compacto } from "./Reais";
import type { GrandezaDoQuadro } from "./TabelaMensal";
import type { LigacaoDeComentarios } from "./comentarios/ligacao";
import { chaveDoPonto, metricaDaGrandeza, textoDaContagem } from "./comentarios/ponto";
import { ladoParcial } from "./tipos";
import { useLargura } from "./useLargura";
import { useOculto } from "./useOculto";

// Ano-base × ano comparado, mês a mês, no total do Salão: a barra clara é o ano de referência, a escura o ano
// comparado. Em cima de cada par, a variação; o mês em queda ganha um fundo rosado, para a história ler em dois
// segundos. O mês parcial tem a barra tracejada e o rótulo "parcial".

type Props = { dados: PlanejamentoComparativo; grandeza: GrandezaDoQuadro; comentarios?: LigacaoDeComentarios };

const ALTURA = 216;
const TOPO = 34;
const BASE_DO_GRAFICO = ALTURA - 40;
const ESTREITO = 560;

function valorCurto(grandeza: GrandezaDoQuadro, v: number): string {
  if (grandeza === "vendas") return compacto(v);
  if (grandeza === "clientes") return Math.round(v).toLocaleString("pt-BR");
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

const ROTULO: Record<GrandezaDoQuadro, string> = { vendas: "Vendas", clientes: "Clientes", ticket: "Ticket médio" };

export function GraficoComparativo({ dados, grandeza, comentarios }: Props) {
  const contagem = (mes: number) => comentarios?.porPonto.get(chaveDoPonto({ mes, metrica: metricaDaGrandeza(grandeza), turno: "TOTAL" }))?.length ?? 0;
  const { ref, largura } = useLargura<HTMLDivElement>();
  const hidden = useOculto();
  const { meses, anoBase, anoComparado } = dados;
  const ocultar = hidden && grandeza !== "clientes";
  const pares = meses.map((m) => ({
    mes: m.mes,
    base: m.base[grandeza].total,
    comparado: m.comparado[grandeza].total,
    variacao: m.variacao[grandeza].total,
    parcial: m.emAndamento || ladoParcial(m.base) || ladoParcial(m.comparado)
  }));
  const valores = pares.flatMap((p) => [p.base, p.comparado]).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;

  const estreito = largura < ESTREITO;
  const fatia = largura / 12;
  const maximo = Math.max(...valores, 1);
  const y = (v: number) => BASE_DO_GRAFICO - (v / maximo) * (BASE_DO_GRAFICO - TOPO);
  const barra = Math.max(4, Math.min(22, fatia * 0.3));
  const fonte = estreito ? 9.5 : 11;
  const mostraValor = fatia >= 72 && !ocultar;
  const quedas = pares.filter((p) => p.variacao !== null && Math.round(p.variacao * 1000) < 0).length;

  return (
    <figure className="plan-grafico-figura">
      <figcaption className="plan-grafico-legenda">
        <span className="plan-grafico-chave"><span className="plan-chave plan-chave-base" aria-hidden />{anoBase}</span>
        <span className="plan-grafico-chave"><span className="plan-chave plan-chave-comparado" aria-hidden />{anoComparado}</span>
        <span className="plan-grafico-chave"><span className="plan-chave plan-chave-queda" aria-hidden />mês em queda{quedas > 0 ? ` (${quedas})` : ""}</span>
        <span className="plan-grafico-chave plan-grafico-chave-nota">{ROTULO[grandeza]} do Salão, total do mês{grandeza === "vendas" ? ", em R$" : ""}</span>
      </figcaption>
      <div ref={ref} className="plan-grafico">
        <svg width={largura} height={ALTURA} role="presentation" aria-hidden focusable="false" className="plan-grafico-svg">
          <defs>
            <pattern id="plan-hachura" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="plan-hachura-fundo" />
              <line x1="0" y1="0" x2="0" y2="5" className="plan-hachura-linha" />
            </pattern>
          </defs>
          {pares.map((p, i) => {
            const x0 = fatia * i;
            const centro = x0 + fatia / 2;
            const caiu = p.variacao !== null && Math.round(p.variacao * 1000) < 0;
            const subiu = p.variacao !== null && Math.round(p.variacao * 1000) > 0;
            const topoDoPar = Math.min(p.base === null ? BASE_DO_GRAFICO : y(p.base), p.comparado === null ? BASE_DO_GRAFICO : y(p.comparado));
            const nome = NOMES_DOS_MESES_CURTOS[p.mes - 1];
            const variacao = p.variacao === null ? null : estreito ? textoDaVariacao(p.variacao).replace(/,\d/, "") : textoDaVariacao(p.variacao);
            return (
              <g key={p.mes} className="plan-grafico-coluna">
                {caiu && <rect x={x0 + 1} y={TOPO - 26} width={fatia - 2} height={BASE_DO_GRAFICO - TOPO + 26} rx={3} className="plan-grafico-queda" />}
                {p.base !== null && (
                  <rect x={centro - barra - 1} y={y(p.base)} width={barra} height={Math.max(1, BASE_DO_GRAFICO - y(p.base))} rx={2} className="plan-grafico-barra plan-barra-base">
                    <title>{`${nome} de ${anoBase}: ${ocultar ? "valor oculto" : valorCurto(grandeza, p.base)}`}</title>
                  </rect>
                )}
                {p.comparado !== null && (
                  <rect x={centro + 1} y={y(p.comparado)} width={barra} height={Math.max(1, BASE_DO_GRAFICO - y(p.comparado))} rx={2} className={`plan-grafico-barra ${p.parcial ? "plan-barra-parcial" : "plan-barra-comparado"}`}>
                    <title>{`${nome} de ${anoComparado}${p.parcial ? " (parcial)" : ""}: ${ocultar ? "valor oculto" : valorCurto(grandeza, p.comparado)}`}</title>
                  </rect>
                )}
                {mostraValor && p.comparado !== null && (
                  <text x={centro} y={topoDoPar - 20} textAnchor="middle" className="plan-grafico-eixo" fontSize={fonte - 1}>{valorCurto(grandeza, p.comparado)}</text>
                )}
                {variacao && !p.parcial && (
                  <text x={centro} y={topoDoPar - 6} textAnchor="middle" className={`plan-grafico-valor${caiu ? " plan-grafico-valor-falta" : subiu ? " plan-grafico-valor-sobra" : ""}`} fontSize={fonte}>{variacao}</text>
                )}
                {p.parcial && <text x={centro} y={topoDoPar - 6} textAnchor="middle" className="plan-grafico-parcial" fontSize={fonte - 0.5}>parcial</text>}
                {p.parcial && p.comparado === null && p.base !== null && (
                  <text x={centro + barra / 2 + 1} y={BASE_DO_GRAFICO - 4} textAnchor="start" className="plan-grafico-sem-base" fontSize={fonte - 1.5} transform={`rotate(-90 ${centro + barra / 2 + 1} ${BASE_DO_GRAFICO - 4})`} dominantBaseline="middle">{estreito ? "sem venda" : "sem venda lançada"}</text>
                )}
                {contagem(p.mes) > 0 && (
                  <g className="plan-coment-ponto-grafico" aria-hidden onClick={() => comentarios?.abrir({ mes: p.mes, metrica: metricaDaGrandeza(grandeza), turno: "TOTAL" })}>
                    <rect x={x0} y={0} width={fatia} height={TOPO - 8} fill="transparent" />
                    <circle cx={fatia >= 60 ? x0 + fatia - 11 : centro} cy={10} r={9} className="plan-coment-bolha" />
                    <text x={fatia >= 60 ? x0 + fatia - 11 : centro} y={10} textAnchor="middle" dominantBaseline="central" className="plan-coment-bolha-texto" fontSize={10}>{contagem(p.mes)}</text>
                  </g>
                )}
                <text x={centro} y={ALTURA - 20} textAnchor="middle" className="plan-grafico-mes" fontSize={fonte}>{nome}</text>
              </g>
            );
          })}
          <line x1={0} x2={largura} y1={BASE_DO_GRAFICO + 0.5} y2={BASE_DO_GRAFICO + 0.5} className="plan-grafico-zero" />
        </svg>
      </div>
      <ul className="plan-sr">
        {pares.map((p) => (
          <li key={p.mes}>
            {NOMES_DOS_MESES_CURTOS[p.mes - 1]}{p.parcial ? " (parcial)" : ""}: {anoBase} {p.base === null ? "sem dado" : valorCurto(grandeza, p.base)}, {anoComparado} {p.comparado === null ? (p.parcial ? "sem venda lançada ainda" : "sem dado") : valorCurto(grandeza, p.comparado)}, variação {textoDaVariacao(p.variacao)}{contagem(p.mes) > 0 ? `, ${textoDaContagem(contagem(p.mes))}` : ""}
          </li>
        ))}
      </ul>
    </figure>
  );
}
