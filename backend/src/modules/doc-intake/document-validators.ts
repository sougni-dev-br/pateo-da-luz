// Conversoes e conferencias determinísticas do documento lido.
//
// REGRA DO MODULO: o modelo TRANSCREVE, o codigo CONVERTE e CONFERE.
// Por isso valor e data chegam do modelo como string crua ("19.150,50",
// "17/08/2026") e sao convertidos aqui. Pedir numero/ISO ao modelo economizaria
// estas funcoes, mas coloca arredondamento e ordem dia/mes na mao dele — e um
// centavo ou um mes errado contamina CMV e DRE sem deixar rastro.

const MAX_DIFERENCA_CENTAVOS = 0.01;

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** "19.150,50" -> 19150.5 | null quando nao ha numero reconhecivel. */
export function brToNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  // Formato BR: ponto e milhar, virgula e decimal.
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * "17/08/2026" -> Date (UTC meia-noite).
 * UTC de proposito: `new Date(ano, mes, dia)` resolve no fuso do processo e ja
 * jogou lancamento para outro mes em producao (ver comentario de TIMEZONE no app.ts).
 */
export function brToDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const match = String(raw).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejeita 31/02 e afins, que o Date "corrige" silenciosamente para 03/03.
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return date;
}

/** Digito verificador do CNPJ. Sem isto, um OCR trocando 8 por 3 passa batido. */
export function isValidCnpj(raw: string | null | undefined): boolean {
  const digits = onlyDigits(raw);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcCheckDigit = (length: number): number => {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return calcCheckDigit(12) === Number(digits[12])
    && calcCheckDigit(13) === Number(digits[13]);
}

export function somaConfere(rubricas: Array<{ valor: number | null }>, total: number | null): boolean {
  if (total === null) return false;
  // Documento sem rubricas discriminadas (boleto simples) nao tem o que conferir.
  if (rubricas.length === 0) return true;
  const soma = rubricas.reduce((acc, item) => acc + (item.valor ?? 0), 0);
  return Math.abs(soma - total) <= MAX_DIFERENCA_CENTAVOS;
}

/**
 * Chave logica do titulo. Serve tanto para achar duplicata quanto para parear
 * a nota fiscal com o boleto dela: os dois documentos descrevem o MESMO titulo
 * e precisam virar um lancamento so, nunca dois.
 */
export function chaveTitulo(input: {
  cnpjEmissor: string | null;
  valorTotal: number | null;
  dataVencimento: Date | null;
}): string | null {
  const cnpj = onlyDigits(input.cnpjEmissor);
  if (!cnpj || input.valorTotal === null || !input.dataVencimento) return null;
  const valor = input.valorTotal.toFixed(2);
  const vencimento = input.dataVencimento.toISOString().slice(0, 10);
  return `${cnpj}|${valor}|${vencimento}`;
}
