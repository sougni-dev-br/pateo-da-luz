import { RefreshCw } from "lucide-react";
import { Button, TextField } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { PERIODOS_PRONTOS, intervaloDoPeriodo, periodoProntoDe, type PeriodoPronto } from "./analise";

type Props = {
  de: string;
  ate: string;
  carregando: boolean;
  onMudar: (de: string, ate: string) => void;
  onAtualizar: () => void;
};

/** Atalhos de período (o que se pede no dia a dia) e, para o resto, as datas. */
export function PeriodoDoDesperdicio({ de, ate, carregando, onMudar, onAtualizar }: Props) {
  const hoje = hojeLocalIso();
  const ativo = periodoProntoDe(de, ate, hoje);
  const escolher = (periodo: PeriodoPronto) => {
    const { de: novoDe, ate: novoAte } = intervaloDoPeriodo(periodo, hoje);
    onMudar(novoDe, novoAte);
  };
  return (
    <div className="waste-period">
      <div className="waste-period-chips" role="group" aria-label="Período">
        {PERIODOS_PRONTOS.map((p) => (
          <button key={p.value} type="button" aria-pressed={ativo === p.value} className={ativo === p.value ? "waste-chip waste-chip-on" : "waste-chip"} onClick={() => escolher(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="waste-filters">
        <TextField label="De" type="date" value={de} max={ate} onChange={(event) => onMudar(event.target.value, ate)} />
        <TextField label="Até" type="date" value={ate} min={de} max={hoje} onChange={(event) => onMudar(de, event.target.value)} />
        <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={carregando} onClick={onAtualizar}>Atualizar</Button>
      </div>
    </div>
  );
}
