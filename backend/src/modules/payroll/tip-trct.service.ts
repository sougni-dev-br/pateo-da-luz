// Leitura do Termo de Rescisão (TRCT) que volta da contabilidade. A gorjeta do
// desligado já vem paga dentro da rescisão (rubrica GORJETA): este é o valor
// quitado que sai da apuração do mês. Guarda só o que importa para a gorjeta —
// CPF, PIS e demais dados pessoais do PDF não são gravados.
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";

export type ReciboRescisao = {
  nome: string | null;
  cpfDigitos: string | null; // só para casar com o cadastro; não é gravado
  admissao: string | null;   // AAAA-MM-DD
  afastamento: string | null;
  pagamento: string | null;
  gorjeta: number | null;
  liquido: number | null;
  totalBruto: number | null;
};

const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const DATAS = /(\d{2}\/\d{2}\/\d{4})/g;
const VALOR = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})";

const iso = (br: string | undefined | null) => {
  const m = br?.match(DATA);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const numero = (br: string | undefined | null) => (br ? Number(br.replace(/\./g, "").replace(",", ".")) : null);

export function lerTextoRescisao(txt: string): ReciboRescisao {
  const nome = txt.match(/11 Nome\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? null;
  const cpf = txt.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/)?.[1] ?? null;

  // Campos 24 (admissão), 25 (aviso) e 26 (afastamento): o PDF traz os rótulos
  // fora de ordem, mas os valores na ordem dos números dos campos.
  const blocoDatas = txt.match(/Data de Admiss[ãa]o\s*\n([^\n]*)/)?.[1] ?? "";
  const datas = blocoDatas.match(DATAS) ?? [];
  let admissao = datas.length >= 3 ? iso(datas[0]) : null;
  let afastamento = datas.length >= 3 ? iso(datas[2]) : null;
  if (!afastamento) afastamento = iso(txt.match(/Data demiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]);
  if (!admissao) admissao = iso(txt.match(/Data op[çc][ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]);

  const pagamento = iso(txt.match(/Data pagamento:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]);
  // "203 GORJETA 370,93 370,93": referência e provento; vale o último valor da linha.
  const linhaGorjeta = txt.match(new RegExp(`\\bGORJETAS?\\b[^\\n]*?${VALOR}[^\\n]*`, "i"))?.[0] ?? null;
  const valoresGorjeta = linhaGorjeta?.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) ?? [];
  const gorjeta = valoresGorjeta.length ? numero(valoresGorjeta[valoresGorjeta.length - 1]) : null;
  const liquido = numero(txt.match(new RegExp(`L[íi]quido rescis[ãa]o:\\s*${VALOR}`, "i"))?.[1])
    ?? numero(txt.match(new RegExp(`VALOR L[ÍI]QUIDO\\s*R\\$\\s*${VALOR}`, "i"))?.[1]);
  const totalBruto = numero(txt.match(new RegExp(`Totais:\\s*${VALOR}`))?.[1]);

  return { nome, cpfDigitos: cpf ? cpf.replace(/\D/g, "") : null, admissao, afastamento, pagamento, gorjeta, liquido, totalBruto };
}

export async function lerPdfRescisao(buffer: Buffer): Promise<{ recibo: ReciboRescisao; hash: string }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const { text } = await parser.getText();
  const recibo = lerTextoRescisao(text ?? "");
  if (!/RESCIS[ÃA]O/i.test(text ?? "")) throw new Error("O arquivo não parece um termo de rescisão.");
  return { recibo, hash: crypto.createHash("sha256").update(buffer).digest("hex") };
}
