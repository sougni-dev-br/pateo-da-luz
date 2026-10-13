// Foto do desperdício: prova de que a perda existiu (o que foi jogado, em que estado). Guardada no
// banco, então é pequena de propósito: a tela reduz a imagem antes de enviar e o servidor recusa o
// que passar disso. O prazo de guarda (waste-photo-expurgo.ts) limita o crescimento do banco.
import crypto from "node:crypto";

export const FOTO_TAMANHO_MAXIMO = 300 * 1024;
export const FOTO_DIAS_DE_GUARDA = 90;
/** Teto do espaço de fotos no banco (soma de todas): abaixo disso a tela segue; acima, recusa até o expurgo liberar. */
export const FOTO_ESPACO_MAXIMO = 150 * 1024 * 1024;

export type ResultadoDaFoto =
  | { ok: true; mimeType: "image/jpeg"; tamanho: number; sha256: string }
  | { ok: false; erro: string };

/**
 * Só JPEG, conferido pelos bytes e não pelo que o cliente declarou: o tipo vem do canvas da tela,
 * então qualquer outra coisa é erro ou tentativa de guardar arquivo que não é foto.
 */
export function validarFoto(conteudo: Buffer): ResultadoDaFoto {
  if (conteudo.length === 0) return { ok: false, erro: "A foto está vazia." };
  if (conteudo.length > FOTO_TAMANHO_MAXIMO) {
    return { ok: false, erro: `A foto passou de ${Math.round(FOTO_TAMANHO_MAXIMO / 1024)} KB. Tire outra ou reduza a imagem.` };
  }
  const ehJpeg = conteudo.length > 4 && conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff;
  // O JPEG do canvas termina no marcador EOI (FF D9); arquivo cortado ou lixo com cabeçalho de JPEG não passa.
  const terminaBem = conteudo[conteudo.length - 2] === 0xff && conteudo[conteudo.length - 1] === 0xd9;
  if (!ehJpeg || !terminaBem) return { ok: false, erro: "Envie a foto em JPEG." };
  return { ok: true, mimeType: "image/jpeg", tamanho: conteudo.length, sha256: crypto.createHash("sha256").update(conteudo).digest("hex") };
}
