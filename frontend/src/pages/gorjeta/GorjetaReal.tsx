// Gorjeta real no lugar da calculada, para quem está no mês. Os outros não mudam: a
// diferença entra (ou sai) do "livre para distribuir". Justificativa obrigatória.
import { useEffect, useRef, useState } from "react";
import type { TipComputedParticipant } from "../../api/client";
import { Alert, Button, FormField, Money, Textarea, TextField } from "../../design-system";
import { maskMoney, moneyToMasked } from "../../utils/format";
import "./gorjeta.css";

const MINIMO = 10;
const numero = (s: string) => {
  const t = s.trim();
  return t === "" ? null : Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
};

type Props = {
  participante: TipComputedParticipant;
  onSalvar: (valor: number | null, motivo: string) => Promise<void>;
  onFechar: () => void;
};

export function DialogoGorjetaReal({ participante: p, onSalvar, onFechar }: Props) {
  const [valor, setValor] = useState(p.gorjetaReal ? moneyToMasked(p.gorjetaReal.valor) : moneyToMasked(p.gorjetaCalculada));
  const [motivo, setMotivo] = useState(p.gorjetaReal?.motivo ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [motivoErro, setMotivoErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const campoRef = useRef<HTMLDivElement>(null);

  useEffect(() => { campoRef.current?.querySelector("input")?.select(); }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [busy, onFechar]);

  const real = numero(valor);
  const diferenca = real == null || !Number.isFinite(real) ? null : Math.round((p.gorjetaCalculada - real) * 100) / 100;

  async function salvar(tirar: boolean) {
    setErro(null);
    if (!tirar && (real == null || !Number.isFinite(real) || real < 0)) return setErro("Digite a gorjeta real (R$).");
    const faltam = MINIMO - motivo.trim().length;
    if (faltam > 0) return setMotivoErro(`Explique em pelo menos ${MINIMO} letras (faltam ${faltam}).`);
    setBusy(true);
    try {
      await onSalvar(tirar ? null : real, motivo.trim());
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop sobre-topo" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onFechar(); }}>
      <section className="panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="gorjeta-real-titulo" style={{ width: "min(460px, 100%)" }}>
        <div className="section-heading">
          <div>
            <p className="ds-panel-eyebrow">Gorjeta real</p>
            <h2 id="gorjeta-real-titulo">{p.employeeName}</h2>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          Calculada pelo sistema: <strong><Money value={p.gorjetaCalculada} /></strong> ({p.points.toLocaleString("pt-BR")} pts).
          A real substitui a calculada; os outros não mudam e a diferença vai para o livre para distribuir.
        </p>
        {erro && <div style={{ marginBottom: 10 }}><Alert tone="error">{erro}</Alert></div>}
        <div ref={campoRef}>
          <FormField label="Gorjeta real (R$)" required>
            <TextField value={valor} onChange={(e) => setValor(maskMoney(e.target.value))} inputMode="numeric" placeholder="0,00" aria-label="Gorjeta real" />
          </FormField>
        </div>
        {diferenca != null && diferenca !== 0 && (
          <p style={{ fontSize: 13, margin: "6px 0 10px", color: diferenca > 0 ? "var(--success)" : "var(--warning, #b45309)" }}>
            {diferenca > 0 ? "Sobram " : "Faltam "}<strong><Money value={Math.abs(diferenca)} /></strong>{" "}
            {diferenca > 0 ? "no livre para distribuir." : "no livre para distribuir (sai do saldo)."}
          </p>
        )}
        <FormField label="Motivo (obrigatório)" error={motivoErro ?? undefined} hint="fica gravado com a data e quem mudou">
          <Textarea rows={2} value={motivo} onChange={(e) => { setMotivo(e.target.value); setMotivoErro(null); }}
            placeholder="Ex.: gorjeta acertada à parte com a gerência" />
        </FormField>
        {p.gorjetaReal && (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Ajuste atual: <Money value={p.gorjetaReal.valor} />{p.gorjetaReal.por ? ` · ${p.gorjetaReal.por}` : ""}
            {p.gorjetaReal.em ? ` · ${new Date(p.gorjetaReal.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
          </p>
        )}
        <div className="form-actions">
          {p.gorjetaReal && <Button variant="secondary" onClick={() => void salvar(true)} disabled={busy}>Voltar à calculada</Button>}
          <Button variant="secondary" onClick={onFechar} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void salvar(false)} disabled={busy}>{busy ? "Gravando…" : "Gravar gorjeta real"}</Button>
        </div>
      </section>
    </div>
  );
}
