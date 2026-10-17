import { BellRing, CalendarClock, Check } from "lucide-react";
import { useMemo } from "react";
import type { ListaFerias } from "../../../api/client";
import { Button } from "../../../design-system";
import { ausenciasDaLista } from "./eixoDoTempo";
import { dataBr, plural } from "./feriasFormato";
import { prazosDeAviso, resumoPorMes } from "./planejamento";

const URGENTE_EM_DIAS = 7;

const quando = (dias: number) => (dias < 0 ? `passou há ${-dias} ${plural(-dias, "dia", "dias")}` : dias === 0 ? "hoje" : `em ${dias} ${plural(dias, "dia", "dias")}`);

/** Quanta gente a casa terá fora mês a mês e o que falta fazer antes de cada férias (avisar e pagar). */
export function PlanejamentoFerias({ lista, ocupado, onAvisado }: { lista: ListaFerias; ocupado: boolean; onAvisado: (programacaoId: string, avisado: boolean, nome: string) => void }) {
  const meses = useMemo(() => resumoPorMes(ausenciasDaLista(lista), lista.hoje), [lista]);
  const prazos = useMemo(() => prazosDeAviso(lista), [lista]);
  const maior = Math.max(1, ...meses.map((m) => m.diasFora));
  // O que falta fazer é avisar: quem já foi avisado sai da conta (o pagamento não é registrado aqui, só mostrado).
  const semAviso = prazos.filter((p) => p.avisadoEm === null);
  const urgentes = semAviso.filter((p) => p.diasParaAvisar <= URGENTE_EM_DIAS).length;
  const totalDias = meses.reduce((s, m) => s + m.diasFora, 0);
  const resumoPrazos = semAviso.length === 0 ? ""
    : urgentes > 0 ? ` · ${urgentes} ${plural(urgentes, "aviso urgente", "avisos urgentes")} (até ${URGENTE_EM_DIAS} dias)`
      : ` · ${semAviso.length} ${plural(semAviso.length, "aviso a fazer", "avisos a fazer")}`;

  return (
    <details className="fe-plano">
      <summary>
        <CalendarClock size={15} aria-hidden="true" /> Planejamento
        <span className="fe-sub">{totalDias} {plural(totalDias, "dia de férias", "dias de férias")} nos próximos 12 meses{resumoPrazos}</span>
      </summary>
      <div className="fe-plano-corpo">
        <section aria-labelledby="fe-plano-meses">
          <h3 id="fe-plano-meses">Dias de férias por mês</h3>
          <ol className="fe-plano-barras" aria-label="Dias de férias por mês">
            {meses.map((m) => (
              <li key={m.iso} title={`${m.nome}/${m.ano}: ${m.diasFora} ${plural(m.diasFora, "dia", "dias")} de férias somados, ${m.pessoas} ${plural(m.pessoas, "pessoa", "pessoas")}, até ${m.pico} ao mesmo tempo`}>
                <span className="fe-plano-valor">{m.diasFora || ""}</span>
                <i className={`fe-plano-barra${m.pico >= 3 ? " fe-plano-barra--cheia" : ""}`} style={{ height: `${Math.max(m.diasFora ? 6 : 2, (m.diasFora / maior) * 100)}%` }} />
                <span className="fe-plano-mes">{m.nome}</span>
                <span className="fe-plano-pico">{m.pico > 0 ? `${m.pico}×` : ""}</span>
              </li>
            ))}
          </ol>
          <p className="fe-sub">Altura: soma dos dias de todos que estarão fora. Embaixo do mês, “N×” é o máximo de pessoas fora ao mesmo tempo; a barra escura é o mês com 3 ou mais.</p>
        </section>

        <section aria-labelledby="fe-plano-avisos">
          <h3 id="fe-plano-avisos"><BellRing size={14} aria-hidden="true" /> Avisar e pagar</h3>
          {prazos.length === 0 ? (
            <p className="fe-sub">Nenhuma férias programada para começar.</p>
          ) : (
            <div className="fe-plano-rolagem">
              <table className="fe-plano-tabela">
                <thead><tr><th>Funcionário</th><th>Início</th><th>Avisar até (30 dias antes)</th><th>Avisado?</th><th>Pagar até (2 dias antes)</th></tr></thead>
                <tbody>
                  {prazos.map((p) => (
                    <tr key={p.chave}>
                      <td>{p.nome}</td>
                      <td>{dataBr(p.inicio)}</td>
                      <td className={p.avisadoEm ? "fe-plano-ok" : p.diasParaAvisar < 0 ? "fe-plano-passou" : p.diasParaAvisar <= URGENTE_EM_DIAS ? "fe-plano-logo" : undefined}>
                        {dataBr(p.avisarAte)} {!p.avisadoEm && <span className="fe-sub">{quando(p.diasParaAvisar)}</span>}
                      </td>
                      <td>
                        {p.avisadoEm ? (
                          <span className="fe-plano-avisado">
                            <Check size={13} aria-hidden="true" /> Avisado em {dataBr(p.avisadoEm.slice(0, 10))}
                            <button type="button" className="fe-plano-desfazer" aria-disabled={ocupado} aria-label={`Desfazer o aviso de ${p.nome}`}
                              onClick={() => { if (!ocupado) onAvisado(p.chave, false, p.nome); }}>desfazer</button>
                          </span>
                        ) : (
                          <Button size="sm" variant="secondary" leadingIcon={<Check size={13} />} aria-disabled={ocupado} aria-label={`Marcar que ${p.nome} foi avisado`}
                            onClick={() => { if (!ocupado) onAvisado(p.chave, true, p.nome); }}>Já avisei</Button>
                        )}
                      </td>
                      <td className={p.diasParaPagar <= URGENTE_EM_DIAS ? "fe-plano-logo" : undefined}>
                        {dataBr(p.pagarAte)} <span className="fe-sub">{quando(p.diasParaPagar)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </details>
  );
}
