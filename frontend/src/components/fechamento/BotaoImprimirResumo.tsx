// Botão "Imprimir resumo" do fechamento. A folha fica num portal fora da tela e só
// aparece na impressão: uma classe no <body> esconde o resto do sistema enquanto
// o diálogo de impressão do navegador está aberto (mesmo padrão de Férias).
// O navegador usa o título da página como nome do arquivo ao salvar em PDF.

import { Printer } from "lucide-react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { MonthlyClosureState, MonthlyCmv } from "../../api/client";
import { Button } from "../../design-system";
import { montarResumoDoFechamento } from "../../lib/fechamento-resumo";
import { FolhaDoResumo } from "./FolhaDoResumo";
import "./folhaDoResumo.css";

const CLASSE_IMPRIMINDO = "imprimindo-fechamento";

type Props = {
  state: MonthlyClosureState;
  cmv: MonthlyCmv | null;
  usuario: string;
  disabled?: boolean;
};

export function BotaoImprimirResumo({ state, cmv, usuario, disabled }: Props) {
  // A folha acompanha o estado da tela: pendência justificada agora já sai impressa.
  const resumo = useMemo(
    () => montarResumoDoFechamento({ state, cmv, geradoEm: new Date(), geradoPor: usuario }),
    [state, cmv, usuario]
  );

  useEffect(() => () => { document.body.classList.remove(CLASSE_IMPRIMINDO); }, []);

  function imprimir() {
    const tituloAntes = document.title;
    const mes = String(state.competenceMonth).padStart(2, "0");
    document.title = `Fechamento ${state.competenceYear}-${mes} - Pateo da Luz`;
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      document.title = tituloAntes;
      window.removeEventListener("afterprint", limpar);
    };
    window.addEventListener("afterprint", limpar);
    window.print();
  }

  return (
    <>
      <Button variant="secondary" onClick={imprimir} disabled={disabled} title="Imprimir ou salvar em PDF">
        <Printer size={15} /> Imprimir resumo
      </Button>
      {createPortal(
        <div className="fres-area" aria-hidden="true"><FolhaDoResumo resumo={resumo} /></div>,
        document.body
      )}
    </>
  );
}
