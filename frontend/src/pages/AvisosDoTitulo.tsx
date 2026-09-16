import { AlertTriangle, ChevronDown, ChevronRight, OctagonAlert } from "lucide-react";
import { useState } from "react";
import type { DocIntakeAviso } from "../api/client";

type Props = {
  avisos: DocIntakeAviso[];
  duplicatas: Array<{ invoiceNumber: string | null; totalAmount: string }>;
};

/**
 * Avisos do título, com peso proporcional ao que significam.
 *
 * Bloqueio impede o lançamento: fica sempre aberto e em vermelho.
 * Atenção é recado: uma linha discreta que expande. A versão anterior empilhava
 * três alertas grandes no topo e empurrava o formulário para fora da tela — o
 * efeito prático era a pessoa rolar direto por cima, sem ler nenhum.
 */
export function AvisosDoTitulo({ avisos, duplicatas }: Props) {
  const [aberto, setAberto] = useState(false);

  const bloqueios = avisos.filter((aviso) => aviso.nivel === "BLOQUEIO");
  const atencoes = avisos.filter((aviso) => aviso.nivel === "ATENCAO");
  const totalAtencoes = atencoes.length + (duplicatas.length > 0 ? 1 : 0);

  if (bloqueios.length === 0 && totalAtencoes === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {bloqueios.map((aviso) => (
        <div
          key={aviso.codigo}
          role="alert"
          style={{
            display: "flex", gap: 8, alignItems: "flex-start",
            background: "var(--danger-soft, #fdeceb)", border: "1px solid var(--danger, #c0392b)",
            borderRadius: 8, padding: "8px 10px", fontSize: 13,
          }}
        >
          <OctagonAlert size={15} color="var(--danger, #c0392b)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{aviso.mensagem}</span>
        </div>
      ))}

      {totalAtencoes > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setAberto((atual) => !atual)}
            aria-expanded={aberto}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "7px 10px",
              border: "none", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--muted)", textAlign: "left",
            }}
          >
            {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <AlertTriangle size={13} color="var(--warning, #b7791f)" />
            {totalAtencoes === 1 ? "1 ponto de atenção" : `${totalAtencoes} pontos de atenção`}
            <span style={{ opacity: 0.7 }}>— não impedem o lançamento</span>
          </button>

          {aberto && (
            <div style={{ padding: "0 10px 9px 30px", display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              {atencoes.map((aviso) => <span key={aviso.codigo}>{aviso.mensagem}</span>)}
              {duplicatas.length > 0 && (
                <span>
                  Títulos parecidos já lançados:{" "}
                  {duplicatas.map((duplicata) => `${duplicata.invoiceNumber ?? "sem nº"} (R$ ${duplicata.totalAmount})`).join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
