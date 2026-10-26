import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { IconButton } from "../design-system";
import { isValidCompetence, MAX_YEAR, MIN_YEAR, monthInfo } from "../pages/dashboard/logic";
import "./MonthHeader.css";

type Props = {
  /** Linha pequena acima do título. Ex.: "Financeiro · Faturamento". */
  eyebrow: string;
  /** Competência mostrada, "AAAA-MM". */
  competence: string;
  loading: boolean;
  updatedAt: Date | null;
  onChange: (competence: string) => void;
  onStep: (delta: number) => void;
  onToday: () => void;
  onRefresh: () => void;
  /** Botões da tela, à esquerda do seletor de mês. */
  actions?: ReactNode;
  /** Quando a tela mostra um intervalo livre (e não o mês): título e status próprios. */
  rangeTitle?: string;
  rangeStatus?: string;
};

function timeLabel(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Cabeçalho de mês no modelo do Dashboard, em versão compacta: título do mês, andamento (dia X de N) e
 * seletor de mês com setas. A lógica de mês é a mesma do Dashboard (pages/dashboard/logic).
 */
export function MonthHeader({ eyebrow, competence, loading, updatedAt, onChange, onStep, onToday, onRefresh, actions, rangeTitle, rangeStatus }: Props) {
  const inputId = useId();
  const info = monthInfo(competence, new Date());
  const progress = info.daysInMonth > 0 ? (info.elapsedDays / info.daysInMonth) * 100 : 0;
  const showingRange = rangeTitle !== undefined;

  return (
    <header className="mh">
      <div className="mh-titles">
        <p className="mh-eyebrow">{eyebrow}</p>
        <h1 className="mh-title">{showingRange ? rangeTitle : info.label}</h1>
        <p className="mh-status">
          {showingRange ? (
            rangeStatus
          ) : info.isCurrent ? (
            <>
              <span className="mh-live-dot" aria-hidden />
              Em andamento · dia {info.elapsedDays} de {info.daysInMonth}
              <span className="mh-progress" aria-hidden>
                <span style={{ width: `${progress}%` }} />
              </span>
            </>
          ) : info.isFuture ? (
            "Mês ainda não começou"
          ) : (
            "Mês encerrado"
          )}
          {updatedAt && <span className="mh-updated">· atualizado às {timeLabel(updatedAt)}</span>}
        </p>
      </div>

      <div className="mh-controls">
        {actions && <div className="mh-actions">{actions}</div>}
        <div className="mh-stepper" role="group" aria-label="Competência">
          <button type="button" className="mh-stepper-btn" onClick={() => onStep(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <label className="mh-stepper-field" htmlFor={inputId}>
            <CalendarDays size={15} aria-hidden />
            <span className="mh-sr-only">Escolher competência</span>
            <input
              id={inputId}
              type="month"
              value={competence}
              min={`${MIN_YEAR}-01`}
              max={`${MAX_YEAR}-12`}
              onChange={(event) => isValidCompetence(event.target.value) && onChange(event.target.value)}
            />
          </label>
          <button type="button" className="mh-stepper-btn" onClick={() => onStep(1)} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </button>
        </div>
        {(!info.isCurrent || showingRange) && (
          <button type="button" className="mh-today-btn" onClick={onToday}>
            Mês atual
          </button>
        )}
        <IconButton icon={<RefreshCw size={16} className={loading ? "spin" : ""} />} label="Atualizar" onClick={onRefresh} disabled={loading} />
      </div>
    </header>
  );
}
