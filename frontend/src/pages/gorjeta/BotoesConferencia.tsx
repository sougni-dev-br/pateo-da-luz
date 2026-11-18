import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import type { TipComputation } from "../../api/client";
import { Button } from "../../design-system";
import { linhasCsvConferencia, montarConferencia } from "./conferencia";
import { baixarCsv } from "./gorjetaUtils";

type Props = {
  // O cálculo mais recente: salva antes a edição pendente, para o papel refletir a tela.
  obterCalculo: () => Promise<TipComputation>;
  onErro: (mensagem: string) => void;
};

const motivoDe = (e: unknown) => {
  const m = e instanceof Error ? e.message : "";
  // Depois de uma publicação, a aba aberta pode apontar para um arquivo que já saiu do ar.
  if (/dynamically imported module|Importing a module script failed/i.test(m)) return "a página está desatualizada; recarregue (Ctrl+F5) e tente de novo";
  return m || "tente novamente";
};

// O papel de conferência da apuração, em PDF (para arquivar) ou planilha (para trabalhar em cima).
export function BotoesConferencia({ obterCalculo, onErro }: Props) {
  const [gerando, setGerando] = useState(false);

  async function pdf() {
    setGerando(true);
    try {
      // O gerador de PDF só é carregado quando alguém pede: não pesa na abertura da tela.
      const { gerarPdfConferencia } = await import("./pdfConferencia");
      await gerarPdfConferencia(await obterCalculo());
    } catch (e) {
      onErro("Erro ao gerar o PDF de conferência: " + motivoDe(e));
    } finally {
      setGerando(false);
    }
  }

  async function planilha() {
    try {
      const c = montarConferencia(await obterCalculo());
      baixarCsv(`Gorjeta_Conferencia_${c.competencia.replace("/", "_")}.csv`, linhasCsvConferencia(c));
    } catch (e) {
      onErro("Erro ao gerar a planilha de conferência: " + motivoDe(e));
    }
  }

  return (
    <span className="botoes-conferencia" role="group" aria-label="Relatório de conferência" aria-busy={gerando}>
      <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} onClick={() => void pdf()} disabled={gerando}>
        {gerando ? "Gerando…" : "Conferência PDF"}
      </Button>
      <Button variant="secondary" size="sm" leadingIcon={<FileSpreadsheet size={14} />} onClick={() => void planilha()} disabled={gerando}>Conferência planilha</Button>
    </span>
  );
}
