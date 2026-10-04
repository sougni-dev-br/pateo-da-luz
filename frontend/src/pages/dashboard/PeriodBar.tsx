import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useId } from "react";
import { IconButton } from "../../design-system";
import { isValidCompetence, MAX_YEAR, MIN_YEAR, type MonthInfo } from "./logic";

type Props = {
  competence: string;
  info: MonthInfo;
  loading: boolean;
  updatedAt: Date | null;
  onChange: (competence: string) => void;
  onStep: (delta: number) => void;
  onToday: () => void;
  onRefresh: () => void;
};

function timeLabel(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function PeriodBar({ competence, info, loading, updatedAt, onChange, onStep, onToday, onRefresh }: Props) {
  const inputId = useId();
  const progress = info.daysInMonth > 0 ? (info.elapsedDays / info.daysInMonth) * 100 : 0;

  return (
    <header className="dash-period">
      <div className="dash-period-titles">
        <p className="dash-eyebrow">Dashboard · visão do mês</p>
        <h1 className="dash-period-title">{info.label}</h1>
        <p className="dash-period-status">
          {info.isCurrent ? (
            <>
              <span className="dash-live-dot" aria-hidden />
              Em andamento · dia {info.elapsedDays} de {info.daysInMonth}
              <span className="dash-period-progress" aria-hidden>
                <span style={{ width: `${progress}%` }} />
              </span>
            </>
          ) : info.isFuture ? (
            "Mês ainda não começou"
          ) : (
            "Mês encerrado"
          )}
          {updatedAt && <span className="dash-period-updated">· atualizado às {timeLabel(updatedAt)}</span>}
        </p>
      </div>

      <div className="dash-period-controls">
        <div className="dash-stepper" role="group" aria-label="Competência">
          <button type="button" className="dash-stepper-btn" onClick={() => onStep(-1)} aria-label="Mês anterior">
            <ChevronLeft size={16} />
          </button>
          <label className="dash-stepper-field" htmlFor={inputId}>
            <CalendarDays size={15} aria-hidden />
            <span className="sr-only">Escolher competência</span>
            <input
              id={inputId}
              type="month"
              value={competence}
              min={`${MIN_YEAR}-01`}
              max={`${MAX_YEAR}-12`}
              onChange={(e) => isValidCompetence(e.target.value) && onChange(e.target.value)}
            />
          </label>
          <button type="button" className="dash-stepper-btn" onClick={() => onStep(1)} aria-label="Próximo mês">
            <ChevronRight size={16} />
          </button>
        </div>
        {!info.isCurrent && (
          <button type="button" className="dash-today-btn" onClick={onToday}>Mês atual</button>
        )}
        <IconButton
          icon={<RefreshCw size={16} className={loading ? "spin" : ""} />}
          label="Atualizar"
          onClick={onRefresh}
          disabled={loading}
        />
      </div>
    </header>
  );
}
