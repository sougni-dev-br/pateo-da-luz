import { useEffect, useState } from "react";

// Celular (até 640px): algumas partes do Planejamento mudam de forma, não só de tamanho (ex.: um regime por vez no
// resultado, tabela recolhida no comparativo). Sem matchMedia (testes), vale o layout do computador.

const LARGURA_DO_CELULAR = 640;

function consultar(consulta: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(consulta).matches;
}

/** A tela tem no máximo `px` de largura? Sem matchMedia (testes), responde "não" (layout do computador). */
export function useAteLargura(px: number): boolean {
  const consulta = `(max-width: ${px}px)`;
  const [dentro, setDentro] = useState(() => consultar(consulta));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(consulta);
    const mudar = () => setDentro(mq.matches);
    mudar();
    mq.addEventListener("change", mudar);
    return () => mq.removeEventListener("change", mudar);
  }, [consulta]);
  return dentro;
}

export function useEstreito(): boolean {
  return useAteLargura(LARGURA_DO_CELULAR);
}
