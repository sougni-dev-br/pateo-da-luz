import { useEffect, useState } from "react";
import { TextField } from "../../../design-system";

type Props = { rotulo: string; mm: number; minMm: number; maxMm: number; onMudar: (mm: number) => void };

// Medida em cm digitada à mão: guarda o texto enquanto a pessoa digita ("9," ainda não é número)
// e só repassa quando vira uma medida válida. Aceita vírgula ou ponto.
export function CampoCm({ rotulo, mm, minMm, maxMm, onMudar }: Props) {
  const formatar = (v: number) => (v / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const [texto, setTexto] = useState(() => formatar(mm));
  useEffect(() => { setTexto((t) => (Math.round(Number(t.replace(",", ".")) * 10) === mm ? t : formatar(mm))); }, [mm]);

  const valor = Math.round(Number(texto.replace(",", ".")) * 10);
  const valido = Number.isFinite(valor) && valor >= minMm && valor <= maxMm;
  return (
    <TextField label={rotulo} inputMode="decimal" value={texto}
      error={texto && !valido ? `Entre ${formatar(minMm)} e ${formatar(maxMm)} cm` : undefined}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d,.]/g, "");
        setTexto(t);
        const v = Math.round(Number(t.replace(",", ".")) * 10);
        if (Number.isFinite(v) && v >= minMm && v <= maxMm) onMudar(v);
      }}
      onBlur={() => setTexto(formatar(mm))} />
  );
}
