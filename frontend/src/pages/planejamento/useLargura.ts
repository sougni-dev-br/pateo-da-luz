import { useEffect, useRef, useState } from "react";

// Largura real do elemento, para os gráficos desenharem em pixels de verdade (texto de 11px continua com 11px no
// celular, em vez de encolher junto com um viewBox). Sem ResizeObserver (ex.: testes), usa a largura padrão.

const LARGURA_PADRAO = 960;

export function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(LARGURA_PADRAO);

  useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return undefined;
    const medir = () => {
      const w = Math.round(elemento.getBoundingClientRect().width);
      if (w > 0) setLargura(w);
    };
    medir();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  return { ref, largura };
}
