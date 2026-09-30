// Histórico do cadastro de funcionários: o que conta como mudança na ficha e como
// cada valor aparece na lista.
import type { EmployeeHistoricoLinha, EmployeeModality } from "../../api/client";

/** Os campos da ficha que têm histórico (a empresa muda na Equipe da gorjeta, não aqui). */
export type CamposComHistorico = {
  baseSalary: string;
  salarioCombinado: string;
  modality: EmployeeModality;
  position: string;
  recebeAdiantamento: boolean;
};

// "2.200,00" e "2200" são o mesmo salário: compara o número, não o texto da máscara.
function dinheiro(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Mudou salário, combinado, vínculo, cargo ou adiantamento: a ficha pede "vale a partir de". */
export function mudouCampoComHistorico(original: CamposComHistorico | null, atual: CamposComHistorico): boolean {
  if (!original) return false;
  return dinheiro(original.baseSalary) !== dinheiro(atual.baseSalary)
    // O combinado só vai ao backend para CLT; para quem não é, fica como está.
    || (atual.modality === "CLT" && dinheiro(original.salarioCombinado) !== dinheiro(atual.salarioCombinado))
    || original.modality !== atual.modality
    || original.position.trim() !== atual.position.trim()
    || original.recebeAdiantamento !== atual.recebeAdiantamento;
}

export const ROTULO_ORIGEM: Record<string, string> = {
  CADASTRO: "Cadastro",
  EQUIPE_GORJETA: "Equipe da gorjeta",
  CONFERENCIA_GORJETA: "Conferência da gorjeta",
  IMPORTADOR_PLANILHA: "Importação da planilha",
  BACKFILL: "Reconstruído da auditoria",
};

export const ehDinheiro = (l: Pick<EmployeeHistoricoLinha, "campo">) => l.campo === "baseSalary" || l.campo === "salarioCombinado";

/** Texto de um valor que não é dinheiro (dinheiro vai pelo <Money>, que respeita "ocultar valores"). */
export function textoDoValor(campo: EmployeeHistoricoLinha["campo"], v: string | null): string {
  if (v == null || v === "") return "vazio";
  if (campo === "modality") return v === "NAO_CLT" ? "Sem registro" : "CLT";
  if (campo === "recebeAdiantamento") return v === "true" ? "Recebe adiantamento" : "Só no pagamento";
  return v;
}

/** dd/mm/aaaa de AAAA-MM-DD, sem passar por Date (o fuso puxaria para o dia anterior). */
export const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function momentoBr(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
