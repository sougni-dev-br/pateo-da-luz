import { useEffect } from "react";

// Aviso curto depois de uma troca em massa ("12 meses trocados para 7%"), com Desfazer por alguns segundos. Fica no
// fluxo da página (na pilha da barra de salvar), nunca por cima dela: a falha de salvar é mais importante que ele.

const TEMPO_DO_DESFAZER_MS = 10_000;

type Props = { texto: string; onDesfazer: () => void; onFechar: () => void };

export function AvisoComDesfazer({ texto, onDesfazer, onFechar }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onFechar, TEMPO_DO_DESFAZER_MS);
    return () => window.clearTimeout(id);
  }, [texto, onFechar]);
  return (
    <div className="plan-toast" role="status">
      <span>{texto}</span>
      <button type="button" className="plan-toast-acao" onClick={onDesfazer}>Desfazer</button>
      <button type="button" className="plan-toast-fechar" aria-label="Fechar aviso" onClick={onFechar}>×</button>
    </div>
  );
}
