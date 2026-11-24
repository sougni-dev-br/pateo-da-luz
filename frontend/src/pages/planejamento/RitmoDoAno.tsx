import type { ReactNode } from "react";
import type { PlanejamentoComparativo } from "../../api/client";
import { NOMES_DOS_MESES_CURTOS, textoDaVariacao } from "./formato";
import { useLargura } from "./useLargura";

// O ritmo da variação das vendas, mês a mês, dentro do veredito do comparativo: uma barra por mês acima (subiu) ou
// abaixo (caiu) da linha do zero. Mostra se a queda do acumulado veio de um trecho do ano ou do ano inteiro.

const ALTURA = 96;
const MEIO = 44;
const AMPLITUDE = 36;

export type VariacaoDoMes = { mes: number; variacao: number | null };

export function RitmoDoAno({ dados }: { dados: PlanejamentoComparativo }) {
  const meses = dados.meses.map((m) => ({ mes: m.mes, variacao: m.comparavel ? m.variacao.vendas.total : null }));
  return <RitmoMensal titulo={`Vendas mês a mês contra ${dados.anoBase}`} meses={meses} />;
}

/** Uma barra por mês, acima (subiu) ou abaixo (caiu) do zero. Também usada nas premissas, redesenhada a cada prévia. */
export function RitmoMensal({ titulo, meses, className, extra }: { titulo: ReactNode; meses: VariacaoDoMes[]; className?: string; extra?: ReactNode }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const valores = meses.map((m) => m.variacao).filter((v): v is number => v !== null);
  if (valores.length < 2) return null;
  const maximo = Math.max(...valores.map(Math.abs), 0.01);
  const fatia = largura / 12;
  const barra = Math.max(6, Math.min(18, fatia * 0.45));
  const fonte = largura < 360 ? 9.5 : 10.5;

  return (
    <figure className={["plan-ritmo", className].filter(Boolean).join(" ")}>
      <figcaption className="plan-ritmo-titulo">{titulo}{extra}</figcaption>
      <div ref={ref} className="plan-grafico">
        <svg width={largura} height={ALTURA} role="presentation" aria-hidden focusable="false" className="plan-grafico-svg">
          <line x1={0} x2={largura} y1={MEIO + 0.5} y2={MEIO + 0.5} className="plan-grafico-zero" />
          {meses.map(({ mes, variacao }, i) => {
            const centro = fatia * i + fatia / 2;
            const nome = NOMES_DOS_MESES_CURTOS[mes - 1].charAt(0);
            if (variacao === null) return <text key={mes} x={centro} y={ALTURA - 4} textAnchor="middle" className="plan-grafico-sem-base" fontSize={fonte}>{nome}</text>;
            const altura = Math.max(2, (Math.abs(variacao) / maximo) * AMPLITUDE);
            const sobe = variacao >= 0;
            return (
              <g key={mes}>
                <rect x={centro - barra / 2} y={sobe ? MEIO - altura : MEIO + 1} width={barra} height={altura} rx={2} className={`plan-grafico-barra ${sobe ? "plan-barra-sobra" : "plan-barra-falta"}${sobe ? "" : " plan-barra-desce"}`}>
                  <title>{`${NOMES_DOS_MESES_CURTOS[mes - 1]}: ${textoDaVariacao(variacao)}`}</title>
                </rect>
                <text x={centro} y={ALTURA - 4} textAnchor="middle" className="plan-grafico-mes" fontSize={fonte}>{nome}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="plan-sr">{meses.filter((m) => m.variacao !== null).map((m) => `${NOMES_DOS_MESES_CURTOS[m.mes - 1]} ${textoDaVariacao(m.variacao)}`).join("; ")}.</p>
    </figure>
  );
}
