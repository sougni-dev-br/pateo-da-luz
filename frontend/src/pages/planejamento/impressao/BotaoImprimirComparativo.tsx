import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PlanejamentoComentario, PlanejamentoComparativo } from "../../../api/client";
import { Button } from "../../../design-system";
import { useOculto } from "../useOculto";
import { FolhaDoComparativo } from "./FolhaDoComparativo";

// Mesmo padrão do resumo do fechamento: a folha só existe no DOM enquanto imprime (num portal fora da tela) e uma
// classe no <body> esconde o resto do sistema. Com "ocultar valores" ligado a impressão fica bloqueada.

const CLASSE_IMPRIMINDO = "imprimindo-comparativo";

type Props = { dados: PlanejamentoComparativo; comentarios: readonly PlanejamentoComentario[]; usuario: string };

export function BotaoImprimirComparativo({ dados, comentarios, usuario }: Props) {
  const oculto = useOculto();
  const [imprimindo, setImprimindo] = useState(false);

  useEffect(() => {
    if (!imprimindo) return undefined;
    const tituloAntes = document.title;
    document.title = `Comparativo ${dados.anoComparado} x ${dados.anoBase} - Pateo da Luz`;
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const limpar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      document.title = tituloAntes;
      window.removeEventListener("afterprint", limpar);
      setImprimindo(false);
    };
    window.addEventListener("afterprint", limpar);
    window.print();
    return () => { window.removeEventListener("afterprint", limpar); };
  }, [imprimindo, dados.anoBase, dados.anoComparado]);

  useEffect(() => () => { document.body.classList.remove(CLASSE_IMPRIMINDO); }, []);

  return (
    <>
      <Button variant="secondary" onClick={() => setImprimindo(true)} disabled={oculto || imprimindo} title={oculto ? "Mostre os valores para imprimir" : "Imprimir ou salvar em PDF"}>
        <Printer size={16} aria-hidden /> Imprimir
      </Button>
      {imprimindo && createPortal(
        <div className="fcmp-area" aria-hidden="true"><FolhaDoComparativo dados={dados} comentarios={comentarios} geradoPor={usuario} geradoEm={new Date()} /></div>,
        document.body
      )}
    </>
  );
}
