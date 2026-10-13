// Redução da foto antes de enviar: o servidor guarda no banco e recusa mais de 300 KB, então a
// imagem do celular (vários MB) é reduzida aqui. Resolução suficiente para ver o que foi jogado fora.

export const LADO_MAXIMO_PX = 1280;
export const TAMANHO_ALVO_BYTES = 270 * 1024; // folga abaixo do limite de 300 KB do servidor
const QUALIDADES = [0.75, 0.6, 0.5, 0.4, 0.3];

/** Mantém a proporção e nunca amplia. */
export function dimensoesReduzidas(largura: number, altura: number, ladoMaximo = LADO_MAXIMO_PX): { largura: number; altura: number } {
  const maior = Math.max(largura, altura);
  if (!(maior > ladoMaximo)) return { largura, altura };
  const fator = ladoMaximo / maior;
  return { largura: Math.max(1, Math.round(largura * fator)), altura: Math.max(1, Math.round(altura * fator)) };
}

function canvasParaJpeg(canvas: HTMLCanvasElement, qualidade: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", qualidade));
}

/** Devolve um JPEG de até ~270 KB. Lança erro com mensagem para a pessoa se não conseguir. */
export async function reduzirFoto(arquivo: File): Promise<Blob> {
  if (!arquivo.type.startsWith("image/")) throw new Error("Escolha uma imagem.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    throw new Error("Não consegui abrir essa imagem. Tire a foto de novo.");
  }
  const { largura, altura } = dimensoesReduzidas(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  try {
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Este aparelho não conseguiu preparar a foto.");
    contexto.drawImage(bitmap, 0, 0, largura, altura);
  } finally {
    bitmap.close?.();
  }

  for (const qualidade of QUALIDADES) {
    const jpeg = await canvasParaJpeg(canvas, qualidade);
    if (jpeg && jpeg.size <= TAMANHO_ALVO_BYTES) return jpeg;
  }
  throw new Error("A foto ficou grande demais mesmo reduzida. Tire outra, mais de perto.");
}
