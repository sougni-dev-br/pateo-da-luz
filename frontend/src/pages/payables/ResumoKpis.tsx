import { Money, useHideValues } from "../../design-system";
import { formatCurrencyString } from "../../utils/format";
import { composicaoAPagar, type DiaAgenda } from "./regras";

export type CartaoResumo = "open" | "overdue" | "paidMonth" | "paidToday" | "next7" | "next30";

export type TotaisResumo = Record<CartaoResumo, number>;

type Cartao = { chave: CartaoResumo; rotulo: string; dica: string; tom: "warning" | "danger" | "success" | "info" | "neutral" };

// Cores iguais às da barra de urgência do painel; as legendas dizem o que cada total soma.
const CARTOES: Cartao[] = [
  { chave: "overdue", rotulo: "Vencido", dica: "atrasados", tom: "danger" },
  // Só os ainda não vencidos: a aba "Em aberto" da lista soma estes mais os vencidos.
  { chave: "open", rotulo: "A vencer", dica: "ainda no prazo", tom: "neutral" },
  { chave: "next7", rotulo: "Próx. 7 dias", dica: "em até 7 dias", tom: "warning" },
  { chave: "next30", rotulo: "Próx. 30 dias", dica: "inclui os 7", tom: "info" },
  { chave: "paidToday", rotulo: "Pago hoje", dica: "hoje", tom: "success" },
  { chave: "paidMonth", rotulo: "Pago no mês", dica: "no mês", tom: "success" }
];

type Props = {
  totais: TotaisResumo;
  quantidades: TotaisResumo;
  /** Cartão que está filtrando a lista agora. */
  ativo: CartaoResumo | null;
  agenda: DiaAgenda[];
  hoje: string;
  diaFoco: string | null;
  onCartao: (c: CartaoResumo) => void;
  onDia: (chave: string) => void;
};

/**
 * Panorama do caixa: quanto há a pagar e quão urgente é, a agenda dos próximos dias
 * e, abaixo, os seis totais de sempre (cada um é um botão que filtra a lista).
 */
export function ResumoKpis({ totais, quantidades, ativo, agenda, hoje, diaFoco, onCartao, onDia }: Props) {
  const { total, fatias } = composicaoAPagar(totais);
  const vencidoPct = fatias[0].pct;

  return (
    <div className="pg-panorama">
      <div className="pg-hero-linha">
        <section className="pg-hero" aria-label="Total a pagar">
          <span className="pg-hero-rotulo">A pagar</span>
          <strong className="pg-hero-valor"><Money value={total} /></strong>
          <p className={`pg-hero-frase${totais.overdue > 0 ? " pg-hero-frase--alerta" : ""}`}>
            {totais.overdue > 0
              ? <><Money value={totais.overdue} /> já venceram ({vencidoPct}% do total)</>
              : total > 0 ? "Nada vencido. Tudo no prazo." : "Nada a pagar no período carregado."}
          </p>
          <div className="pg-barra-urgencia" role="img" aria-label={`Composição: ${fatias.map((f) => `${f.rotulo} ${f.pct}%`).join(", ")}`}>
            {fatias.filter((f) => f.valor > 0).map((f) => (
              <span key={f.chave} className={`pg-fatia pg-fatia--${f.chave}`} style={{ flexGrow: f.valor }} />
            ))}
          </div>
          <ul className="pg-legenda">
            {fatias.map((f) => (
              <li key={f.chave} className={f.valor === 0 ? "pg-legenda--zero" : undefined}>
                <i className={`pg-fatia pg-fatia--${f.chave}`} aria-hidden="true" />
                <span>{f.rotulo}</span>
                <b className="pg-num"><Money value={f.valor} /></b>
              </li>
            ))}
          </ul>
        </section>

        <Agenda agenda={agenda} hoje={hoje} diaFoco={diaFoco} onDia={onDia} />
      </div>

      <div className="pg-kpis" role="group" aria-label="Resumo financeiro — clique para filtrar">
        {CARTOES.map((c) => {
          const valor = totais[c.chave];
          const qtd = quantidades[c.chave];
          const alerta = c.chave === "overdue" && valor > 0;
          return (
            <button
              key={c.chave}
              type="button"
              className={`pg-kpi pg-kpi--${c.tom}${alerta ? " pg-kpi--alerta" : ""}${ativo === c.chave ? " pg-kpi--ativo" : ""}`}
              aria-pressed={ativo === c.chave}
              onClick={() => onCartao(c.chave)}
            >
              <span className="pg-kpi-rotulo">{c.rotulo}</span>
              <strong className="pg-kpi-valor"><Money value={valor} /></strong>
              <span className="pg-kpi-dica">{qtd} {qtd === 1 ? "título" : "títulos"} · {c.dica}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function Agenda({ agenda, hoje, diaFoco, onDia }: { agenda: DiaAgenda[]; hoje: string; diaFoco: string | null; onDia: (chave: string) => void }) {
  const { hidden } = useHideValues();
  const maior = Math.max(...agenda.map((d) => d.total), 0);
  const totalAgenda = agenda.reduce((s, d) => s + d.total, 0);
  const algumForaDoPeriodo = agenda.some((d) => d.fora);

  return (
    <section className="pg-agenda" aria-label="Agenda dos próximos 14 dias">
      <header className="pg-agenda-topo">
        <span className="pg-hero-rotulo">Próximos 14 dias</span>
        {!hidden && <span className="pg-agenda-soma"><Money value={totalAgenda} /></span>}
      </header>
      <div className="pg-agenda-dias">
        {agenda.map((d) => {
          const dia = Number(d.chave.slice(8, 10));
          const sigla = SEMANA[new Date(`${d.chave}T12:00:00`).getDay()];
          const fimDeSemana = sigla === "sáb" || sigla === "dom";
          const altura = maior > 0 ? Math.max(d.total > 0 ? 12 : 0, Math.round((d.total / maior) * 100)) : 0;
          const resumo = d.fora
            ? "fora do período carregado"
            : d.qtd === 0 ? "nada vence" : `${d.qtd} ${d.qtd === 1 ? "título" : "títulos"}${hidden ? "" : ` · ${formatCurrencyString(d.total)}`}`;
          return (
            <button
              key={d.chave}
              type="button"
              className={`pg-dia${d.chave === hoje ? " pg-dia--hoje" : ""}${d.chave === diaFoco ? " pg-dia--foco" : ""}${fimDeSemana ? " pg-dia--fds" : ""}${d.fora ? " pg-dia--fora" : ""}`}
              disabled={d.fora || d.qtd === 0}
              aria-pressed={d.chave === diaFoco}
              onClick={() => onDia(d.chave)}
              title={`${sigla} ${String(dia).padStart(2, "0")}/${d.chave.slice(5, 7)} — ${resumo}`}
              aria-label={`Ver vencimentos de ${String(dia).padStart(2, "0")}/${d.chave.slice(5, 7)}: ${resumo}`}
            >
              <span className="pg-dia-coluna"><span className="pg-dia-barra" style={{ height: `${altura}%` }} /></span>
              <span className="pg-dia-num">{dia}</span>
              <span className="pg-dia-sigla">{sigla}</span>
            </button>
          );
        })}
      </div>
      {algumForaDoPeriodo && (
        <p className="pg-agenda-nota">Dias hachurados estão fora do período escolhido em Filtros.</p>
      )}
    </section>
  );
}
