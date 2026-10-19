// Regras da seção "Embalagens de compra" do cadastro de produto.
// Funções puras: a tela só desenha o que elas devolvem.

export type ConversaoDoForm = {
  fromUnit: string;
  toUnit: string;
  factor: string;
  averagePackageWeight: string;
  notes: string;
  isActive: boolean;
};

// Mesmo critério do backend (product-conversoes.ts): vírgula, ponto e vírgula
// ou espaço no meio é uma lista ("PCT, CX, FD"), não uma unidade.
const UNIDADE_COM_LISTA = /[\s,;]/;

export function unidadeValida(codigo: string): boolean {
  const c = codigo.trim();
  return c.length > 0 && !UNIDADE_COM_LISTA.test(c);
}

/** Aceita "12", "0,5", "0.5" e "1.000,5". Devolve null quando não é número. */
export function lerFator(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const limpo = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

export function formatarNumero(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
}

export type ProblemaDoRascunho =
  | "sem-contagem"
  | "sem-origem"
  | "origem-igual-contagem"
  | "fator-invalido"
  | "ja-cadastrada"
  | null;

export function mensagemDoProblema(problema: ProblemaDoRascunho, origem: string, contagem: string): string {
  switch (problema) {
    case "sem-contagem":
      return "Antes, escolha a unidade padrão (ou a de estoque) do produto, na parte de cima desta aba: é nela que o estoque é contado.";
    case "origem-igual-contagem":
      return `Escolha uma embalagem diferente de ${contagem}. Se a nota já vem em ${contagem}, não precisa de conversão.`;
    case "fator-invalido":
      return "Digite quantas unidades vêm em cada embalagem, com um número maior que zero (ex.: 12 ou 0,5).";
    case "ja-cadastrada":
      return `Já existe uma conversão de ${origem} para ${contagem}. Remova a antiga se quiser trocar o número.`;
    default:
      return "";
  }
}

export function diagnosticarRascunho(input: {
  origem: string;
  fator: string;
  contagem: string;
  existentes: ConversaoDoForm[];
  /** Quantas unidades de `origem` vêm na nota para entrarem `fator` (padrão 1). */
  quantidade?: string;
}): ProblemaDoRascunho {
  const { origem, fator, contagem, existentes, quantidade = "1" } = input;
  if (!contagem) return "sem-contagem";
  if (!origem) return "sem-origem";
  if (origem.toUpperCase() === contagem.toUpperCase()) return "origem-igual-contagem";
  const n = lerFator(fator);
  const q = lerFator(quantidade);
  if (n == null || n <= 0 || q == null || q <= 0) return "fator-invalido";
  const repetida = existentes.some(
    (c) => c.fromUnit.trim().toUpperCase() === origem.toUpperCase() && c.toUnit.trim().toUpperCase() === contagem.toUpperCase()
  );
  return repetida ? "ja-cadastrada" : null;
}

/** "10 CX na nota = 120 UN no estoque" (ou "50 L na nota = 1 BARRIL no estoque"). Null enquanto faltar dado. */
export function exemploAoVivo(origem: string, fator: string, contagem: string, quantidade = "1"): string | null {
  const n = lerFator(fator);
  const q = lerFator(quantidade);
  if (!origem || !contagem || n == null || n <= 0 || q == null || q <= 0) return null;
  if (q === 1) return `Exemplo: 10 ${origem} na nota = ${formatarNumero(10 * n)} ${contagem} no estoque.`;
  return `Exemplo: ${formatarNumero(q)} ${origem} na nota = ${formatarNumero(n)} ${contagem} no estoque.`;
}

/** Texto da conversão já cadastrada: "1 CX = 12 UN"; fator fracionário vira o lado inteiro ("50 L = 1 BARRIL"). */
export function descreverConversao(c: ConversaoDoForm): string {
  const n = lerFator(c.factor);
  if (n == null) return `1 ${c.fromUnit} = ${c.factor} ${c.toUnit}`;
  const inverso = n > 0 && n < 1 ? Math.round((1 / n) * 1e6) / 1e6 : null;
  if (inverso != null && Number.isInteger(inverso)) return `${formatarNumero(inverso)} ${c.fromUnit} = 1 ${c.toUnit}`;
  return `1 ${c.fromUnit} = ${formatarNumero(n)} ${c.toUnit}`;
}

/** Unidade que não dá para usar (ex.: "PCT, CX, FD" gravada por engano). */
export function conversaoComUnidadeInvalida(c: ConversaoDoForm): boolean {
  return !unidadeValida(c.fromUnit) || !unidadeValida(c.toUnit);
}

/** Linha nova no formato que o backend espera; peso e observação ficam vazios. */
export function montarConversao(origem: string, fator: string, contagem: string, quantidade = "1"): ConversaoDoForm {
  const n = lerFator(fator) as number;
  const q = lerFator(quantidade) as number;
  // Guarda sempre "quanto entra por 1 unidade da nota": 50 L = 1 BARRIL vira 1 L = 0,02 BARRIL.
  const porUnidade = Math.round((n / q) * 1e9) / 1e9;
  return { fromUnit: origem, toUnit: contagem, factor: String(porUnidade), averagePackageWeight: "", notes: "", isActive: true };
}

/** "12.000000" -> "12"; texto que não é número volta como veio. */
export function fatorLegivel(factor: string): string {
  const n = lerFator(factor);
  return n == null ? factor : formatarNumero(n);
}
