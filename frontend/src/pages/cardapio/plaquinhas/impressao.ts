const ESPERA_MAXIMA_MS = 1500;

// Espera os logos da cópia de impressão estarem prontos antes de abrir a impressora.
// Só espera imagem que ainda não carregou, e nunca mais que 1,5 s: com o navegador atrás de
// outra janela, o decode() fica parado mesmo com a imagem pronta e a impressão não abriria.
export async function esperarImagens(seletor: string): Promise<void> {
  const pendentes = [...document.querySelectorAll<HTMLImageElement>(seletor)].filter((img) => !img.complete);
  if (!pendentes.length) return;
  const carregou = (img: HTMLImageElement) => new Promise<void>((ok) => {
    img.addEventListener("load", () => ok(), { once: true });
    img.addEventListener("error", () => ok(), { once: true });
  });
  await Promise.race([
    Promise.all(pendentes.map(carregou)),
    new Promise<void>((ok) => window.setTimeout(ok, ESPERA_MAXIMA_MS)),
  ]);
}
