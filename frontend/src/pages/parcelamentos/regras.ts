// Contas do parcelamento no navegador (prévia das parcelas e desconto da quitação), em centavos
// inteiros. O servidor refaz e confere tudo; aqui só evita surpresa antes de gravar.

export type ParcelaEditavel = { valor: string; vencimento: string };

const emReais = (centavos: number) => centavos / 100;
const naTela = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");

/** Aceita "1.234,56", "1234,5" e "1234.56"; devolve null se não for dinheiro com até 2 casas. */
export function valorDoCampo(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const normal = /,/.test(limpo) ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Number(normal);
}

export function somaEmCentavos(parcelas: Array<Pick<ParcelaEditavel, "valor">>): number {
  return parcelas.reduce((soma, p) => soma + Math.round((valorDoCampo(p.valor) ?? 0) * 100), 0);
}

function dataValida(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? { ano, mes, dia } : null;
}

/** Total ÷ n em centavos (resto na última parcela), vencimentos mensais no mesmo dia. */
export function gerarParcelas(total: number, quantidade: number, primeiroVencimento: string): ParcelaEditavel[] {
  const inicio = dataValida(primeiroVencimento);
  const totalCentavos = Math.round(total * 100);
  if (!inicio || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 120 || !(totalCentavos > 0)) return [];
  const base = Math.floor(totalCentavos / quantidade);
  const resto = totalCentavos - base * quantidade;
  return Array.from({ length: quantidade }, (_, i) => {
    const indice = inicio.mes - 1 + i;
    const ano = inicio.ano + Math.floor(indice / 12);
    const mes = indice % 12;
    const dia = Math.min(inicio.dia, new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate());
    return {
      valor: naTela(base + (i === quantidade - 1 ? resto : 0)),
      vencimento: `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
    };
  });
}

/** Reparte o desconto entre as parcelas (resto na última). Null se for negativo ou zerar alguma parcela. */
export function repartirDesconto(valores: number[], desconto: number): number[] | null {
  const descontoCent = Math.round(desconto * 100);
  const n = valores.length;
  if (n === 0 || descontoCent < 0) return null;
  const base = Math.floor(descontoCent / n);
  const resto = descontoCent - base * n;
  const partes = valores.map((_, i) => base + (i === n - 1 ? resto : 0));
  if (valores.some((v, i) => Math.round(v * 100) - partes[i] <= 0)) return null;
  return partes.map(emReais);
}

export type ProdutoParaParcelamento = {
  isActive: boolean;
  controlsStock?: boolean;
  dreCategoryId?: string | null;
  dreCategory?: { dreGroup?: string | null } | null;
};

/** Mesmo critério do servidor: parcelamento é despesa, então produto de estoque ou de CMV não serve. */
export function motivoProdutoInvalido(p: ProdutoParaParcelamento): string | null {
  if (!p.isActive) return "inativo";
  if (p.controlsStock) return "controla estoque";
  if (!p.dreCategoryId) return "sem categoria de DRE";
  if (p.dreCategory?.dreGroup === "CMV_COMPRAS") return "categoria de CMV";
  return null;
}
