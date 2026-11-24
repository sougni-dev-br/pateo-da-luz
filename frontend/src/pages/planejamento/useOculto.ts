import { useContext } from "react";
import { SessionContext } from "../../context/SessionContext";

// "Ocultar valores" do sistema, lido da mesma sessão que alimenta o HideValuesProvider. Fora da sessão (ex.: testes de
// um editor isolado) os valores aparecem, em vez de a tela quebrar.

export function useOculto(): boolean {
  return useContext(SessionContext)?.hideSensitiveValues ?? false;
}
