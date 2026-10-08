// Textos do Retorno do RH: dizem o que a importação vai fazer de fato — lançar o que é
// novo e atualizar (sem duplicar) o que já está no Contas a Pagar — e se é o extrato do
// adiantamento (dia 20) ou o da folha do mês.
import type { ExtratoPreview, ImportExtratoResult } from "../api/client";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mmaaaa = (mes: number, ano: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const tipo = (calculo: ExtratoPreview["calculo"], n: number) =>
  calculo === "ADIANTAMENTO" ? (n === 1 ? "adiantamento" : "adiantamentos") : (n === 1 ? "salário" : "salários");

type Previa = Pick<ExtratoPreview, "calculo" | "competenceMonth" | "competenceYear" | "items" | "matchedCount" | "totalLiquido" | "lancamentosExistentes"> & {
  previsao?: ExtratoPreview["previsao"];
};

/** Ninguém novo para lançar, só atualizar: reimportar só atualiza. */
export const soAtualiza = (p: Previa) => (p.previsao
  ? p.previsao.novos === 0 && p.previsao.atualizar > 0
  : p.items.length > 0 && p.lancamentosExistentes >= p.items.length);

// Quem está no extrato e não gera lançamento, cada motivo com o seu texto.
function semLancamento(p: NonNullable<Previa["previsao"]>, comp: string): string[] {
  return [
    p.zerados > 0 ? `${p.zerados} com líquido zero não geram lançamento` : "",
    p.desligados > 0 ? `${p.desligados} desligado(s) antes de ${comp} não geram lançamento` : "",
    p.excluidosAMao > 0 ? `${p.excluidosAMao} excluído(s) à mão não volta(m)` : "",
    p.jaPagos > 0 ? `${p.jaPagos} já pago(s) não muda(m)` : "",
    p.comOutroRotulo > 0 ? `${p.comOutroRotulo} já lançado(s) com outro rótulo não duplica(m)` : "",
  ].filter(Boolean);
}

export function textoBotaoImportar(p: Previa, importando: boolean): string {
  if (soAtualiza(p)) return importando ? "Atualizando…" : "Atualizar e guardar o extrato";
  if (importando) return "Lançando…";
  return p.calculo === "ADIANTAMENTO" ? "Lançar adiantamentos no Contas a Pagar" : "Lançar salários no Contas a Pagar";
}

export function confirmacaoImportar(p: Previa): string {
  if (p.previsao) return confirmacaoComPrevisao(p, p.previsao);
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

// Com a previsão do backend: conta só quem gera lançamento de verdade.
function confirmacaoComPrevisao(p: Previa, v: NonNullable<Previa["previsao"]>): string {
  const comp = mmaaaa(p.competenceMonth, p.competenceYear);
  const total = p.items.length;
  const cadastro = total - p.matchedCount > 0 ? ` ${total - p.matchedCount} pessoa(s) fora do cadastro serão cadastradas automaticamente.` : "";
  const fora = semLancamento(v, comp);
  const extras = fora.length > 0 ? `; ${fora.join("; ")}` : "";
  const valor = ` (total ${reais(p.totalLiquido)})`;
  if (v.novos === 0 && v.atualizar > 0 && fora.length === 0) {
    return `Os ${v.atualizar} ${tipo(p.calculo, v.atualizar)} de ${comp} já estão no Contas a Pagar. Reimportar atualiza os mesmos lançamentos${valor}, sem duplicar, e guarda o PDF e os holerites. Continuar?`;
  }
  const vence = p.calculo === "ADIANTAMENTO" ? " com vencimento no dia 20" : " com vencimento no dia 5 do mês seguinte";
  const partes = v.atualizar > 0
    ? `Lançar ${v.novos} ${tipo(p.calculo, v.novos)} novo(s) de ${comp}${v.novos > 0 ? vence : ""} e atualizar ${v.atualizar} que já estão no Contas a Pagar, sem duplicar`
    : `Lançar ${v.novos} ${tipo(p.calculo, v.novos)} de ${comp}${v.novos > 0 ? vence : ""} no Contas a Pagar`;
  return `${partes}${extras}${valor}?${cadastro}`;
}

type Resultado = Pick<ImportExtratoResult, "calculo" | "titulosNovos" | "titulosAtualizados" | "titulosPulados" | "adiantamentosDaFolha"
  | "excluidosAMao" | "zerados" | "desligados" | "jaPagos" | "comOutroRotulo">;

export function resumoImportacao(r: Resultado): string {
  const partes: string[] = [];
  const pulados = r.titulosPulados ?? 0;
  if (r.titulosNovos > 0) partes.push(`${r.titulosNovos} ${tipo(r.calculo, r.titulosNovos)} lançado(s) no Contas a Pagar`);
  if (r.titulosAtualizados > 0) partes.push(`${r.titulosAtualizados} já lançado(s) e atualizado(s), sem duplicar`);
  if (r.excluidosAMao != null) {
    // Backend novo: cada motivo com a sua contagem. Só o excluído à mão é exclusão de verdade.
    if (r.excluidosAMao > 0) partes.push(`${r.excluidosAMao} excluído(s) à mão, não recriado(s)`);
    if ((r.zerados ?? 0) > 0) partes.push(`${r.zerados} com líquido zero, sem lançamento (só o holerite guardado)`);
    if ((r.desligados ?? 0) > 0) partes.push(`${r.desligados} desligado(s) antes da competência, sem lançamento`);
    if ((r.jaPagos ?? 0) > 0) partes.push(`${r.jaPagos} já pago(s), não atualizado(s)`);
    if ((r.comOutroRotulo ?? 0) > 0) partes.push(`${r.comOutroRotulo} já lançado(s) com outro rótulo, não duplicado(s)`);
  } else if (pulados > 0) {
    // Backend antigo: só o total dos não gravados.
    partes.push(`${pulados} excluído(s) à mão, não recriado(s)`);
  }
  // Folha sem o extrato do dia 20: o adiantamento sai do desconto da própria folha.
  if ((r.adiantamentosDaFolha ?? 0) > 0) partes.push(`${r.adiantamentosDaFolha} adiantamento(s) lançado(s) a partir da folha (valor bruto)`);
  return (partes.length ? partes.join("; ") : "Nenhum lançamento") + ".";
}

/** Avisos que só a importação trouxe (ex.: lançamento excluído à mão e não recriado); os da prévia já estão na tela. */
export function avisosSoDaImportacao(r: Pick<ImportExtratoResult, "avisos">, previa: Pick<ExtratoPreview, "avisos"> | null): string[] {
  const jaMostrados = new Set(previa?.avisos ?? []);
  return (r.avisos ?? []).filter((a) => !jaMostrados.has(a));
}
