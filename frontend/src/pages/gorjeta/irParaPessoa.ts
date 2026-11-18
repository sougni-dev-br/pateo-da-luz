// Leva até a linha da pessoa na tabela da Apuração e a destaca por um instante.
export const idLinhaDaPessoa = (employeeId: string) => `gorjeta-pessoa-${employeeId}`;

const CLASSE_DESTAQUE = "linha-destacada";
const DURACAO_DESTAQUE_MS = 2500;
const TENTATIVAS = 12;
const INTERVALO_MS = 50;

export function irParaLinhaDaPessoa(employeeId: string): boolean {
  const linha = document.getElementById(idLinhaDaPessoa(employeeId));
  if (!linha) return false;
  const reduzido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  linha.scrollIntoView({ behavior: reduzido ? "auto" : "smooth", block: "center" });
  linha.tabIndex = -1;
  linha.focus({ preventScroll: true });
  linha.classList.add(CLASSE_DESTAQUE);
  window.setTimeout(() => linha.classList.remove(CLASSE_DESTAQUE), DURACAO_DESTAQUE_MS);
  return true;
}

// A aba pode demorar a desenhar a tabela: tenta por cerca de 600 ms antes de desistir.
export function irParaLinhaQuandoPronta(employeeId: string, aoFalhar: () => void, tentativa = 0): void {
  if (irParaLinhaDaPessoa(employeeId)) return;
  if (tentativa >= TENTATIVAS) { aoFalhar(); return; }
  window.setTimeout(() => irParaLinhaQuandoPronta(employeeId, aoFalhar, tentativa + 1), INTERVALO_MS);
}
