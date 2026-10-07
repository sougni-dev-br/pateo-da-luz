// Impressão dos recibos de pagamento (lista de pagamento e Folha): busca no servidor, gera o PDF,
// abre a impressão e deixa o aviso com "Abrir o PDF" caso a caixa de impressão não abra.
import { Printer } from "lucide-react";
import { useState } from "react";
import { type ReciboDePagamento, imprimirRecibosPagamento } from "./reciboPagamento";
import "./gorjeta.css";

type Impresso = { url: string; rotulo: string };

export function useImprimirRecibos(onError: (mensagem: string) => void) {
  const [imprimindo, setImprimindo] = useState<string | null>(null);
  const [impresso, setImpresso] = useState<Impresso | null>(null);

  async function imprimir(chave: string, rotulo: string, buscar: () => Promise<ReciboDePagamento[]>) {
    setImprimindo(chave);
    setImpresso(null);
    try {
      const recibos = await buscar();
      const url = await imprimirRecibosPagamento(recibos);
      setImpresso({ url, rotulo });
    } catch (e) {
      onError("Erro ao gerar o recibo: " + (e as Error).message);
    } finally {
      setImprimindo(null);
    }
  }
  return { imprimindo, impresso, fechar: () => setImpresso(null), imprimir };
}

export function AvisoReciboImpresso({ impresso, onFechar }: { impresso: Impresso | null; onFechar: () => void }) {
  if (!impresso) return null;
  return (
    <div className="aviso-recibo" role="status">
      <Printer size={14} aria-hidden="true" /> {impresso.rotulo} enviado para impressão.
      <a href={impresso.url} target="_blank" rel="noopener noreferrer" download={`${impresso.rotulo.replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`}>Abrir o PDF</a>
      <button type="button" className="barra-lista-link" onClick={onFechar}>fechar</button>
    </div>
  );
}
