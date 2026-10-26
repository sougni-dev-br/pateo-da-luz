import { RefreshCw } from "lucide-react";
import { Button, Card, Select, TextField } from "../design-system";
import { periodPresetOptions } from "../components/PeriodFilter";
import { periodForPreset, type PeriodPreset, type PeriodState } from "../utils/period";
import { REVENUE_CHANNELS } from "./revenueAnalytics";

const ALL_CHANNELS = "all";
const CMV_PERIOD = "cmv";

// O período da apuração CMV é só mais uma forma de escolher o período: fica na lista, não num botão à parte.
// "Personalizado" (e não "Período personalizado") é o mesmo texto da Análise do Salão e cabe no campo estreito.
// O mês é escolhido no cabeçalho (setas e seletor): aqui "Mês da competência" quer dizer "o mês do cabeçalho".
// Mês anterior e períodos futuros ficam de fora: as setas do cabeçalho já cobrem o primeiro, e faturamento não tem futuro.
const PERIOD_LABELS: Partial<Record<PeriodPreset, string>> = { currentMonth: "Mês da competência", custom: "Personalizado" };
const PERIOD_OPTIONS = [
  ...periodPresetOptions
    .filter((option) => !["previousMonth", "next7", "next15", "next30"].includes(option.value))
    .map((option) => ({ ...option, label: PERIOD_LABELS[option.value] ?? option.label })),
  { value: CMV_PERIOD, label: "Período da apuração CMV" }
];

const CHANNEL_OPTIONS = [{ value: ALL_CHANNELS, label: "Todos os canais" }, ...REVENUE_CHANNELS.map((channel) => ({ value: channel, label: channel }))];

type Props = {
  period: PeriodState;
  onPeriodChange: (period: PeriodState) => void;
  channel: string;
  onChannelChange: (channel: string) => void;
  loading: boolean;
  onApply: () => void;
  onUseCmvPeriod: () => void;
};

export function RevenueFilters({
  period,
  onPeriodChange,
  channel,
  onChannelChange,
  loading,
  onApply,
  onUseCmvPeriod
}: Props) {
  function changePeriodOption(value: string) {
    if (value === CMV_PERIOD) {
      onUseCmvPeriod();
      return;
    }
    const preset = value as PeriodPreset;
    onPeriodChange(preset === "custom" ? { ...period, preset } : periodForPreset(preset));
  }

  function changeCustomDate(field: "startDate" | "endDate", value: string) {
    onPeriodChange({ ...period, preset: "custom", [field]: value });
  }

  return (
    <Card>
      <div className="revenue-filter-bar">
        <Select
          label="Período"
          value={period.preset}
          options={PERIOD_OPTIONS}
          onChange={(event) => changePeriodOption(event.target.value)}
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
        <Select
          label="Canal"
          value={channel || ALL_CHANNELS}
          options={CHANNEL_OPTIONS}
          onChange={(event) => onChannelChange(event.target.value === ALL_CHANNELS ? "" : event.target.value)}
        />
        <div className="revenue-filter-actions">
          <Button leadingIcon={<RefreshCw size={16} className={loading ? "spin" : undefined} />} onClick={onApply} disabled={loading}>
            {loading ? "Carregando…" : "Aplicar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
