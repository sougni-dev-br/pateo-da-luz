import type { ReceivableSummary } from "../../api/client";
import { Money, useHideValues } from "../../design-system";
import { formatCurrencyString } from "../../utils/format";
import { composicaoAPagar } from "../payables/regras";
import { ORIGEM_ROTULO, type DiaDaAgenda, type Foco } from "./regras";

type Cartao = { chave: Foco | "recebido"; rotulo: string; dica: string; tom: "danger" | "warning" | "info" | "success" | "neutral" };

// Mesmas janelas do servidor: "próximos 30" inclui os 7 e o dia de hoje; atrasadas ficam de fora.
const CARTOES: Cartao[] = [
  { chave: "atrasadas", rotulo: "Atrasadas", dica: "já deviam ter caído", tom: "danger" },
  { chave: "hoje", rotulo: "Previstas p/ hoje", dica: "caem hoje", tom: "warning" },
  { chave: "proximos7", rotulo: "Próx. 7 dias", dica: "inclui hoje", tom: "info" },
  { chave: "proximos30", rotulo: "Próx. 30 dias", dica: "inclui os 7", tom: "info" },
  { chave: "recebido", rotulo: "Recebido no mês", dica: "no mês", tom: "success" }
];

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

type Props = {
  resumo: ReceivableSummary | null;
  agenda: DiaDaAgenda[];
  hoje: string;
  carregando: boolean;
  foco: Foco | null;
  recebidoAtivo: boolean;
  diaFoco: string | null;
  onFoco: (foco: Foco) => void;
  onRecebidoMes: () => void;
  onDia: (chave: string) => void;
};

/**
 * Panorama do que vai entrar: total a receber e quão atrasado está, a agenda dos
 * próximos 14 dias por plataforma e, abaixo, os totais (cada um é um botão que filtra a lista).
 */
export function PanoramaReceber({ resumo, agenda, hoje, carregando, foco, recebidoAtivo, diaFoco, onFoco, onRecebidoMes, onDia }: Props) {
  const r = resumo;
  const aReceber = r?.pending.amount ?? 0;
  const atrasado = r?.overdue.amount ?? 0;
  const { fatias } = composicaoAPagar({
    overdue: atrasado,
    open: Math.max(0, aReceber - atrasado),
    next7: r?.next7.amount ?? 0,
    next30: r?.next30.amount ?? 0
  });
  const pctAtrasado = fatias[0].pct;

  const valorDe = (c: Cartao): { valor: number; qtd: number } => {
    if (!r) return { valor: 0, qtd: 0 };
    const mapa = { atrasadas: r.overdue, hoje: r.dueToday, proximos7: r.next7, proximos30: r.next30, recebido: r.receivedThisMonth };
    return { valor: mapa[c.chave].amount, qtd: mapa[c.chave].count };
  };

  return (
    <div className="pg-panorama" aria-busy={carregando}>
      <div className="pg-hero-linha">
        <section className="pg-hero" aria-label="Total a receber">
          <span className="pg-hero-rotulo">A receber</span>
          <strong className="pg-hero-valor"><Money value={aReceber} /></strong>
          <p className={`pg-hero-frase${atrasado > 0 ? " pg-hero-frase--alerta" : ""}`}>
            {!r
              ? "Calculando…"
              : atrasado > 0
                ? <><Money value={atrasado} /> estão atrasados ({pctAtrasado}% do total)</>
                : aReceber > 0 ? "Nada atrasado. Tudo dentro do previsto." : "Nada a receber no momento."}
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
                <span>{f.chave === "vencido" ? "Atrasado" : f.chave === "depois" ? "Depois de 30 dias" : f.rotulo}</span>
                <b className="pg-num"><Money value={f.valor} /></b>
              </li>
            ))}
          </ul>
        </section>

        <Agenda agenda={agenda} hoje={hoje} diaFoco={diaFoco} onDia={onDia} />
      </div>

      <div className="pg-kpis rc-kpis" role="group" aria-label="Totais — clique para filtrar a lista">
        {CARTOES.map((c) => {
          const { valor, qtd } = valorDe(c);
          const ativo = c.chave === "recebido" ? recebidoAtivo : foco === c.chave;
          const alerta = c.chave === "atrasadas" && valor > 0;
          return (
            <button
              key={c.chave}
              type="button"
              className={`pg-kpi pg-kpi--${c.tom}${alerta ? " pg-kpi--alerta" : ""}${ativo ? " pg-kpi--ativo" : ""}`}
              aria-pressed={ativo}
              onClick={() => (c.chave === "recebido" ? onRecebidoMes() : onFoco(c.chave))}
            >
              <span className="pg-kpi-rotulo">{c.rotulo}</span>
              <strong className="pg-kpi-valor"><Money value={valor} /></strong>
              <span className="pg-kpi-dica">
                {c.chave === "recebido" ? `${qtd} ${qtd === 1 ? "recebimento" : "recebimentos"}` : `${qtd} ${qtd === 1 ? "conta" : "contas"}`} · {c.dica}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ agenda, hoje, diaFoco, onDia }: { agenda: DiaDaAgenda[]; hoje: string; diaFoco: string | null; onDia: (chave: string) => void }) {
  const { hidden } = useHideValues();
  const maior = Math.max(...agenda.map((d) => d.total), 0);
  const totalAgenda = agenda.reduce((s, d) => s + d.total, 0);

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
          const data = `${String(dia).padStart(2, "0")}/${d.chave.slice(5, 7)}`;
          const porPlataforma = d.porOrigem.map((o) => `${ORIGEM_ROTULO[o.origem]}${hidden ? "" : ` ${formatCurrencyString(o.total)}`}`).join(" · ");
          const resumo = d.qtd === 0
            ? "nada previsto"
            : `${d.qtd} ${d.qtd === 1 ? "conta" : "contas"}${hidden ? "" : ` · ${formatCurrencyString(d.total)}`}${porPlataforma ? ` (${porPlataforma})` : ""}`;
          return (
            <button
              key={d.chave}
              type="button"
              className={`pg-dia${d.chave === hoje ? " pg-dia--hoje" : ""}${d.chave === diaFoco ? " pg-dia--foco" : ""}${fimDeSemana ? " pg-dia--fds" : ""}`}
              disabled={d.qtd === 0}
              aria-pressed={d.chave === diaFoco}
              onClick={() => onDia(d.chave)}
              title={`${sigla} ${data} — ${resumo}`}
              aria-label={`Ver recebimentos previstos para ${data}: ${resumo}`}
            >
              <span className="pg-dia-coluna"><span className="pg-dia-barra" style={{ height: `${altura}%` }} /></span>
              <span className="pg-dia-num">{dia}</span>
              <span className="pg-dia-sigla">{sigla}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
