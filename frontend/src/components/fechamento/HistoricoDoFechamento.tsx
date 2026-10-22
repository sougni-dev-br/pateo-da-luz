// Histórico do fechamento: o que aconteceu neste mês, e a situação dos últimos meses.
//
// Fica recolhido e só busca os dados quando abre: quase toda visita à tela é para
// conferir o mês, não para auditar. Aberto, acompanha o estado da tela — justificar
// algo agora faz o evento aparecer na linha do tempo sem recarregar.

import { ClipboardCheck, Lock, Unlock, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  getMonthlyClosureHistory,
  getMonthlyClosureOverview,
  type EventoDoHistorico,
  type MesDoHistorico,
  type MonthlyClosureState
} from "../../api/client";
import { Money, StatusBadge } from "../../design-system";
import { descreverEvento, rotuloDoMes } from "../../lib/fechamento-historico";
import { dataComHora } from "../../lib/fechamento-resumo";
import "./historicoDoFechamento.css";

type Props = {
  state: MonthlyClosureState;
  year: number;
  month: number;
};

const ICONE_DA_ACAO: Record<EventoDoHistorico["acao"], ReactNode> = {
  JUSTIFICOU: <ClipboardCheck size={15} />,
  REMOVEU_JUSTIFICATIVA: <X size={15} />,
  TRAVOU: <Lock size={15} />,
  REABRIU: <Unlock size={15} />
};

const chaveDoMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;

function ReaberturaDoMes({ mes }: { mes: MesDoHistorico }) {
  if (!mes.reabertoEm) return <>—</>;
  return (
    <span className="fhist-celula">
      {mes.reabertoPor ?? "—"}<br />
      <small>{dataComHora(mes.reabertoEm)}</small>
      {mes.motivoDaReabertura && <small className="fhist-motivo">{mes.motivoDaReabertura}</small>}
    </span>
  );
}

export function HistoricoDoFechamento({ state, year, month }: Props) {
  const [aberto, setAberto] = useState(false);
  const [eventos, setEventos] = useState<EventoDoHistorico[] | null>(null);
  const [meses, setMeses] = useState<MesDoHistorico[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    let ativo = true;
    Promise.all([getMonthlyClosureHistory(year, month), getMonthlyClosureOverview()])
      .then(([historicoDoMes, visaoDosMeses]) => {
        if (!ativo) return;
        setEventos(historicoDoMes);
        setMeses(visaoDosMeses);
        setErro(null);
      })
      .catch((e) => { if (ativo) setErro(e instanceof Error ? e.message : "Não foi possível carregar o histórico."); });
    return () => { ativo = false; };
  }, [aberto, state, year, month]);

  return (
    <details className="fhist panel" onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary>
        <span className="fhist-titulo">Histórico</span>
        {eventos && <span className="fhist-resumo">{eventos.length} {eventos.length === 1 ? "registro" : "registros"} neste mês</span>}
      </summary>

      {erro && <p className="fhist-erro" role="alert">{erro}</p>}
      {aberto && !erro && (!eventos || !meses) && <p className="muted" role="status">Carregando histórico…</p>}

      {eventos && meses && !erro && (
        <div className="fhist-corpo">
          <section aria-labelledby="fhist-mes">
            <h4 id="fhist-mes">Neste mês · {rotuloDoMes(year, month)}</h4>
            {eventos.length === 0 ? (
              <p className="muted">Nada registrado neste mês ainda: nenhuma justificativa, conferência, trava ou reabertura.</p>
            ) : (
              <ol className="fhist-linha">
                {eventos.map((evento) => {
                  const d = descreverEvento(evento, state);
                  return (
                    <li key={evento.id} className={`fhist-evento fhist-${d.tom}`}>
                      <span className="fhist-marca" aria-hidden="true">{ICONE_DA_ACAO[evento.acao]}</span>
                      <div>
                        <p className="fhist-titulo-evento">
                          <strong>{d.rotulo}</strong>{d.alvo && <> · {d.alvo}</>}
                        </p>
                        {d.texto && <p className="fhist-texto">{d.texto}</p>}
                        <small>{d.por} · {d.quando}</small>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section aria-labelledby="fhist-meses">
            <h4 id="fhist-meses">Últimos meses</h4>
            {meses.length === 0 ? (
              <p className="muted">Nenhum mês com fechamento iniciado.</p>
            ) : (
              <table className="data-table fm-tabela fm-tabela-empilhada fhist-tabela">
                <thead>
                  <tr>
                    <th>Mês</th><th>Situação</th><th>Travado por</th><th>Reabertura</th>
                    <th className="num">Registros</th><th className="num">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m) => {
                    const atual = m.ano === year && m.mes === month;
                    return (
                      <tr key={chaveDoMes(m.ano, m.mes)} className={atual ? "fhist-atual" : undefined} aria-current={atual ? "true" : undefined}>
                        <td data-label="Mês">
                          <Link to={`/cmv/fechamento-mensal/${chaveDoMes(m.ano, m.mes)}`}>{rotuloDoMes(m.ano, m.mes)}</Link>
                        </td>
                        <td data-label="Situação">
                          <StatusBadge tone={m.travado ? "success" : "warning"}>{m.travado ? "Travado" : "Em aberto"}</StatusBadge>
                        </td>
                        <td data-label="Travado por">
                          {m.travado && m.travadoEm
                            ? <span className="fhist-celula">{m.travadoPor ?? "—"}<br /><small>{dataComHora(m.travadoEm)}</small></span>
                            : "—"}
                        </td>
                        <td data-label="Reabertura"><ReaberturaDoMes mes={m} /></td>
                        <td data-label="Registros" className="num">{m.justificativas}</td>
                        <td data-label="Faturamento" className="num">{m.faturamentoBruto > 0 ? <Money value={m.faturamentoBruto} /> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </details>
  );
}
