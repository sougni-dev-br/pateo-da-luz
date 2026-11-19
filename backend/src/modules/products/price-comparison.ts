// Comparacao de preco de compra de um produto por fornecedor.
//
// O preco que vale e o da unidade de estoque (convertedUnitPrice): uma caixa de
// R$ 120 com 10 kg e R$ 12/kg, e e isso que se compara com o outro fornecedor.
// Linha em outra unidade que a da compra mais recente nao entra na conta, em vez
// de entrar com um numero que nao e comparavel; fica contada em ignoredOtherUnit.

export type LinhaDePreco = {
  date: string;
  supplierName: string;
  unit: string | null;
  unitPrice: number;
  quantity: number | null;
  convertedUnit: string | null;
  convertedUnitPrice: number | null;
  convertedQuantity: number | null;
};

export type PrecoPorFornecedor = {
  supplierName: string;
  lastPrice: number;
  lastDate: string;
  minPrice: number;
  avgPrice: number;
  purchases: number;
  /** Ultimos precos (ate 8), do mais antigo para o mais novo: alimenta o mini-grafico de tendencia. */
  recent: number[];
  /** Ha quantos dias foi a ultima compra deste fornecedor. */
  daysSinceLast: number;
  /** Preco com mais de STALE_DAYS dias: confirmar com o fornecedor antes de contar com ele. */
  isStale: boolean;
  /** Quantidade da ultima compra, na unidade comparavel: referencia de quanto se costuma pedir. */
  lastQuantity: number | null;
  /** Preco da compra anterior deste mesmo fornecedor e quanto mudou ate a ultima. Nulo na primeira compra. */
  previousPrice: number | null;
  changePercent: number | null;
  isCheapest: boolean;
};

export type EconomiaPotencial = {
  windowDays: number;
  /** O que se pagou acima do menor preco atual, somado nas compras da janela. */
  amount: number;
  /** Total gasto nas compras da janela, na unidade comparavel. */
  spent: number;
  percent: number;
  /** Quantas compras da janela custaram mais que o menor preco atual. */
  purchases: number;
};

export type ComparacaoDePreco = {
  unit: string | null;
  suppliers: PrecoPorFornecedor[];
  savings: EconomiaPotencial | null;
  ignoredOtherUnit: number;
};

const MAX_PONTOS_DA_SERIE = 8;
export const STALE_DAYS = 45;
export const JANELA_ECONOMIA_DIAS = 90;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

type Ponto = { date: string; supplierName: string; unit: string; price: number; quantity: number | null };

function normalizar(linha: LinhaDePreco): Ponto | null {
  const convertido = linha.convertedUnitPrice != null && Boolean(linha.convertedUnit);
  const price = convertido ? (linha.convertedUnitPrice as number) : linha.unitPrice;
  const unit = ((convertido ? linha.convertedUnit : linha.unit) ?? "").trim().toUpperCase();
  if (!Number.isFinite(price) || price <= 0) return null;
  const quantity = convertido ? linha.convertedQuantity : linha.quantity;
  return { date: linha.date, supplierName: linha.supplierName, unit, price, quantity: quantity != null && quantity > 0 ? quantity : null };
}

const arredonda = (n: number, casas = 4) => Math.round(n * 10 ** casas) / 10 ** casas;

// A unidade mais usada no historico, e nao a da ultima compra: uma nota sem
// conversao cadastrada chegaria em CX e jogaria todo o historico em KG para fora.
// Empate fica com a unidade da compra mais recente.
function unidadeDeReferencia(recentesPrimeiro: Ponto[]): string {
  const contagem = new Map<string, number>();
  for (const p of recentesPrimeiro) contagem.set(p.unit, (contagem.get(p.unit) ?? 0) + 1);
  let melhor = recentesPrimeiro[0].unit;
  for (const [unit, total] of contagem) if (total > (contagem.get(melhor) ?? 0)) melhor = unit;
  return melhor;
}

function diasAte(hoje: Date, data: string): number {
  const alvo = Date.parse(`${data}T00:00:00Z`);
  const base = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.max(0, Math.round((base - alvo) / MS_POR_DIA));
}

function calcularEconomia(comparaveis: Ponto[], menorPreco: number, diasDoMenor: number, hoje: Date): EconomiaPotencial | null {
  // Menor preco velho nao serve de base: a economia seria contra um preco que talvez ja nao exista.
  if (diasDoMenor > STALE_DAYS) return null;
  const naJanela = comparaveis.filter((p) => p.quantity != null && diasAte(hoje, p.date) <= JANELA_ECONOMIA_DIAS);
  const acima = naJanela.filter((p) => p.price > menorPreco);
  if (acima.length === 0) return null;
  const amount = acima.reduce((soma, p) => soma + (p.price - menorPreco) * (p.quantity as number), 0);
  const spent = naJanela.reduce((soma, p) => soma + p.price * (p.quantity as number), 0);
  return {
    windowDays: JANELA_ECONOMIA_DIAS,
    amount: arredonda(amount, 2),
    spent: arredonda(spent, 2),
    percent: spent > 0 ? arredonda((amount / spent) * 100, 1) : 0,
    purchases: acima.length
  };
}

export function compararPrecos(
  linhas: LinhaDePreco[],
  opcoes: { today?: Date } = {}
): ComparacaoDePreco {
  const hoje = opcoes.today ?? new Date();
  const validos = linhas
    .map(normalizar)
    .filter((p): p is Ponto => p !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (validos.length === 0) return { unit: null, suppliers: [], savings: null, ignoredOtherUnit: 0 };

  const unit = unidadeDeReferencia(validos);
  const comparaveis = validos.filter((p) => p.unit === unit);

  const porFornecedor = new Map<string, Ponto[]>();
  for (const p of comparaveis) porFornecedor.set(p.supplierName, [...(porFornecedor.get(p.supplierName) ?? []), p]);

  const suppliers = [...porFornecedor.entries()]
    .map(([supplierName, pontos]): PrecoPorFornecedor => {
      const [ultimo, anterior] = pontos;
      const daysSinceLast = diasAte(hoje, ultimo.date);
      return {
        supplierName,
        lastPrice: ultimo.price,
        lastDate: ultimo.date,
        minPrice: Math.min(...pontos.map((p) => p.price)),
        avgPrice: arredonda(pontos.reduce((soma, p) => soma + p.price, 0) / pontos.length),
        purchases: pontos.length,
        recent: pontos.slice(0, MAX_PONTOS_DA_SERIE).map((p) => p.price).reverse(),
        daysSinceLast,
        isStale: daysSinceLast > STALE_DAYS,
        lastQuantity: ultimo.quantity,
        previousPrice: anterior ? anterior.price : null,
        changePercent: anterior ? arredonda(((ultimo.price - anterior.price) / anterior.price) * 100, 1) : null,
        isCheapest: false
      };
    })
    .sort((a, b) => a.lastPrice - b.lastPrice);
  suppliers[0].isCheapest = true;

  return {
    unit: unit || null,
    suppliers,
    savings: calcularEconomia(comparaveis, suppliers[0].lastPrice, suppliers[0].daysSinceLast, hoje),
    ignoredOtherUnit: validos.length - comparaveis.length
  };
}
