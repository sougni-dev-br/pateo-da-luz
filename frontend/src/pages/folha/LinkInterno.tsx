import type { ReactNode } from "react";
import { Link, useInRouterContext } from "react-router-dom";

/** Link para outra tela do app. Fora de um roteador (testes isolados) cai num <a> comum. */
export function LinkInterno({ para, className, children }: { para: string; className?: string; children: ReactNode }) {
  const dentro = useInRouterContext();
  return dentro ? <Link to={para} className={className}>{children}</Link> : <a href={para} className={className}>{children}</a>;
}

/** Contas a Pagar já filtrado: só os títulos em aberto que vencem no intervalo (formato que a tela lê em `filtroDaUrl`). */
export function linkContasAPagar(de: string, ate: string = de): string {
  return `/financeiro/contas-a-pagar?de=${de}&ate=${ate}&aba=abertos`;
}
