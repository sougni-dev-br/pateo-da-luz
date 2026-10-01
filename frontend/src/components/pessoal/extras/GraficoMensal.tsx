import { useEffect, useRef, useState } from "react";
import type { ExtraMesPainel } from "../../../api/client";
import { brl, diariasTexto } from "./extrasRotulos";

// Colunas empilhadas por mês: equipe da casa (baixo) e freelancers (cima).
// Regras: coluna ≤ 24px, 2px de superfície entre segmentos, topo arredondado
// (4px) e base reta, grade fina, legenda sempre visível, rótulo só no último
// mês; o resto vai na dica (mouse/teclado) e na tabela abaixo.
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (chave: string) => `${MESES_CURTOS[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`;

const ALTURA = 220;
const MARGEM = { topo: 22, direita: 12, base: 28, esquerda: 56 };
const LARGURA_MAX_COLUNA = 24;
const RAIO = 4;
const VAO = 2;

// Topo "redondo" para a escala: 1, 2 ou 5 × potência de 10.
function tetoLimpo(v: number) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  // Teto divisível por 4 em valor redondo: as marcas são quartos (1, 2, 4, 6, 8 × 10ⁿ).
  const passo = [1, 2, 4, 6, 8, 10].find((m) => m * p >= v)! * p;
  return passo;
}
const eixo = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${v.toLocaleString("pt-BR")}`);

// Retângulo com só os cantos de cima arredondados (base reta no chão).
function topoArredondado(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

export function GraficoMensal({ meses }: { meses: ExtraMesPainel[] }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  const [ativo, setAtivo] = useState<number | null>(null);

  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.max(220, Math.round(e.contentRect.width))));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const maior = Math.max(...meses.map((m) => m.casa + m.fora), 0);
  const teto = tetoLimpo(maior);
  const areaW = largura - MARGEM.esquerda - MARGEM.direita;
  const areaH = ALTURA - MARGEM.topo - MARGEM.base;
  const banda = areaW / Math.max(meses.length, 1);
  const colW = Math.min(LARGURA_MAX_COLUNA, banda * 0.6);
  const y = (v: number) => MARGEM.topo + areaH - (v / teto) * areaH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * teto);
  const ultimo = meses.length - 1;
  // Faixa estreita (12 meses no celular): rótulo de mês alternado, contando do último.
  const passoRotulo = banda < 44 ? 2 : 1;
  const m = ativo != null ? meses[ativo] : null;

  return (
    <div className="extras-grafico" ref={caixa}>
      <div className="extras-legenda" aria-hidden="true">
        <span><i className="casa" /> Equipe da casa</span>
        <span><i className="fora" /> Freelancers</span>
      </div>
      <svg width={largura} height={ALTURA} role="group" aria-label={`Gasto com extras por mês, de ${rotuloMes(meses[0]?.mes ?? "")} a ${rotuloMes(meses[ultimo]?.mes ?? "")}. Valores na tabela abaixo.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(t)} y2={y(t)} className="extras-grade" />
            <text x={MARGEM.esquerda - 8} y={y(t)} className="extras-eixo" textAnchor="end" dominantBaseline="middle">{eixo(t)}</text>
          </g>
        ))}
        {meses.map((mes, i) => {
          const cx = MARGEM.esquerda + banda * i + banda / 2;
          const x = cx - colW / 2;
          const hCasa = (mes.casa / teto) * areaH;
          const hFora = (mes.fora / teto) * areaH;
          // Vão de 2px só quando os dois segmentos existem.
          const vao = hCasa > 0 && hFora > 0 ? VAO : 0;
          const base = MARGEM.topo + areaH;
          const topoCasa = base - hCasa;
          const soCasa = hFora === 0;
          return (
            <g key={mes.mes} className={ativo === i ? "extras-coluna ativa" : "extras-coluna"}>
              {hCasa > 0 && (soCasa
                ? <path d={topoArredondado(x, topoCasa, colW, hCasa, RAIO)} className="casa" />
                : <rect x={x} y={topoCasa} width={colW} height={hCasa} className="casa" />)}
              {hFora > 0 && <path d={topoArredondado(x, topoCasa - vao - hFora, colW, hFora, RAIO)} className="fora" />}
              {(ultimo - i) % passoRotulo === 0 && <text x={cx} y={ALTURA - 8} className="extras-eixo" textAnchor="middle">{rotuloMes(mes.mes)}</text>}
              {i === ultimo && mes.casa + mes.fora > 0 && (
                <text x={cx} y={y(mes.casa + mes.fora) - 6} className="extras-rotulo-valor" textAnchor="middle">{brl(mes.casa + mes.fora)}</text>
              )}
              {/* Alvo de mouse/teclado: a banda inteira, maior que a coluna. */}
              <rect
                x={MARGEM.esquerda + banda * i} y={MARGEM.topo} width={banda} height={areaH}
                className="extras-alvo" tabIndex={0} role="img"
                aria-label={`${rotuloMes(mes.mes)}: equipe da casa ${brl(mes.casa)}, freelancers ${brl(mes.fora)}, total ${brl(mes.total)}`}
                onMouseEnter={() => setAtivo(i)} onMouseLeave={() => setAtivo(null)}
                onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)}
              />
            </g>
          );
        })}
      </svg>
      {m && ativo != null && (
        <div
          className="extras-dica" aria-hidden="true"
          style={{ left: Math.min(Math.max(MARGEM.esquerda + banda * ativo + banda / 2, 90), largura - 90), top: Math.max(y(m.casa + m.fora) - 8, 30) }}
        >
          <strong>{rotuloMes(m.mes)}</strong>
          <span><i className="casa" /> Casa <b>{brl(m.casa)}</b></span>
          <span><i className="fora" /> Freelancers <b>{brl(m.fora)}</b></span>
          {m.diferencaPaga !== 0 && <span>Diferença paga <b>{brl(m.diferencaPaga)}</b></span>}
          <span className="extras-dica-total">Total <b>{brl(m.total)}</b></span>
          <small className="extras-sub">{m.diarias ? diariasTexto(m.diarias) : "Nenhuma diária"}</small>
        </div>
      )}
    </div>
  );
}
