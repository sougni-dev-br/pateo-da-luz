// Confere o tamanho que um .xlsx (que é um zip) ocupará DESCOMPRIMIDO, antes de entregá-lo ao exceljs.
//
// O limite de 5 MB do upload vale para o arquivo compactado. Um "zip bomb" de poucos KB
// descomprime em gigabytes, e o heap do plano free já estourou com ExcelJS uma vez
// (incidente de importação de 06/07/2026). Os tamanhos vêm do diretório central do zip,
// que é lido sem descomprimir nada.

import { ErroDeImportacao } from "./erro-de-importacao.js";

export const LIMITE_DESCOMPRIMIDO_BYTES = 30 * 1024 * 1024;
const LIMITE_DE_ENTRADAS = 200;

const ASSINATURA_FIM_DO_DIRETORIO = 0x06054b50;
const ASSINATURA_ENTRADA = 0x02014b50;
const TAMANHO_FIM_DO_DIRETORIO = 22;
const TAMANHO_MAXIMO_DO_COMENTARIO = 0xffff;
const TAMANHO_CABECALHO_ENTRADA = 46;
const ZIP64 = 0xffffffff;

const INVALIDO = "O arquivo não é um .xlsx válido.";

function acharFimDoDiretorio(zip: Buffer): number {
  const menor = Math.max(0, zip.length - TAMANHO_FIM_DO_DIRETORIO - TAMANHO_MAXIMO_DO_COMENTARIO);
  for (let i = zip.length - TAMANHO_FIM_DO_DIRETORIO; i >= menor; i -= 1) {
    if (zip.readUInt32LE(i) === ASSINATURA_FIM_DO_DIRETORIO) return i;
  }
  throw new ErroDeImportacao(INVALIDO);
}

/** Soma dos tamanhos descomprimidos declarados. Lança ErroDeImportacao se o zip é inválido ou grande demais. */
export function verificarTamanhoDoZip(zip: Buffer): number {
  if (zip.length < TAMANHO_FIM_DO_DIRETORIO) throw new ErroDeImportacao(INVALIDO);
  const fim = acharFimDoDiretorio(zip);
  const entradas = zip.readUInt16LE(fim + 10);
  let posicao = zip.readUInt32LE(fim + 16);
  if (entradas > LIMITE_DE_ENTRADAS) throw new ErroDeImportacao("O arquivo tem entradas demais para um .xlsx.");

  let total = 0;
  for (let i = 0; i < entradas; i += 1) {
    if (posicao + TAMANHO_CABECALHO_ENTRADA > zip.length || zip.readUInt32LE(posicao) !== ASSINATURA_ENTRADA) {
      throw new ErroDeImportacao(INVALIDO);
    }
    const descomprimido = zip.readUInt32LE(posicao + 24);
    if (descomprimido === ZIP64) throw new ErroDeImportacao("O arquivo é grande demais para importar.");
    total += descomprimido;
    if (total > LIMITE_DESCOMPRIMIDO_BYTES) throw new ErroDeImportacao("O arquivo é grande demais para importar.");
    const nome = zip.readUInt16LE(posicao + 28);
    const extra = zip.readUInt16LE(posicao + 30);
    const comentario = zip.readUInt16LE(posicao + 32);
    posicao += TAMANHO_CABECALHO_ENTRADA + nome + extra + comentario;
  }
  return total;
}
