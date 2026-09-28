import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { TipComputation, TipComputedParticipant, TipRegrasPessoa } from "../../api/client";
import { mutedStyle, pts } from "./gorjetaUtils";

type Chave = keyof TipRegrasPessoa;

const ITENS: Array<{ chave: Chave; rotulo: string; periodo: (c: TipComputation) => boolean }> = [
  { chave: "descontaFalta", rotulo: "Descontar faltas", periodo: (c) => c.descontaFalta },
  { chave: "descontaAtestado", rotulo: "Descontar atestados", periodo: (c) => c.descontaAtestado },
  { chave: "descontaFerias", rotulo: "Descontar férias", periodo: (c) => c.descontaFerias },
  { chave: "descontaOutros", rotulo: "Descontar outros dias", periodo: (c) => c.descontaOutros },
  { chave: "proporcionalEntrada", rotulo: "Admitido no período: proporcional", periodo: (c) => c.proporcionalEntrada },
];

export function temRegraPropria(r: TipRegrasPessoa): boolean {
  return ITENS.some((i) => r[i.chave] != null);
}

type Props = {
  comp: TipComputation;
  p: TipComputedParticipant;
  regras: TipRegrasPessoa;
  disabled: boolean;
  onChange: (regras: TipRegrasPessoa) => void;
  onFechar: () => void;
};

// Prerrogativa de quem fecha: para esta pessoa, cada ocorrência desconta ou não.
// "Padrão" segue a regra do período; Sim/Não vale só para ela.
export function RegrasPessoa({ comp, p, regras, disabled, onChange, onFechar }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  // A tela redesenha a cada edição (autosave): o fechar fica numa ref para o efeito rodar só ao abrir.
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    caixa.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) fechar.current(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar.current(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const valor = (v: boolean | null) => (v == null ? "" : v ? "sim" : "nao");

  return (
    <div ref={caixa} className="regras-pessoa" role="dialog" aria-label={`Regras de presença de ${p.employeeName}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Regras de {p.employeeName}</strong>
        <button type="button" onClick={onFechar} aria-label="Fechar" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><X size={14} /></button>
      </div>
      {ITENS.map((i) => (
        <label key={i.chave} className="regras-pessoa-linha">
          <span>{i.rotulo}</span>
          <select value={valor(regras[i.chave])} disabled={disabled}
            onChange={(e) => onChange({ ...regras, [i.chave]: e.target.value === "" ? null : e.target.value === "sim" })}>
            <option value="">Padrão ({i.periodo(comp) ? "sim" : "não"})</option>
            <option value="sim">Sim</option>
            <option value="nao">Não</option>
          </select>
        </label>
      ))}
      <div style={{ ...mutedStyle, fontSize: 11, whiteSpace: "normal" }}>
        {p.diasComputados} dias de {p.diasReferencia} → {pts(p.pontosApurados)} pts de {pts(p.basePoints)}.
        {temRegraPropria(regras) && (
          <> <button type="button" className="barra-lista-link" disabled={disabled}
            onClick={() => onChange({ descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null })}>
            voltar ao padrão
          </button></>
        )}
      </div>
    </div>
  );
}
