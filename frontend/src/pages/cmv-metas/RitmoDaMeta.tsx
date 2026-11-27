import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { VisoesMetaCmv } from "../../api/client";
import { Money, useFormatCurrency, useHideValues } from "../../design-system";
import { acumular, tetoAcumulado, type PontoAcumulado } from "./logic";

const ALTURA = 188;
const PAD = { top: 12, right: 12, bottom: 22, left: 66 };

function compacto(valor: number): string {
  if (Math.abs(valor) >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(valor) >= 1_000) return `R$ ${Math.round(valor / 1_000).toLocaleString("pt-BR")} mil`;
  return `R$ ${Math.round(valor)}`;
}

function topoRedondo(valor: number): number {
  if (valor <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(valor));
  const passo = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= valor / 4) ?? 10;
  return Math.ceil(valor / (passo * magnitude)) * passo * magnitude;
}

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largura] as const;
}

const nomeCurto = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
};

/**
 * Compras de CMV acumuladas no mês contra o teto da meta (faturamento acumulado × meta) e contra o
 * mês anterior. Responde "estou comprando acima do que a meta permite até hoje?" — o que o percentual
 * solto não mostra no meio do mês.
 */
type Props = {
  visoes: VisoesMetaCmv;
  /** O realizado do mês já é o CMV real do ciclo: o ritmo de compras vira só acompanhamento, sem semáforo. */
  realizadoPeloCmvReal?: boolean;
};

export function RitmoDaMeta({ visoes, realizadoPeloCmvReal = false }: Props) {
  const fmt = useFormatCurrency();
  const { hidden } = useHideValues();
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [diaFoco, setDiaFoco] = useState<number | null>(null);

  const compras = useMemo(() => acumular(visoes.ritmo.atual, "compras"), [visoes]);
  const anterior = useMemo(() => acumular(visoes.ritmo.anterior, "compras"), [visoes]);
  const teto = useMemo(() => (visoes.meta ? tetoAcumulado(visoes.ritmo.atual, visoes.meta.alvoPercentual) : []), [visoes]);

  const dias = Math.max(visoes.diasNoMes, visoes.diasNoMesAnterior);
  const ultimo = <T,>(l: T[]) => l[l.length - 1];
  const maximo = topoRedondo(Math.max(ultimo(compras)?.valor ?? 0, ultimo(anterior)?.valor ?? 0, ultimo(teto)?.valor ?? 0));
  const larguraUtil = Math.max(largura - PAD.left - PAD.right, 10);
  const alturaUtil = ALTURA - PAD.top - PAD.bottom;
  const x = (dia: number) => PAD.left + ((dia - 1) / Math.max(dias - 1, 1)) * larguraUtil;
  const y = (valor: number) => PAD.top + alturaUtil - (valor / maximo) * alturaUtil;
  const caminho = (ps: PontoAcumulado[]) => ps.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dia).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");

  const hoje = compras.length;
  const fimCompras = ultimo(compras);
  const fimTeto = ultimo(teto);
  const folga = fimCompras && fimTeto ? fimTeto.valor - fimCompras.valor : null;

  function diaDoPonteiro(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const razao = (e.clientX - r.left - PAD.left) / larguraUtil;
    return Math.min(Math.max(Math.round(razao * (dias - 1)) + 1, 1), dias);
  }
  function teclar(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const passo = e.key === "ArrowLeft" ? -1 : 1;
    setDiaFoco((d) => Math.min(Math.max((d ?? Math.max(hoje, 1)) + passo, 1), dias));
  }

  const focoCompras = diaFoco !== null ? compras[diaFoco - 1] : undefined;
  const focoTeto = diaFoco !== null ? teto[diaFoco - 1] : undefined;
  const focoAnterior = diaFoco !== null ? anterior[diaFoco - 1] : undefined;
  const tooltipEsq = diaFoco !== null ? Math.min(Math.max(x(diaFoco), 100), largura - 100) : 0;
  const mesAtual = nomeCurto(visoes.mes);
  const mesAnterior = nomeCurto(visoes.mesAnterior);

  return (
    <figure className="mt-ritmo">
      <figcaption className="mt-ritmo-legenda">
        <span className="mt-ritmo-chave mt-ritmo-chave--compras">Compras {mesAtual}</span>
        {visoes.meta && <span className="mt-ritmo-chave mt-ritmo-chave--teto">Teto da meta ({visoes.meta.alvoPercentual.toLocaleString("pt-BR")}%)</span>}
        <span className="mt-ritmo-chave mt-ritmo-chave--anterior">Compras {mesAnterior}</span>
        <span className="mt-ritmo-dica">acumulado no mês</span>
      </figcaption>
      {folga !== null && fimCompras && (fimCompras.valor > 0 || fimTeto!.valor > 0) && (
        <p className={`mt-ritmo-resumo${folga < 0 && !realizadoPeloCmvReal ? " mt-estouro" : ""}`}>
          {realizadoPeloCmvReal && "Em compras ÷ faturamento: "}
          Até o dia {fimCompras.dia}: compras <Money value={fimCompras.valor} /> para um teto de <Money value={fimTeto!.valor} />
          {folga < 0 ? <> — <strong>acima em <Money value={-folga} /></strong>.</> : <> — folga de <Money value={folga} />.</>}
          {realizadoPeloCmvReal && " A situação do mês segue o CMV real do ciclo, mostrado acima."}
        </p>
      )}
      {!visoes.meta && <p className="mt-ajuda">Sem meta geral neste mês: o teto não aparece no gráfico.</p>}
      <div ref={ref} className="mt-ritmo-area">
        {largura > 0 && (
          <svg
            width={largura}
            height={ALTURA}
            role="img"
            aria-label={`Compras de CMV acumuladas em ${mesAtual}${visoes.meta ? ", teto da meta" : ""} e ${mesAnterior}. Use as setas para percorrer os dias.`}
            tabIndex={0}
            onPointerDown={(e) => setDiaFoco(diaDoPonteiro(e))}
            onPointerMove={(e) => setDiaFoco(diaDoPonteiro(e))}
            // No toque o dedo sai da tela e dispara o "leave": o valor do dia fica até o próximo toque.
            onPointerLeave={(e) => { if (e.pointerType !== "touch") setDiaFoco(null); }}
            onKeyDown={teclar}
            onBlur={() => setDiaFoco(null)}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line className="mt-ritmo-grade" x1={PAD.left} x2={largura - PAD.right} y1={y(f * maximo)} y2={y(f * maximo)} />
                {!hidden && <text className="mt-ritmo-eixo" x={PAD.left - 8} y={y(f * maximo) + 4} textAnchor="end">{compacto(f * maximo)}</text>}
              </g>
            ))}
            {[1, 10, 20, visoes.diasNoMes].map((d) => (
              <text key={d} className="mt-ritmo-eixo" x={x(d)} y={ALTURA - 6} textAnchor="middle">{d}</text>
            ))}
            <path className="mt-ritmo-linha mt-ritmo-linha--anterior" d={caminho(anterior)} />
            {teto.length > 0 && <path className="mt-ritmo-linha mt-ritmo-linha--teto" d={caminho(teto)} />}
            {compras.length > 0 && <path className="mt-ritmo-linha mt-ritmo-linha--compras" d={caminho(compras)} />}
            {fimCompras && diaFoco === null && <circle className="mt-ritmo-ponto" cx={x(fimCompras.dia)} cy={y(fimCompras.valor)} r={4} />}
            {diaFoco !== null && (
              <g pointerEvents="none">
                <line className="mt-ritmo-cruz" x1={x(diaFoco)} x2={x(diaFoco)} y1={PAD.top} y2={PAD.top + alturaUtil} />
                {focoAnterior && <circle className="mt-ritmo-ponto mt-ritmo-ponto--anterior" cx={x(diaFoco)} cy={y(focoAnterior.valor)} r={4} />}
                {focoTeto && <circle className="mt-ritmo-ponto mt-ritmo-ponto--teto" cx={x(diaFoco)} cy={y(focoTeto.valor)} r={4} />}
                {focoCompras && <circle className="mt-ritmo-ponto" cx={x(diaFoco)} cy={y(focoCompras.valor)} r={4} />}
              </g>
            )}
          </svg>
        )}
        {diaFoco !== null && (
          <div className="mt-ritmo-tooltip" style={{ left: tooltipEsq }} aria-live="polite">
            <span className="mt-sub">Até o dia {diaFoco}</span>
            <span className="mt-ritmo-chave--compras"><strong>{focoCompras ? fmt(focoCompras.valor, { decimals: 0 }) : "—"}</strong> compras {mesAtual}</span>
            {visoes.meta && <span className="mt-ritmo-chave--teto"><strong>{focoTeto ? fmt(focoTeto.valor, { decimals: 0 }) : "—"}</strong> teto</span>}
            <span className="mt-ritmo-chave--anterior"><strong>{focoAnterior ? fmt(focoAnterior.valor, { decimals: 0 }) : "—"}</strong> compras {mesAnterior}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
