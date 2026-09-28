import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { useState } from "react";

type Props = { pendencias: string[]; avisos: string[]; fechado: boolean; compacto?: boolean };

// Um só painel no lugar de uma pilha de alertas: o que impede o fechamento fica
// sempre aberto; o que é só para conferir fica recolhido, com a contagem à vista.
export function Pendencias({ pendencias, avisos, fechado, compacto = false }: Props) {
  const [verAvisos, setVerAvisos] = useState(false);
  const [verPendencias, setVerPendencias] = useState(false);
  if (fechado) return null;

  const pronto = pendencias.length === 0;
  return (
    <section
      aria-label="Situação do fechamento"
      style={{
        border: `1px solid ${pronto ? "var(--tint-success-border, var(--border))" : "var(--tint-danger-border, var(--border))"}`,
        background: pronto ? "var(--tint-success, #f1f8f4)" : "var(--tint-danger, #fbf1f1)",
        borderRadius: 12, padding: compacto ? "6px 12px" : "12px 14px", display: "flex", flexDirection: "column", gap: compacto ? 4 : 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {pronto
          ? <CheckCircle2 size={18} color="var(--success)" aria-hidden />
          : <CircleAlert size={18} color="var(--danger)" aria-hidden />}
        <strong style={{ color: pronto ? "var(--success)" : "var(--danger)" }}>
          {pronto ? "Pronto para fechar" : `${pendencias.length} ${pendencias.length === 1 ? "pendência impede" : "pendências impedem"} o fechamento`}
        </strong>
        {compacto && !pronto && (
          <button type="button" onClick={() => setVerPendencias((v) => !v)} aria-expanded={verPendencias}
            style={{ border: 0, background: "transparent", color: "var(--danger)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit", fontSize: 13 }}>
            {verPendencias ? "ocultar" : "ver quais"}
          </button>
        )}
        {avisos.length > 0 && (
          <button type="button" onClick={() => setVerAvisos((v) => !v)} aria-expanded={verAvisos}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 999, background: "var(--surface, #fff)", color: "var(--warning)", padding: "3px 10px", cursor: "pointer", fontSize: 13 }}>
            <AlertTriangle size={14} aria-hidden /> {avisos.length} para conferir {verAvisos ? "▴" : "▾"}
          </button>
        )}
      </div>
      {pendencias.length > 0 && (!compacto || verPendencias) && (
        <ul style={{ margin: 0, paddingLeft: 26, display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
          {pendencias.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {verAvisos && (
        <ul style={{ margin: 0, paddingLeft: 26, display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--warning)" }}>
          {avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
    </section>
  );
}
