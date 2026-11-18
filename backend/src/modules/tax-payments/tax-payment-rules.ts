import path from "node:path";

export type TaxStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "WITHOUT_RECEIPT";

const DIA_ISO = /^\d{4}-\d{2}-\d{2}/;

// As datas das guias ficam gravadas à meia-noite UTC e o servidor roda em UTC: comparar pelo dia
// (AAAA-MM-DD) evita deslocar por fuso. O "hoje" é o de Brasília (hojeBrasilia), senão a partir
// das 21h a guia que vence hoje já contaria como vencida.
export function diaIso(valor: Date | string | null | undefined): string | null {
  if (valor == null || valor === "") return null;
  const texto = valor instanceof Date ? (Number.isNaN(valor.getTime()) ? "" : valor.toISOString()) : String(valor);
  return DIA_ISO.test(texto) ? texto.slice(0, 10) : null;
}

export function hojeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

// Pago, cancelado e em aberto são os únicos estados gravados; "vencido" é derivado do
// vencimento e envelhece sozinho (o OVERDUE gravado só reflete o dia em que a guia foi salva).
export function statusDaGuia(
  paymentDate: Date | null,
  dueDate: Date,
  cancelada = false,
  hoje: Date = new Date()
): TaxStatus {
  if (cancelada) return "CANCELED";
  if (paymentDate) return "PAID";
  const vencimento = diaIso(dueDate);
  return vencimento && vencimento < hojeBrasilia(hoje) ? "OVERDUE" : "PENDING";
}

export const MAXIMO_DE_VALOR_DA_GUIA = 9_999_999_999.99; // Decimal(12,2)

// Só número ou texto no formato canônico ("1234.56"): "1.234" (milhar), "1e3", "0x1F", true ou [7] seriam aceitos por
// Number() e sairiam com outro valor em silêncio.
const VALOR_CANONICO = /^\d+(\.\d{1,2})?$/;

// Valor de guia ou de pagamento: maior que zero, até o limite do banco, arredondado em centavos.
export function parseValorGuia(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  let n: number;
  if (typeof valor === "number") n = valor;
  else if (typeof valor === "string" && VALOR_CANONICO.test(valor.trim())) n = Number(valor.trim());
  else return null;
  if (!Number.isFinite(n) || n <= 0 || n > MAXIMO_DE_VALOR_DA_GUIA) return null;
  const centavos = Math.round(n * 100) / 100;
  return centavos > 0 ? centavos : null;
}

// Status de uma guia que volta a ficar em aberto (estorno, restauração): vencida só depois do dia do vencimento, em Brasília.
export function statusDeGuiaEmAberto(dueDate: Date | null, hoje: Date = new Date()): "PENDING" | "OVERDUE" {
  return dueDate ? (statusDaGuia(null, dueDate, false, hoje) as "PENDING" | "OVERDUE") : "PENDING";
}

// Data de pagamento plausível: de 2015 até 60 dias à frente de hoje. Pega o ano digitado errado (1900, 2999) sem atrapalhar
// baixa antiga de verdade (há baixa de 2022 em produção) nem pagamento agendado para os próximos dias.
const PRIMEIRO_ANO_PLAUSIVEL = 2015;
const DIAS_A_FRENTE_PLAUSIVEIS = 60;

export function dataDePagamentoPlausivel(data: Date, hoje: Date = new Date()): boolean {
  if (Number.isNaN(data.getTime())) return false;
  const limite = hoje.getTime() + DIAS_A_FRENTE_PLAUSIVEIS * 86_400_000;
  return data.getUTCFullYear() >= PRIMEIRO_ANO_PLAUSIVEL && data.getTime() <= limite;
}

// Observações da guia depois de uma baixa: a nota da baixa e a diferença entre o pago e o valor da guia entram DEPOIS do que
// já estava (ex.: "Nº Recibo Declaração"), em vez de apagá-lo. Sem nota e sem diferença, devolve null (nada a mudar).
// toLocaleString põe um espaço inseparável depois do "R$": troca por espaço comum (busca e cópia do texto casam).
const REAL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
const LIMITE_DAS_OBSERVACOES = 2000;
const DIA_BR = (d: Date) => { const iso = diaIso(d) ?? ""; return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; };

// Acrescenta uma linha às observações SEM apagar o que já estava: o começo (ex.: "Nº Recibo Declaração") é o que mais
// importa. Se não couber inteira, entra cortada; se nem couber, as observações ficam como estão (devolve null).
function acrescentarLinha(atuais: string | null | undefined, linha: string): string | null {
  const base = atuais?.trim() ?? "";
  if (!base) return linha.slice(0, LIMITE_DAS_OBSERVACOES);
  const sobra = LIMITE_DAS_OBSERVACOES - base.length - 1;
  if (sobra <= 0) return null;
  return `${base}\n${linha.length > sobra ? `${linha.slice(0, Math.max(0, sobra - 1))}…` : linha}`;
}

export function observacoesDaBaixa(
  atuais: string | null | undefined,
  nota: string | undefined,
  valorDaGuia: number,
  valorPago: number,
  dataDaBaixa: Date,
): string | null {
  const diferenca = Math.round((valorPago - valorDaGuia) * 100) / 100;
  const partes = [
    nota?.trim() || null,
    Math.abs(diferenca) > 0.009 ? `Pago ${REAL(valorPago)} (${diferenca > 0 ? "+" : "-"}${REAL(Math.abs(diferenca))} em relação ao valor da guia)` : null,
  ].filter((p): p is string => Boolean(p));
  if (partes.length === 0) return null;
  // Com a data na frente, uma baixa estornada e refeita não deixa dúvida sobre qual linha é de qual baixa.
  return acrescentarLinha(atuais, `Baixa de ${DIA_BR(dataDaBaixa)}: ${partes.join(" · ")}`);
}

// O estorno também deixa rastro nas observações, para que a nota de uma baixa desfeita não pareça ainda valer.
export function observacoesDoEstorno(atuais: string | null | undefined, motivo: string, hoje: string = hojeBrasilia()): string | null {
  return acrescentarLinha(atuais, `Estorno de ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}: ${motivo.trim()}`);
}

export type DataLida = { ok: true; data: Date | null } | { ok: false };

// Ausente/vazio vira null; texto que não é data devolve ok:false (antes virava 500 do Prisma).
export function lerData(valor: unknown): DataLida {
  if (valor == null || valor === "") return { ok: true, data: null };
  const data = new Date(String(valor));
  return Number.isNaN(data.getTime()) ? { ok: false } : { ok: true, data };
}

// A importação devolve ao navegador só o nome que o multer deu ao arquivo (hex); o caminho
// é montado aqui. Antes o navegador mandava um caminho qualquer e o servidor o lia e apagava.
const NOME_UPLOAD = /^[a-f0-9]{32}$/;

export function resolverUploadImportacao(importFileId: unknown, pastaUploads: string): string | null {
  if (typeof importFileId !== "string" || !NOME_UPLOAD.test(importFileId)) return null;
  const pasta = path.resolve(pastaUploads);
  const caminho = path.resolve(pasta, importFileId);
  return path.dirname(caminho) === pasta ? caminho : null;
}
