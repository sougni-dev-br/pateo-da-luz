// Previa, na linha da nota, de quanto entra na unidade de contagem.

const SINONIMOS: Record<string, string> = { UNI: "UN", UND: "UN", UNIDADE: "UN", PCTE: "PCT", PACOTE: "PCT", CAIXA: "CX", FARDO: "FD" };

export function normalizarUnidade(unidade: string | null | undefined): string {
  const bruto = String(unidade ?? "").trim().toUpperCase().replace(/\.+$/, "");
  return SINONIMOS[bruto] ?? bruto;
}

type ProdutoComEmbalagens = {
  unit?: string | null;
  stockUnit?: string | null;
  unitConversions?: Array<{ fromUnit: string; toUnit: string; factor: string | number; isActive?: boolean }>;
};

export type PreviaDeConversao =
  | { tipo: "converte"; quantidade: number; unidade: string; fator: number }
  | { tipo: "sem_conversao"; unidade: string };

/** `null` quando a nota ja esta na unidade de contagem (ou nao da para saber). */
export function previaDaConversao(produto: ProdutoComEmbalagens | undefined, unidadeDaNota: string, quantidade: number): PreviaDeConversao | null {
  if (!produto) return null;
  const contagem = normalizarUnidade(produto.stockUnit ?? produto.unit);
  const nota = normalizarUnidade(unidadeDaNota);
  if (!contagem || !nota || contagem === nota) return null;
  const ativas = (produto.unitConversions ?? []).filter((c) => c.isActive !== false);
  const direta = ativas.find((c) => normalizarUnidade(c.fromUnit) === nota && normalizarUnidade(c.toUnit) === contagem);
  const inversa = ativas.find((c) => normalizarUnidade(c.fromUnit) === contagem && normalizarUnidade(c.toUnit) === nota);
  const fator = direta ? Number(direta.factor) : inversa ? 1 / Number(inversa.factor) : null;
  if (fator == null || !Number.isFinite(fator) || fator <= 0) return { tipo: "sem_conversao", unidade: contagem };
  return { tipo: "converte", quantidade: quantidade * fator, unidade: contagem, fator };
}
