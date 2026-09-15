// Regras de forma de pagamento e parcelamento.
//
// Fonte única do frontend: Purchases.tsx e a leitura de documentos importam daqui.
// O backend tem a sua própria cópia em backend/src/shared/utils/payment-methods.ts,
// que é a canônica e valida a gravação — as duas precisam contar a mesma história.
//
// Purchases.tsx tinha uma cópia local sem testes até 2026-09-15. A troca está
// caracterizada em __tests__/formas-pagamento.caracterizacao.test.ts.

const PADRAO_PARCELAS = /^(.*?)(?:\s+|\/|-)?(\d{1,2})\s*x$/;

export function normalizar(valor?: string | null): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * "BOLETO 3X" -> 3. O cadastro tem formas com a quantidade embutida no nome,
 * herdadas de antes de existir o campo de parcelas.
 */
export function parcelasNoNomeDaForma(nome?: string | null): number | null {
  const encontrado = normalizar(nome).match(PADRAO_PARCELAS);
  if (!encontrado) return null;
  const quantidade = Number(encontrado[2]);
  return quantidade > 0 && quantidade <= 60 ? quantidade : null;
}

/** "BOLETO 3X" -> "BOLETO". É o nome que a tela mostra. */
export function nomeBaseDaForma(nome?: string | null): string {
  const cru = String(nome ?? "").trim();
  const normalizado = normalizar(cru);
  const encontrado = normalizado.match(PADRAO_PARCELAS);
  const base = encontrado ? normalizar(encontrado[1]) : normalizado;

  if (base.includes("boleto")) return "BOLETO";
  if (base.includes("faturado") || base.includes("prazo")) return "FATURADO";
  if (base.includes("cartao") && base.includes("credito")) return "CARTÃO CRÉDITO";
  if (base.includes("cartao") && base.includes("debito")) return "CARTÃO DÉBITO";
  if (base.includes("pix")) return "PIX";
  if (base.includes("dinheiro") || base.includes("caixa")) return "DINHEIRO";
  return cru || "";
}

export type FormaPagamento = { id: string; name: string; group?: string | null; type?: string | null };

export function formaPermiteParcelamento(forma?: FormaPagamento | null): boolean {
  const base = normalizar(nomeBaseDaForma(forma?.name));
  if (["boleto", "faturado", "cartao credito"].includes(base)) return true;
  if (normalizar(forma?.group) === "faturado") return true;
  return ["credit_card", "bank_slip"].includes(normalizar(forma?.type));
}

/**
 * Lista para o select: um item por nome base, sem as variações "2X", "3X".
 * A quantidade de parcelas é campo próprio — é assim na tela de Compras, e
 * repetir BOLETO oito vezes no select só atrapalha.
 */
export function formasPorNomeBase(formas: FormaPagamento[]): Array<FormaPagamento & { rotulo: string }> {
  const porBase = new Map<string, FormaPagamento & { rotulo: string }>();
  for (const forma of formas) {
    const rotulo = nomeBaseDaForma(forma.name);
    if (!rotulo) continue;
    const existente = porBase.get(rotulo);
    // Prefere a forma "limpa" (sem 2X no nome) como representante do grupo.
    if (!existente || (parcelasNoNomeDaForma(existente.name) !== null && parcelasNoNomeDaForma(forma.name) === null)) {
      porBase.set(rotulo, { ...forma, rotulo });
    }
  }
  return [...porBase.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/**
 * Divide o total em N parcelas. A última absorve os centavos que sobram —
 * mesma regra da tela de Compras, para 7.150,07 em 2x dar 3.575,03 + 3.575,04
 * e o total fechar exatamente.
 */
export function dividirValor(total: number, partes: number): number[] {
  if (partes <= 0) return [];
  const centavosTotal = Math.round(total * 100);
  const base = Math.floor(centavosTotal / partes);
  const resto = centavosTotal - base * partes;
  return Array.from({ length: partes }, (_, indice) =>
    (base + (indice === partes - 1 ? resto : 0)) / 100,
  );
}

/** Soma dias a uma data "aaaa-mm-dd", devolvendo no mesmo formato. */
export function somarDias(dataIso: string, dias: number): string {
  if (!dataIso) return "";
  // Meio-dia evita o pulo de um dia por fuso ao converter.
  const data = new Date(`${dataIso}T12:00:00`);
  if (Number.isNaN(data.getTime())) return "";
  data.setDate(data.getDate() + dias);
  return data.toISOString().slice(0, 10);
}
