import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Notice, useNotice } from "../components/Notice";
import { Button } from "../design-system";
import { ExtratoRhArquivo } from "./ExtratoRhArquivo";
import { ExtratosGuardados } from "./ExtratosGuardados";

type Escolhido = { chave: number; arquivo: File };

export function ExtratoRh() {
  const { notice, setNotice } = useNotice();
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const proximaChave = useRef(0);
  // Muda a cada importação: a lista de extratos guardados recarrega sozinha.
  const [importacoes, setImportacoes] = useState(0);
  const erroDaLista = useCallback((message: string) => setNotice({ tone: "error", message }), [setNotice]);
  const avisar = useCallback((tone: "success" | "error", message: string) => setNotice({ tone, message }), [setNotice]);
  const aoImportar = useCallback(() => setImportacoes((n) => n + 1), []);

  function escolher(lista: FileList | null) {
    if (!lista?.length) return;
    setEscolhidos(Array.from(lista).map((arquivo) => ({ chave: ++proximaChave.current, arquivo })));
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <strong>Retorno do RH — Extrato Mensal</strong>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Suba o PDF do Extrato Mensal que o RH devolve — um por empresa; pode escolher os das duas empresas de uma vez. O sistema lê o holerite de cada funcionário, confere com o cadastro e, ao gerar os títulos no Contas a Pagar, guarda o PDF e os detalhes em "Extratos guardados".
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={(e) => escolher(e.target.files)}
          />
          <Button onClick={() => inputRef.current?.click()} leadingIcon={<Upload size={14} />}>
            Selecionar PDF(s) do extrato
          </Button>
        </div>
      </div>

      {escolhidos.map((e) => (
        <ExtratoRhArquivo key={e.chave} arquivo={e.arquivo} onImportado={aoImportar} onNotice={avisar} />
      ))}

      <ExtratosGuardados recarregar={importacoes} onErro={erroDaLista} />
    </div>
  );
}
