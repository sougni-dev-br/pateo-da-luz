// Textos do Retorno do RH: dizem o que a importação vai fazer de fato — lançar o que é
// novo e atualizar (sem duplicar) o que já está no Contas a Pagar — e se é o extrato do
// adiantamento (dia 20) ou o da folha do mês.
import type { ExtratoPreview, ImportExtratoResult } from "../api/client";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mmaaaa = (mes: number, ano: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const tipo = (calculo: ExtratoPreview["calculo"], n: number) =>
  calculo === "ADIANTAMENTO" ? (n === 1 ? "adiantamento" : "adiantamentos") : (n === 1 ? "salário" : "salários");

type Previa = Pick<ExtratoPreview, "calculo" | "competenceMonth" | "competenceYear" | "items" | "matchedCount" | "totalLiquido" | "lancamentosExistentes">;

/** Todas as pessoas do extrato já têm o lançamento: reimportar só atualiza. */
export const soAtualiza = (p: Previa) => p.items.length > 0 && p.lancamentosExistentes >= p.items.length;

export function textoBotaoImportar(p: Previa, importando: boolean): string {
  if (soAtualiza(p)) return importando ? "Atualizando…" : "Atualizar e guardar o extrato";
  if (importando) return "Lançando…";
  return p.calculo === "ADIANTAMENTO" ? "Lançar adiantamentos no Contas a Pagar" : "Lançar salários no Contas a Pagar";
}

export function confirmacaoImportar(p: Previa): string {
  const total = p.items.length;
  const existentes = Math.min(p.lancamentosExistentes, total);
  const novos = total - existentes;
  const comp = mmaaaa(p.competenceMonth, p.competenceYear);
  const cadastro = total - p.matchedCount > 0 ? ` ${total - p.matchedCount} pessoa(s) fora do cadastro serão cadastradas automaticamente.` : "";
  if (existentes >= total) {
    return `Os ${total} ${tipo(p.calculo, total)} de ${comp} já estão no Contas a Pagar. Reimportar atualiza os mesmos lançamentos (total ${reais(p.totalLiquido)}), sem duplicar, e guarda o PDF e os holerites. Continuar?`;
  }
  const vence = p.calculo === "ADIANTAMENTO" ? " com vencimento no dia 20" : " com vencimento no dia 5 do mês seguinte";
  const partes = existentes > 0
    ? `Lançar ${novos} ${tipo(p.calculo, novos)} novo(s) de ${comp}${vence} e atualizar ${existentes} que já estão no Contas a Pagar, sem duplicar`
    : `Lançar ${total} ${tipo(p.calculo, total)} de ${comp}${vence} no Contas a Pagar`;
  return `${partes} (total ${reais(p.totalLiquido)})?${cadastro}`;
}

export function resumoImportacao(r: Pick<ImportExtratoResult, "calculo" | "titulosNovos" | "titulosAtualizados" | "titulosPulados">): string {
  const partes: string[] = [];
  const pulados = r.titulosPulados ?? 0;
  if (r.titulosNovos > 0) partes.push(`${r.titulosNovos} ${tipo(r.calculo, r.titulosNovos)} lançado(s) no Contas a Pagar`);
  if (r.titulosAtualizados > 0) partes.push(`${r.titulosAtualizados} já lançado(s) e atualizado(s), sem duplicar`);
  // Excluído à mão no Contas a Pagar fica excluído: a reimportação não traz de volta.
  if (pulados > 0) partes.push(`${pulados} excluído(s) à mão, não recriado(s)`);
  return (partes.length ? partes.join("; ") : "Nenhum lançamento") + ".";
}

/** Avisos que só a importação trouxe (ex.: lançamento excluído à mão e não recriado); os da prévia já estão na tela. */
export function avisosSoDaImportacao(r: Pick<ImportExtratoResult, "avisos">, previa: Pick<ExtratoPreview, "avisos"> | null): string[] {
  const jaMostrados = new Set(previa?.avisos ?? []);
  return (r.avisos ?? []).filter((a) => !jaMostrados.has(a));
}
