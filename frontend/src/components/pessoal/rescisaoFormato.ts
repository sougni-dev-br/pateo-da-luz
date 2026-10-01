// Formatação e comparação usadas pela janela da rescisão.
import type { ApuracaoRescisao } from "../../api/client";

/** dd/mm/aaaa de uma data do banco (UTC), sem o fuso puxar para o dia anterior. */
export function dataBr(iso: string): string {
  const d = iso.slice(0, 10);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export const centavosDiferentes = (a: number | null | undefined, b: number | null | undefined) =>
  Math.round(Math.abs((a ?? 0) - (b ?? 0)) * 100) >= 1;

export type Campo = "salario" | "gorjeta" | "vales" | "vtDesconto";
export type Divergencia = { campo: Campo; rotulo: string; apurado: number; lancado: number; diferenca: number };
export const ROTULO_CAMPO: Record<Campo, string> = {
  salario: "Salário proporcional", gorjeta: "Gorjeta até a saída", vales: "Vales", vtDesconto: "VT a descontar",
};

// Os mesmos campos (e o mesmo arredondamento) que o backend confere. Salário, gorjeta e
// vales só para sem registro (CLT: vêm da contabilidade); gorjeta pendente não conta.
export function divergencias(
  sugestao: ApuracaoRescisao["sugestao"] | null | undefined,
  v: Record<Campo, number | null>,
): Divergencia[] {
  if (!sugestao) return [];
  const apurado: Record<Campo, number | null> = {
    salario: sugestao.salario, gorjeta: sugestao.gorjeta,
    vales: sugestao.salario != null ? sugestao.vales : null,
    vtDesconto: sugestao.vtDesconto,
  };
  return (Object.keys(apurado) as Campo[])
    .filter((c) => apurado[c] != null && v[c] != null && centavosDiferentes(v[c], apurado[c]))
    .map((c) => ({
      campo: c, rotulo: ROTULO_CAMPO[c], apurado: apurado[c]!, lancado: v[c]!,
      diferenca: Math.round((v[c]! - apurado[c]!) * 100) / 100,
    }));
}

/** O que compõe os "Vales a descontar" sugeridos: aba Vales + o que já saiu no mês (adiantamento, 1ª quinzena). */
export function dicaValesRescisao(sugestao: Pick<ApuracaoRescisao["sugestao"], "adiantamento" | "primeiraQuinzena"> | null | undefined): string {
  const pagos = [
    (sugestao?.adiantamento ?? 0) > 0 ? "adiantamento salarial" : null,
    (sugestao?.primeiraQuinzena ?? 0) > 0 ? "1ª quinzena" : null,
  ].filter(Boolean);
  return pagos.length ? `aba Vales da gorjeta + ${pagos.join(" + ")} já pago no mês` : "lançados na aba Vales da gorjeta";
}
