// Cálculo puro das parcelas de um parcelamento: valores em centavos inteiros e vencimentos
// mensais com dia fixo (dia 31 vira o último dia dos meses curtos).
export type ParcelaCalculada = { numero: number; valor: number; vencimento: string };
export type ParcelaInformada = { valor: number; vencimento: string };

export const MAX_PARCELAS = 360;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function paraCentavos(valor: number) {
  return Math.round(valor * 100);
}

function temCentavosExatos(valor: number) {
  return Number.isFinite(valor) && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;
}

function dataValida(texto: string): { ano: number; mes: number; dia: number } {
  const m = DATA_ISO.exec(texto);
  if (!m) throw new Error(`Data inválida: ${texto}. Use AAAA-MM-DD.`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new Error(`Data inválida: ${texto}.`);
  }
  return { ano, mes, dia };
}

function validarQuantidade(quantidade: number) {
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_PARCELAS) {
    throw new Error(`Número de parcelas deve ser inteiro entre 1 e ${MAX_PARCELAS}.`);
  }
}

export function dividirEmParcelas(total: number, quantidade: number): number[] {
  validarQuantidade(quantidade);
  const totalCentavos = paraCentavos(total);
  if (!Number.isFinite(total) || totalCentavos <= 0) throw new Error("Total do parcelamento deve ser maior que zero.");
  if (!temCentavosExatos(total)) throw new Error("Total do parcelamento deve ter no máximo 2 casas decimais.");
  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos - base * quantidade;
  return Array.from({ length: quantidade }, (_, i) => (base + (i === quantidade - 1 ? resto : 0)) / 100);
}

export function gerarVencimentosMensais(primeiro: string, quantidade: number): string[] {
  validarQuantidade(quantidade);
  const { ano, mes, dia } = dataValida(primeiro);
  return Array.from({ length: quantidade }, (_, i) => {
    const indice = mes - 1 + i;
    const a = ano + Math.floor(indice / 12);
    const m = indice % 12;
    const ultimoDia = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    const d = Math.min(dia, ultimoDia);
    return `${a}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

export function montarParcelas(entrada: {
  total: number;
  quantidade: number;
  primeiroVencimento?: string;
  informadas?: ParcelaInformada[];
}): ParcelaCalculada[] {
  const { total, quantidade, primeiroVencimento, informadas } = entrada;
  validarQuantidade(quantidade);
  if (informadas) {
    if (informadas.length !== quantidade) throw new Error("Quantidade de parcelas informadas não bate com o número de parcelas.");
    informadas.forEach((p) => {
      dataValida(p.vencimento);
      if (!Number.isFinite(p.valor) || paraCentavos(p.valor) <= 0) throw new Error("Valor de parcela deve ser maior que zero.");
      if (!temCentavosExatos(p.valor)) throw new Error("Valor de parcela deve ter no máximo 2 casas decimais.");
    });
    const soma = informadas.reduce((s, p) => s + paraCentavos(p.valor), 0);
    if (soma !== paraCentavos(total)) throw new Error("A soma das parcelas deve ser igual ao total do parcelamento.");
    return informadas.map((p, i) => ({ numero: i + 1, valor: p.valor, vencimento: p.vencimento }));
  }
  if (!primeiroVencimento) throw new Error("Informe o primeiro vencimento.");
  const valores = dividirEmParcelas(total, quantidade);
  const vencimentos = gerarVencimentosMensais(primeiroVencimento, quantidade);
  return valores.map((valor, i) => ({ numero: i + 1, valor, vencimento: vencimentos[i] }));
}
