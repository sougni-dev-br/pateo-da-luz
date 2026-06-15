import { PeriodPreset, PeriodState, periodForPreset } from "../utils/period";

const options: Array<{ value: PeriodPreset; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "next7", label: "Próximos 7 dias" },
  { value: "next15", label: "Próximos 15 dias" },
  { value: "next30", label: "Próximos 30 dias" },
  { value: "currentMonth", label: "Mês atual" },
  { value: "previousMonth", label: "Mês anterior" },
  { value: "currentYear", label: "Ano atual" },
  { value: "custom", label: "Período personalizado" }
];

type PeriodFilterProps = {
  value: PeriodState;
  onChange: (value: PeriodState) => void;
  hideCustomFields?: boolean;
};

export function PeriodFilter({ value, onChange, hideCustomFields = false }: PeriodFilterProps) {
  function changePreset(preset: PeriodPreset) {
    if (preset === "custom") {
      onChange({ ...value, preset });
      return;
    }
    onChange(periodForPreset(preset));
  }

  return (
    <>
      <label>
        Período
        <select value={value.preset} onChange={(event) => changePreset(event.target.value as PeriodPreset)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {value.preset === "custom" && !hideCustomFields && (
        <>
          <label>
            Data inicial
            <input type="date" value={value.startDate} onChange={(event) => onChange({ ...value, startDate: event.target.value })} />
          </label>
          <label>
            Data final
            <input type="date" value={value.endDate} onChange={(event) => onChange({ ...value, endDate: event.target.value })} />
          </label>
        </>
      )}
    </>
  );
}
