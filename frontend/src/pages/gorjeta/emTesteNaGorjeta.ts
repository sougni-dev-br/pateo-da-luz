// Selo "em teste (fora da gorjeta)" na Equipe: participa no cadastro, mas a entrada na
// gorjeta está vazia ou é futura. O cálculo usa o fim do ciclo; a Equipe, o dia de hoje.
export function emTesteNaGorjeta(m: { participaGorjeta: boolean; inicioGorjeta?: string | null }, hojeIso: string): boolean {
  if (!m.participaGorjeta) return false;
  if (!m.inicioGorjeta) return true;
  return m.inicioGorjeta.slice(0, 10) > hojeIso;
}
