import { FileText, Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type DocumentoVisivel = {
  nome: string;
  /** Blob URL — criado e revogado por quem monta a lista. */
  url: string;
  ehPdf: boolean;
};

type Props = {
  documentos: DocumentoVisivel[];
};

/**
 * O documento à vista enquanto se confere.
 *
 * É a peça central da conferência, não um enfeite: conferir um valor lido sem o
 * documento na frente é decorar número e torcer. Com nota + boletos, cada
 * arquivo vira uma aba — é comum o valor estar na nota e o vencimento no boleto.
 */
export function VisualizadorDocumento({ documentos }: Props) {
  const [ativo, setAtivo] = useState(0);
  const [telaCheia, setTelaCheia] = useState(false);

  useEffect(() => {
    if (ativo >= documentos.length) setAtivo(0);
  }, [documentos.length, ativo]);

  // Esc fecha a tela cheia — o gesto que todo mundo tenta primeiro.
  useEffect(() => {
    if (!telaCheia) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setTelaCheia(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [telaCheia]);

  if (documentos.length === 0) {
    return (
      <div className="doc-visualizador" style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px dashed var(--border)", borderRadius: 10, color: "var(--muted)", fontSize: 12, textAlign: "center", padding: 12,
      }}>
        O arquivo não está mais disponível para exibição.<br />Envie novamente para vê-lo aqui.
      </div>
    );
  }

  const atual = documentos[Math.min(ativo, documentos.length - 1)];

  const conteudo = (emTelaCheia: boolean) => (
    <div style={{
      flex: 1, minHeight: 0, background: "var(--surface-2, #f4f4f5)",
      borderRadius: emTelaCheia ? 0 : 8, overflow: "hidden", display: "flex",
    }}>
      {atual.ehPdf ? (
        <iframe
          src={`${atual.url}#toolbar=0&navpanes=0&view=FitH`}
          title={atual.nome}
          style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
        />
      ) : (
        <img
          src={atual.url}
          alt={atual.nome}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#111" }}
        />
      )}
    </div>
  );

  return (
    <>
      <div className="doc-visualizador" style={{ display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {documentos.length > 1 ? (
            documentos.map((documento, indice) => (
              <button
                key={documento.nome}
                type="button"
                onClick={() => setAtivo(indice)}
                aria-pressed={indice === ativo}
                title={documento.nome}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "3px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  maxWidth: 170,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  background: indice === ativo ? "var(--text, #111)" : "transparent",
                  color: indice === ativo ? "var(--surface, #fff)" : "var(--muted)",
                }}
              >
                {documento.nome}
              </button>
            ))
          ) : (
            <span style={{ fontSize: 11, color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <FileText size={12} /> {atual.nome}
            </span>
          )}

          <button
            type="button"
            onClick={() => setTelaCheia(true)}
            title="Ampliar documento"
            aria-label="Ampliar documento"
            style={{ marginLeft: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", padding: "3px 7px", cursor: "pointer", color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}
          >
            <Maximize2 size={12} /> ampliar
          </button>
        </div>

        {conteudo(false)}
      </div>

      {telaCheia && createPortal(
        <div
          role="dialog"
          aria-label={`Documento ampliado: ${atual.nome}`}
          style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,.9)", display: "flex", flexDirection: "column", padding: 12, gap: 8 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fff", flexWrap: "wrap" }}>
            <FileText size={14} />
            <strong style={{ fontSize: 13 }}>{atual.nome}</strong>
            {documentos.length > 1 && (
              <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
                {documentos.map((documento, indice) => (
                  <button
                    key={documento.nome}
                    type="button"
                    onClick={() => setAtivo(indice)}
                    style={{
                      border: "1px solid rgba(255,255,255,.35)", borderRadius: 999, padding: "2px 9px", fontSize: 11, cursor: "pointer",
                      background: indice === ativo ? "#fff" : "transparent", color: indice === ativo ? "#111" : "rgba(255,255,255,.8)",
                    }}
                  >
                    {indice + 1}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setTelaCheia(false)}
              aria-label="Fechar documento ampliado"
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#fff", cursor: "pointer" }}
            >
              <X size={20} />
            </button>
          </div>
          {conteudo(true)}
        </div>,
        document.body,
      )}
    </>
  );
}
