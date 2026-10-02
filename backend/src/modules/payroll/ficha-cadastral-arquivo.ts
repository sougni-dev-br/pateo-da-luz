// Arquivo enviado pelo link: o tipo vem do conteúdo (assinatura dos primeiros bytes), não do
// nome nem do Content-Type que o navegador declarou — quem manda é anônimo.
import type { Response } from "express";

export const TAMANHO_MAXIMO = 8 * 1024 * 1024;
export const MAX_ARQUIVOS_POR_FICHA = 20;
export const TOTAL_MAXIMO_POR_FICHA = 60 * 1024 * 1024;

const ASSINATURAS: Array<{ mime: string; confere: (b: Buffer) => boolean }> = [
  { mime: "image/jpeg", confere: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", confere: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", confere: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  { mime: "application/pdf", confere: (b) => b.length > 5 && b.toString("ascii", 0, 5) === "%PDF-" },
];

export function tipoDoConteudo(conteudo: Buffer): string | null {
  return ASSINATURAS.find((a) => a.confere(conteudo))?.mime ?? null;
}

/** Nome para exibir/baixar: sem caminho, sem caractere de controle, curto. */
export function nomeSeguro(nome: string | undefined, mime: string): string {
  const base = String(nome ?? "").split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N} ._()-]/gu, "").trim().slice(0, 80);
  const extensao = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  if (!base) return `documento${extensao}`;
  return /\.[a-z0-9]{2,4}$/i.test(base) ? base : `${base}${extensao}`;
}

export function enviarArquivo(response: Response, arquivo: { mimeType: string; nomeOriginal: string; conteudo: Uint8Array | Buffer }) {
  response.setHeader("Content-Type", arquivo.mimeType);
  response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(arquivo.nomeOriginal)}`);
  response.setHeader("X-Content-Type-Options", "nosniff");
  // Defesa em profundidade: aberto no navegador, o arquivo não roda script nem carrega nada.
  response.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  response.setHeader("Cache-Control", "private, no-store");
  response.send(Buffer.from(arquivo.conteudo));
}
