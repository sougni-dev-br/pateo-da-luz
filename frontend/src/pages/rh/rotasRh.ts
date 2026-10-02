// Rotas do grupo RH e o redirecionamento das antigas /pessoal/... — links e favoritos
// guardados antes da reorganização (01/10/2026) não podem quebrar.

export const ROTAS_RH = {
  funcionarios: "/rh/funcionarios",
  escala: "/rh/escala",
  gorjeta: "/rh/gorjeta",
  rescisoes: "/rh/rescisoes",
  folha: "/rh/folha",
  retorno: "/rh/retorno",
  extras: "/rh/extras",
  fichas: "/rh/fichas-cadastrais",
} as const;

const ANTIGAS: Record<string, string> = {
  "/pessoal": ROTAS_RH.funcionarios,
  "/pessoal/funcionarios": ROTAS_RH.funcionarios,
  "/pessoal/escala": ROTAS_RH.escala,
  "/pessoal/folha": ROTAS_RH.folha,
  "/pessoal/gorjeta": ROTAS_RH.gorjeta,
  "/pessoal/extras": ROTAS_RH.extras,
};

/** Caminhos antigos, para a seção do menu continuar reconhecendo o endereço até o redirecionamento. */
export const ROTAS_ANTIGAS_RH = Object.keys(ANTIGAS);

/** Abre a tela de Rescisões já com o funcionário escolhido. */
export function linkRescisao(employeeId: string): string {
  return `${ROTAS_RH.rescisoes}?funcionario=${encodeURIComponent(employeeId)}`;
}

/**
 * Endereço novo de um endereço antigo de /pessoal (com a busca preservada), ou null se
 * não for antigo. O atalho da gorjeta /pessoal/funcionarios?rescisao=<id> vai direto
 * para a rescisão da pessoa.
 */
export function rotaNovaDe(pathname: string, search = ""): string | null {
  const caminho = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const destino = ANTIGAS[caminho];
  if (!destino) return null;
  const busca = new URLSearchParams(search);
  const rescisao = busca.get("rescisao");
  if (destino === ROTAS_RH.funcionarios && rescisao) return linkRescisao(rescisao);
  const resto = busca.toString();
  return resto ? `${destino}?${resto}` : destino;
}
