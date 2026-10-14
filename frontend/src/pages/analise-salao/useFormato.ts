import { useHideValues } from "../../design-system";
import { mascararReais, reaisCompacto, reaisInteiro } from "./formato";

const OCULTO = "R$ ••••";

// Mesmos formatos de formato.ts, mas respeitando o botão "ocultar valores" do cabeçalho.
export function useFormato() {
  const { hidden } = useHideValues();
  return {
    reais: (n: number) => (hidden ? OCULTO : reaisInteiro(n)),
    reaisCompacto: (n: number) => (hidden ? OCULTO : reaisCompacto(n)),
    // Para frases prontas do servidor que carregam reais no texto.
    mascarar: (texto: string) => (hidden ? mascararReais(texto) : texto)
  };
}
