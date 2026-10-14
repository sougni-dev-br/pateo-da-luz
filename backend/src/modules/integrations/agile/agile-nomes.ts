// Parecença entre o nome de um produto do PDV e o de um prato da ficha técnica. Os dois são
// escritos à mão por pessoas diferentes ("PAILLARD DE MIGNON C/ RISOTO" x "Pallard de Mignon"), então
// só sugerimos: quem decide o vínculo é uma pessoa.

const STOPWORDS = new Set(["de", "do", "da", "dos", "das", "e", "a", "o", "ao", "aos", "c", "com", "na", "no", "em", "para", "p", "ou", "um", "uma"]);
// 0,4 pega "BIFE ANCHO DO PATEO" x "Bife Ancho Grelhado Batatas e Arroz Biro Biro"; é só sugestão, quem confirma é uma pessoa.
export const SIMILARIDADE_MINIMA = 0.4;
export const MAX_SUGESTOES = 3;

// Marcas combinantes U+0300 a U+036F, montadas por código para não depender de caractere invisível no fonte.
const MARCAS_DE_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const semAcento = (s: string) => s.normalize("NFD").replace(MARCAS_DE_ACENTO, "");

export function tokensDoNome(nome: string): string[] {
  return semAcento(nome)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOPWORDS.has(t))
    // Plural simples: "fritas" e "frita" são a mesma palavra para este fim.
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

// Distância de edição curta o bastante para tolerar uma letra trocada, sobrando ou faltando.
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    anterior = atual;
  }
  return anterior[b.length];
}

const mesmaPalavra = (a: string, b: string) => a === b || (Math.max(a.length, b.length) >= 4 && distancia(a, b) <= 1);

// Dice sobre as palavras: 2 x (palavras em comum) / (palavras de um + palavras do outro).
export function similaridade(a: string, b: string): number {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const usadas = new Set<number>();
  let comuns = 0;
  for (const palavra of ta) {
    const achada = tb.findIndex((x, i) => !usadas.has(i) && mesmaPalavra(palavra, x));
    if (achada >= 0) {
      usadas.add(achada);
      comuns++;
    }
  }
  return (2 * comuns) / (ta.length + tb.length);
}

export type SugestaoDePrato = { pratoId: string; nome: string; similaridade: number };

export function sugerirPratos(nomeDoProduto: string, pratos: Array<{ id: string; nome: string }>): SugestaoDePrato[] {
  return pratos
    .map((p) => ({ pratoId: p.id, nome: p.nome, similaridade: Math.round(similaridade(nomeDoProduto, p.nome) * 100) / 100 }))
    .filter((s) => s.similaridade >= SIMILARIDADE_MINIMA)
    .sort((x, y) => y.similaridade - x.similaridade || x.nome.localeCompare(y.nome))
    .slice(0, MAX_SUGESTOES);
}
