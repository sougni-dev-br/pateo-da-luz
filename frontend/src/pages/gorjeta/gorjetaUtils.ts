import type { CSSProperties } from "react";
import type { TipComputation, TipComputedParticipant, TipParticipantInput, TipParticipantKind, TipRegrasPessoa, TipValeType } from "../../api/client";

export const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export const VALE_LABELS: Record<TipValeType, string> = {
  REFEICAO: "Refeição", VALE_CONSUMO: "Vale consumo", RETIRADA_CAIXA: "Retirada de caixa",
  ADIANTAMENTO: "Adiantamento", OUTRO: "Outro desconto", CREDITO: "Crédito (soma)",
};

export const inputStyle: CSSProperties = {
  width: "100%", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--surface, #fff)", color: "inherit", font: "inherit",
};
export const numInputStyle: CSSProperties = { ...inputStyle, width: 64, textAlign: "right", padding: "4px 6px" };
export const panelStyle: CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12,
};
export const mutedStyle: CSSProperties = { color: "var(--muted)", fontSize: 12 };

export function money(v: number | string | null | undefined) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  return isNaN(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function pts(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

// "7:34", "7h34", "7,5" (horas decimais) → minutos. Vazio ou inválido → null.
export function parseHoras(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const s = texto.trim().toLowerCase().replace("h", ":");
  const hm = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const dec = Number(s.replace(",", "."));
  return isNaN(dec) ? null : Math.round(dec * 60);
}

export function fmtHoras(min: number | null): string {
  if (min == null) return "";
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

// Estimativa interna (aba "Controle HE" da planilha): hora normal = salário ÷ 220;
// HE com 50%; adicional noturno de 20% sobre a hora noturna reduzida de 52,5 min.
export function estimarAdicionais(salario: number | null, heMin: number | null, noturnoMin: number | null) {
  if (!salario) return null;
  const hora = salario / 220;
  const he = heMin ? (heMin / 60) * hora * 1.5 : 0;
  const noturno = noturnoMin ? (noturnoMin / 60) * ((hora * 0.2 * 60) / 52.5) : 0;
  return { he, noturno, total: he + noturno };
}

// Linha editável do rateio. Campos de ocorrência vazios = usar a Escala.
export type LocalRow = {
  employeeId: string;
  kind: TipParticipantKind;
  fixedAmount: string;
  pointsAdjustment: string;
  faltas: string;
  atestados: string;
  ferias: string;
  outrosDias: string;
  diasPrevistosOverride: string;
  regras: TipRegrasPessoa;
  diasSalarioOverride: string;
  rescisaoServicoBruto: string;
  rescisaoValorFixo: string;
  horaExtra: string;
  adicionalNoturno: string;
  justificada: boolean;
};

const s = (v: number | null | undefined) => (v == null ? "" : String(v));

export function toLocalRow(p: TipComputedParticipant): LocalRow {
  return {
    employeeId: p.employeeId,
    kind: p.kind,
    fixedAmount: s(p.fixedAmount),
    pointsAdjustment: p.pointsAdjustment ? String(p.pointsAdjustment) : "",
    faltas: p.faltasOrigem === "MANUAL" ? s(p.faltas) : "",
    atestados: p.atestadosOrigem === "MANUAL" ? s(p.atestados) : "",
    ferias: p.feriasOrigem === "MANUAL" ? s(p.ferias) : "",
    outrosDias: p.outrosDias ? String(p.outrosDias) : "",
    diasPrevistosOverride: s(p.diasPrevistosOverride),
    regras: { ...p.regras },
    diasSalarioOverride: s(p.diasSalarioOverride),
    rescisaoServicoBruto: p.rescisaoServicoOrigem === "MANUAL" ? s(p.rescisaoServicoBruto) : "",
    rescisaoValorFixo: s(p.rescisaoValorFixo),
    horaExtra: p.horaExtra ?? "",
    adicionalNoturno: p.adicionalNoturno ?? "",
    justificada: p.justificada,
  };
}

// Ordem da planilha: quem está no mês primeiro, por nome; desligados no fim.
export function ordenar(list: TipComputedParticipant[]): TipComputedParticipant[] {
  const peso = (p: TipComputedParticipant) => (p.tipoCalculo === "MES" ? 0 : p.tipoCalculo === "FORA_DO_PERIODO" ? 2 : 1);
  return [...list].sort((a, b) => peso(a) - peso(b) || a.employeeName.localeCompare(b.employeeName, "pt-BR"));
}

export function toRows(comp: TipComputation): LocalRow[] {
  return ordenar(comp.participants).map(toLocalRow);
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

export function toPayload(r: LocalRow): TipParticipantInput {
  return {
    employeeId: r.employeeId,
    kind: r.kind,
    fixedAmount: r.kind === "FIXO" ? (numOrNull(r.fixedAmount) ?? 0) : null,
    pointsAdjustment: numOrNull(r.pointsAdjustment) ?? 0,
    faltas: numOrNull(r.faltas),
    atestados: numOrNull(r.atestados),
    ferias: numOrNull(r.ferias),
    outrosDias: numOrNull(r.outrosDias),
    diasPrevistosOverride: numOrNull(r.diasPrevistosOverride),
    ...r.regras,
    diasSalarioOverride: numOrNull(r.diasSalarioOverride),
    rescisaoServicoBruto: numOrNull(r.rescisaoServicoBruto),
    rescisaoValorFixo: numOrNull(r.rescisaoValorFixo),
    horaExtra: r.horaExtra || null,
    adicionalNoturno: r.adicionalNoturno || null,
    justificada: r.justificada,
  };
}

export type RowPatch = (employeeId: string, patch: Partial<LocalRow>) => void;

// CSV com ponto e vírgula e vírgula decimal: abre direto no Excel em português.
export function baixarCsv(nome: string, linhas: Array<Array<string | number | null>>) {
  const celula = (v: string | number | null) => {
    if (v == null) return "";
    const t = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
