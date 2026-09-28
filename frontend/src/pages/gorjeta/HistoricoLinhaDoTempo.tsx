import type { TipMudanca, TipMudancaTipo } from "../../api/client";
import { StatusBadge } from "../../design-system";
import { mutedStyle, pts } from "./gorjetaUtils";

export const TIPO_MUDANCA: Record<TipMudancaTipo, { rotulo: string; tom: "success" | "danger" | "info" | "warning" | "neutral" }> = {
  INICIAL: { rotulo: "Situação inicial", tom: "neutral" },
  PROMOCAO: { rotulo: "Promoção", tom: "success" },
  REDUCAO: { rotulo: "Redução", tom: "danger" },
  TROCA_DE_FUNCAO: { rotulo: "Troca de função", tom: "info" },
  ENTRADA: { rotulo: "Entrou na gorjeta", tom: "info" },
  SAIDA: { rotulo: "Saiu da gorjeta", tom: "warning" },
  OUTRA: { rotulo: "Alteração", tom: "neutral" },
};

export function fmtDia(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

// Uma pessoa: do mais recente para o mais antigo, com função e pontos antes → depois.
export function HistoricoLinhaDoTempo({ mudancas }: { mudancas: TipMudanca[] }) {
  if (mudancas.length === 0) return <span style={mutedStyle}>Sem registros no histórico.</span>;
  return (
    <ol className="linha-tempo">
      {mudancas.map((m) => {
        const tipo = TIPO_MUDANCA[m.tipo];
        return (
          <li key={m.id} data-tipo={m.tipo}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{fmtDia(m.validFrom)}</strong>
              <StatusBadge tone={tipo.tom}>{tipo.rotulo}</StatusBadge>
              {m.diferenca != null && m.diferenca !== 0 && (
                <span style={{ fontWeight: 700, color: m.diferenca > 0 ? "var(--success)" : "var(--danger)" }}>
                  {m.diferenca > 0 ? "+" : "−"}{pts(Math.abs(m.diferenca))} pts
                </span>
              )}
            </div>
            <div>
              {m.funcaoAntes && m.funcaoAntes !== m.funcaoDepois ? <>{m.funcaoAntes} → </> : null}
              <strong>{m.funcaoDepois ?? "sem função"}</strong>
              {" · "}
              {m.baseAntes != null && m.baseAntes !== m.baseDepois ? <>{pts(m.baseAntes)} → </> : null}
              <strong>{pts(m.baseDepois)} pts</strong>
              {!m.participa && <span style={mutedStyle}> · fora da gorjeta</span>}
            </div>
            {m.motivo && <div style={mutedStyle}>{m.motivo}</div>}
          </li>
        );
      })}
    </ol>
  );
}
