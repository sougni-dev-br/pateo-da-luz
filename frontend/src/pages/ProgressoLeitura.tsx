import { Check, FileText, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

export type SituacaoArquivo = "aguardando" | "lendo" | "lido" | "falhou";

export type ArquivoEmLeitura = {
  nome: string;
  situacao: SituacaoArquivo;
  erro?: string;
};

type Props = {
  arquivos: ArquivoEmLeitura[];
  etapa: string | null;
  /** Quando a leitura começou, para contar o tempo decorrido. */
  inicioEm: number;
};

/** Depois disso, avisa que está demorando mais que o normal. */
const SEGUNDOS_ESPERADOS_POR_ARQUIVO = 45;

function icone(situacao: SituacaoArquivo) {
  if (situacao === "lido") return <Check size={14} color="var(--success, green)" />;
  if (situacao === "falhou") return <X size={14} color="var(--danger, #c00)" />;
  if (situacao === "lendo") return <Loader2 size={14} color="var(--muted)" />;
  return <FileText size={14} color="var(--muted)" opacity={0.5} />;
}

/**
 * O que está acontecendo durante a leitura.
 *
 * Existe porque a leitura leva de 20 a 40 segundos por documento — mais quando é
 * foto. Uma tela muda nesse tempo parece travada, e quem acha que travou clica
 * de novo. Aqui cada arquivo mostra seu estado, e o relógio anda.
 */
export function ProgressoLeitura({ arquivos, etapa, inicioEm }: Props) {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const segundos = Math.max(0, Math.round((agora - inicioEm) / 1000));
  const concluidos = arquivos.filter((arquivo) => arquivo.situacao === "lido" || arquivo.situacao === "falhou").length;
  const demorando = segundos > arquivos.length * SEGUNDOS_ESPERADOS_POR_ARQUIVO;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>
          Lendo {arquivos.length === 1 ? "o documento" : `os documentos (${concluidos} de ${arquivos.length})`}
        </strong>
        <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{segundos}s</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {arquivos.map((arquivo) => (
          <div key={arquivo.nome} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, minWidth: 0 }}>
            {icone(arquivo.situacao)}
            <span style={{
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: arquivo.situacao === "aguardando" ? "var(--muted)" : "inherit",
              fontWeight: arquivo.situacao === "lendo" ? 600 : 400,
            }}>
              {arquivo.nome}
            </span>
            {arquivo.situacao === "falhou" && arquivo.erro && (
              <span style={{ color: "var(--danger, #c00)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                — {arquivo.erro}
              </span>
            )}
          </div>
        ))}
      </div>

      {etapa && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
          <Loader2 size={13} /> {etapa}
        </div>
      )}

      <span style={{ fontSize: 11, color: "var(--muted)" }}>
        {demorando
          ? "Está demorando mais que o normal. Pode ser fila no serviço de leitura — costuma se resolver sozinho."
          : "Cada documento leva de 20 a 40 segundos. Foto costuma demorar um pouco mais."}
      </span>
    </div>
  );
}
