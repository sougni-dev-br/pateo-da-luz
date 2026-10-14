import { useEffect, useRef } from "react";

type Props = { texto: string; recalculando: boolean; erro: string | null };

// Confirma o que acabou de acontecer (vínculo salvo ou desfeito) e o que veio depois (margem recalculada, ou a falha da
// releitura). Quando a releitura termina leva o foco para cá: a linha em que a pessoa clicou saiu da lista e o foco
// não pode cair no <body>.
export function AvisoRecarga({ texto, recalculando, erro }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!recalculando) ref.current?.focus({ preventScroll: true });
  }, [texto, recalculando]);

  const complemento = erro ? ` Mas não foi possível atualizar a margem: ${erro}` : recalculando ? " Recalculando a margem…" : " Margem recalculada.";
  return (
    <p className="analise-nota" role="status" tabIndex={-1} ref={ref}>
      {texto}
      {complemento}
    </p>
  );
}
