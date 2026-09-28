import { Loader2, Play } from "lucide-react";
import type { InventoryAgendaItem } from "../../api/client";
import { Button, PanelEyebrow, StatusBadge } from "../../design-system";
import { acaoDoDiaDaRotina, resumoDaRotina, rotuloDoStatusDaRotina } from "./routine";

export type RoutineWeekSectionProps = {
  items: InventoryAgendaItem[];
  loading: boolean;
  canStartCount: boolean;
  startingItemId: string | null;
  onStart: (item: InventoryAgendaItem) => void;
  onOpenSession: (sessionId: string) => void;
};

const diaDaSemana = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
const diaDoMes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

// A data vem como meia-noite local do servidor (UTC). Ler so a parte da data
// evita que 00:00Z vire o dia anterior no fuso de Brasilia.
function dataDoDia(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

/**
 * Rotina do estoquista: o que contar em cada dia da semana corrente. "Começar
 * contagem" abre uma sessão normal do setor, já ligada ao dia da agenda; o
 * status do dia vem dessa sessão.
 */
export function RoutineWeekSection({ items, loading, canStartCount, startingItemId, onStart, onOpenSession }: RoutineWeekSectionProps) {
  const resumo = resumoDaRotina(items);

  return (
    <section className="panel routine-week" aria-labelledby="routine-week-title">
      <div className="section-heading">
        <div>
          <PanelEyebrow>Rotina do estoquista</PanelEyebrow>
          <h2 id="routine-week-title">Contagens da semana</h2>
        </div>
        {resumo.total > 0 && (
          <p className="routine-week__resumo">
            <strong>{resumo.feitas} de {resumo.total}</strong> feitas
            {resumo.atrasadas > 0 && <span className="routine-week__atrasadas"> · {resumo.atrasadas} atrasada{resumo.atrasadas > 1 ? "s" : ""}</span>}
          </p>
        )}
      </div>

      {loading && items.length === 0 ? (
        <p className="muted"><Loader2 size={14} className="spin" /> Carregando a agenda…</p>
      ) : items.length === 0 ? (
        <p className="muted">Nenhuma contagem programada nesta semana.</p>
      ) : (
        <ol className="routine-week__lista">
          {items.map((item) => {
            const acao = acaoDoDiaDaRotina(item, canStartCount);
            const status = item.routineStatus ?? "PREVISTA";
            const rotulo = rotuloDoStatusDaRotina[status];
            const data = dataDoDia(item.scheduledDate);
            const alvo = item.activeSectorName ?? item.sectorName ?? item.categoryName;
            return (
              <li key={item.id} className={`routine-week__dia routine-week__dia--${status.toLowerCase()}`}>
                <div className="routine-week__data">
                  <span>{diaDaSemana.format(data).replace(".", "")}</span>
                  <strong>{diaDoMes.format(data)}</strong>
                </div>
                <div className="routine-week__alvo">
                  <strong>{alvo}</strong>
                  {acao.tipo === "sem-setor"
                    ? <small>{item.notes ?? "Sem setor para contar"}</small>
                    : item.sessionCode && <small>{item.sessionCode}</small>}
                </div>
                <StatusBadge tone={acao.tipo === "sem-setor" ? "neutral" : rotulo.tone}>{acao.tipo === "sem-setor" ? "Lembrete" : rotulo.label}</StatusBadge>
                <div className="routine-week__acao">
                  {acao.tipo === "comecar" && (
                    <Button
                      size="sm"
                      variant={acao.destaque ? "primary" : "secondary"}
                      leadingIcon={startingItemId === item.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                      disabled={startingItemId !== null}
                      onClick={() => onStart(item)}
                    >
                      Começar contagem
                    </Button>
                  )}
                  {acao.tipo === "continuar" && (
                    <Button size="sm" onClick={() => onOpenSession(acao.sessionId)}>Continuar</Button>
                  )}
                  {acao.tipo === "ver" && (
                    <Button size="sm" variant="secondary" onClick={() => onOpenSession(acao.sessionId)}>Ver contagem</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
