import { RefreshCw } from "lucide-react";
import { Button, Card, Select, TextField } from "../design-system";
import { periodPresetOptions } from "../components/PeriodFilter";
import { periodForPreset, type PeriodPreset, type PeriodState } from "../utils/period";
import { REVENUE_CHANNELS } from "./revenueAnalytics";
import type { AppliedFilter } from "./revenueView";
import { formatNumber } from "../utils/format";

const CHANNEL_OPTIONS = [{ value: "", label: "Todos os canais" }, ...REVENUE_CHANNELS.map((channel) => ({ value: channel, label: channel }))];

type Props = {
  month: string;
  onMonthChange: (month: string) => void;
  period: PeriodState;
  onPeriodChange: (period: PeriodState) => void;
  channel: string;
  onChannelChange: (channel: string) => void;
  loading: boolean;
  onApply: () => void;
  onUseCmvPeriod: () => void;
  applied: AppliedFilter | null;
  isDirty: boolean;
  entriesCount: number;
};

export function RevenueFilters({
  month,
  onMonthChange,
  period,
  onPeriodChange,
  channel,
  onChannelChange,
  loading,
  onApply,
  onUseCmvPeriod,
  applied,
  isDirty,
  entriesCount
}: Props) {
  function changePreset(preset: PeriodPreset) {
    onPeriodChange(preset === "custom" ? { ...period, preset } : periodForPreset(preset));
  }

  function changeCustomDate(field: "startDate" | "endDate", value: string) {
    onPeriodChange({ ...period, preset: "custom", [field]: value });
  }

  return (
    <Card>
      <div className="revenue-filter-bar">
        <TextField label="Competência" type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} />
        <Select
          label="Período"
          value={period.preset}
          options={periodPresetOptions}
          onChange={(event) => changePreset(event.target.value as PeriodPreset)}
        />
        {period.preset === "custom" && (
          <>
            <TextField
              label="De"
              type="date"
              value={period.startDate}
              max={period.endDate || undefined}
              onChange={(event) => changeCustomDate("startDate", event.target.value)}
            />
            <TextField
              label="Até"
              type="date"
              value={period.endDate}
              min={period.startDate || undefined}
              onChange={(event) => changeCustomDate("endDate", event.target.value)}
            />
          </>
        )}
        <Select label="Canal" value={channel} options={CHANNEL_OPTIONS} onChange={(event) => onChannelChange(event.target.value)} />
        <div className="revenue-filter-actions">
          <Button variant="secondary" onClick={onUseCmvPeriod}>
            Período do CMV
          </Button>
          <Button leadingIcon={<RefreshCw size={16} className={loading ? "spin" : undefined} />} onClick={onApply} disabled={loading}>
            {loading ? "Carregando…" : "Aplicar"}
          </Button>
        </div>
      </div>

      {applied && (
        <p className="revenue-contexto" aria-live="polite">
          Exibindo <strong>{applied.periodLabel}</strong> · <strong>{applied.channelLabel}</strong> · {formatNumber(entriesCount)}{" "}
          {entriesCount === 1 ? "lançamento" : "lançamentos"}
          {isDirty && <span className="revenue-contexto-aviso"> — filtros alterados: clique em Aplicar para atualizar</span>}
        </p>
      )}
    </Card>
  );
}
