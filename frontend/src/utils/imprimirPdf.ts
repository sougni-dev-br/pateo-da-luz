// Abre a caixa de impressão sem janela nova (celular e navegador bloqueiam pop-up):
// o PDF carrega num quadro invisível da própria página. Devolve o endereço do PDF,
// para a tela oferecer "abrir/baixar" caso a impressão não abra (vale por 1 minuto).
export function imprimirBlobPdf(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  const quadro = document.createElement("iframe");
  quadro.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  quadro.src = url;
  quadro.onload = () => {
    try { quadro.contentWindow?.focus(); quadro.contentWindow?.print(); } catch { /* a tela oferece abrir o PDF */ }
    // Tira o quadro depois que a impressão teve tempo de começar.
    window.setTimeout(() => { quadro.remove(); URL.revokeObjectURL(url); }, 60_000);
  };
  document.body.appendChild(quadro);
  return url;
}
