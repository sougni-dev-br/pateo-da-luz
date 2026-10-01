// PDF que chega no corpo da requisição (base64, com ou sem o prefixo data:). Só entra o
// que começa como PDF e cabe em 5 MB.
const LIMITE_PDF = 5 * 1024 * 1024;

export function pdfDoCorpo(
  fileBase64: unknown,
  documento: { artigo: "do" | "da"; nome: string; umNome: string } = { artigo: "do", nome: "extrato", umNome: "um extrato" },
): { buffer: Buffer } | { status: number; message: string } {
  if (typeof fileBase64 !== "string" || !fileBase64) return { status: 400, message: `Envie o PDF ${documento.artigo} ${documento.nome} (fileBase64).` };
  const buffer = Buffer.from(fileBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (buffer.length > LIMITE_PDF) return { status: 413, message: `Arquivo grande demais para ${documento.umNome} (máximo 5 MB).` };
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return { status: 422, message: "O arquivo enviado não é um PDF." };
  return { buffer };
}
