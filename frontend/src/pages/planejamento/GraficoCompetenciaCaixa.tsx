import type { PlanejamentoCaixa, PlanejamentoResultado } from "../../api/client";
import { NOMES_DOS_MESES, NOMES_DOS_MESES_CURTOS } from "./formato";
import { compacto, emMil, Reais } from "./Reais";
import { useLargura } from "./useLargura";
import { useOculto } from "./useOculto";

// Competência × caixa no mesmo mês, lado a lado: ouro é o lucro (quando a venda e o gasto acontecem), azul é o
// resultado de caixa (quando o dinheiro entra e sai). A faixa entre os dois topos mostra o descompasso, e o mês em
// que ele é maior vem escrito na legenda: é ali que o prazo de cartão e de fornecedor mais pesa.

type Props = { resultado: PlanejamentoResultado; caixa: PlanejamentoCaixa | null };

const ALTURA = 236;
const TOPO = 24;
const BASE_DO_GRAFICO = ALTURA - 46;
const ESTREITO = 640;
/** Coluna mais estreita que isso não cabe "sem base" sem encostar na vizinha (Nov e Dez em 1024px). */
const LARGURA_DO_SEM_BASE = 64;

export function GraficoCompetenciaCaixa({ resultado, caixa }: Props) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const hidden = useOculto();
  const meses = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    lucro: resultado.meses[i]?.lucro ?? null,
    caixa: caixa?.meses[i]?.resultado ?? null
  }));
  const valores = meses.flatMap((m) => [m.lucro, m.caixa]).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;

  const descompassos = meses
    .filter((m) => m.lucro !== null && m.caixa !== null)
    .map((m) => ({ mes: m.mes, diferenca: (m.caixa ?? 0) - (m.lucro ?? 0) }))
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));
  const maior = descompassos[0] && Math.abs(descompassos[0].diferenca) >= 1 ? descompassos[0] : null;

  const estreito = largura < ESTREITO;
  const margem = estreito ? 20 : 44;
  const fatia = (largura - margem) / 12;
  const maximo = Math.max(0, ...valores);
  const minimo = Math.min(0, ...valores);
  const faixa = maximo - minimo || 1;
  const y = (v: number) => TOPO + ((maximo - v) / faixa) * (BASE_DO_GRAFICO - TOPO);
  const zero = y(0);
  const barra = Math.max(4, Math.min(26, fatia * 0.32));
  const fonte = estreito ? 9.5 : 10.5;
  const mostraValores = !estreito && !hidden && fatia >= 64;

  const desenharBarra = (valor: number, x: number, classe: string, titulo: string) => {
    const topo = Math.min(y(valor), zero);
    const altura = Math.max(2, Math.abs(y(valor) - zero));
    const negativo = valor < 0;
    return (
      <>
        <rect x={x} y={topo} width={barra} height={altura} rx={2} className={`plan-grafico-barra ${classe}${negativo ? " plan-barra-desce" : ""}`}>
          <title>{titulo}</title>
        </rect>
        {mostraValores && (
          <text x={x + barra / 2} y={negativo ? topo + altura + fonte + 2 : topo - 4} textAnchor="middle" className={`plan-grafico-valor${negativo ? " plan-grafico-valor-falta" : ""}`} fontSize={fonte}>{compacto(valor)}</text>
        )}
      </>
    );
  };

  return (
    <figure className="plan-grafico-figura plan-grafico-cartao">
      <figcaption className="plan-grafico-legenda">
        <span className="plan-grafico-chave"><span className="plan-chave plan-chave-competencia" aria-hidden />Lucro · competência</span>
        <span className="plan-grafico-chave"><span className="plan-chave plan-chave-caixa" aria-hidden />Resultado · caixa</span>
        {maior && (
          <span className="plan-grafico-chave plan-grafico-chave-nota">
            Maior descompasso em {NOMES_DOS_MESES[maior.mes - 1]}: o caixa fica {hidden ? "••••" : emMil(Math.abs(maior.diferenca))} {maior.diferenca < 0 ? "abaixo" : "acima"} do lucro
            {!mostraValores && !hidden && <> (lucro {emMil(meses[maior.mes - 1].lucro ?? 0)}, caixa {emMil(meses[maior.mes - 1].caixa ?? 0)})</>}
          </span>
        )}
      </figcaption>
      <div ref={ref} className="plan-grafico">
        <svg width={largura} height={ALTURA} role="presentation" aria-hidden focusable="false" className="plan-grafico-svg">
          <line x1={margem} x2={largura} y1={zero} y2={zero} className="plan-grafico-zero" />
          <text x={margem - 6} y={zero + 4} textAnchor="end" className="plan-grafico-eixo" fontSize={fonte}>{estreito ? "0" : "R$ 0"}</text>
          {meses.map((m, i) => {
            const centro = margem + fatia * i + fatia / 2;
            const nome = NOMES_DOS_MESES_CURTOS[i];
            const destaque = maior?.mes === m.mes;
            const temDois = m.lucro !== null && m.caixa !== null;
            return (
              <g key={m.mes} className="plan-grafico-coluna">
                {destaque && <rect x={margem + fatia * i + 1} y={TOPO - 18} width={fatia - 2} height={BASE_DO_GRAFICO - TOPO + 34} rx={3} className="plan-grafico-destaque" />}
                {temDois && (
                  <rect x={centro - 1.5} y={Math.min(y(m.lucro ?? 0), y(m.caixa ?? 0))} width={3} height={Math.abs(y(m.lucro ?? 0) - y(m.caixa ?? 0))} className="plan-grafico-vao" />
                )}
                {m.lucro !== null && desenharBarra(m.lucro, centro - barra - 2, "plan-barra-competencia", `${nome}, lucro: ${hidden ? "valor oculto" : emMil(m.lucro)}`)}
                {m.caixa !== null && desenharBarra(m.caixa, centro + 2, "plan-barra-caixa", `${nome}, caixa: ${hidden ? "valor oculto" : emMil(m.caixa)}`)}
                {m.lucro === null && m.caixa === null && <text x={centro} y={zero - 6} textAnchor="middle" className="plan-grafico-sem-base" fontSize={fonte - 1}>{fatia < LARGURA_DO_SEM_BASE ? "—" : "sem base"}</text>}
                <text x={centro} y={ALTURA - 8} textAnchor="middle" className={`plan-grafico-mes${destaque ? " plan-grafico-mes-forte" : ""}`} fontSize={fonte}>{nome}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="plan-sr">
        {meses.map((m) => (
          <li key={m.mes}>
            {NOMES_DOS_MESES_CURTOS[m.mes - 1]}: lucro {m.lucro === null ? "sem base" : <Reais valor={m.lucro} />}, caixa {m.caixa === null ? "não calculado" : <Reais valor={m.caixa} />}
          </li>
        ))}
      </ul>
    </figure>
  );
}
