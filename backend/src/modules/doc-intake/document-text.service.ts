// Leitura do texto do PDF. Mesma biblioteca ja usada no extrato do RH
// (rh-extract.service.ts), entao nao entra dependencia nova no projeto.

import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";

/** Abaixo disto o PDF e imagem (escaneado/fotografado) e o texto nao serve. */
const MIN_CHARS_TEXTO_UTIL = 120;

export type DocumentoLido = {
  texto: string;
  paginas: number | null;
  /** true quando nao ha camada de texto — exige leitura por imagem (fase 2). */
  precisaVisao: boolean;
  /** SHA-256 do arquivo: idempotencia sem depender do nome do arquivo. */
  hash: string;
};

export function hashArquivo(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function lerTextoPdf(buffer: Buffer): Promise<DocumentoLido> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const resultado = await parser.getText();
  const texto = (resultado.text ?? "").trim();
  const charsUteis = texto.replace(/\s/g, "").length;

  return {
    texto,
    paginas: (resultado as { total?: number }).total ?? null,
    precisaVisao: charsUteis < MIN_CHARS_TEXTO_UTIL,
    hash: hashArquivo(buffer),
  };
}
