// Histórico do cadastro de funcionários: o que conta como mudança na ficha e como
// cada valor aparece na lista.
import type { EmployeeHistoricoLinha, EmployeeModality } from "../../api/client";

/** Os campos da ficha que têm histórico (a empresa muda na Equipe da gorjeta, não aqui). */
export type CamposComHistorico = {
  baseSalary: string;
  salarioCombinado: string;
  /** Teto do IR para a gorjeta informada (só CLT). Ausente = vazio. */
  tetoIrGorjeta?: string;
  modality: EmployeeModality;
  position: string;
  recebeAdiantamento: boolean;
  /** Ausente = não recebe por quinzena. */
  pagamentoQuinzenal?: boolean;
  /** Entra na gorjeta em (AAAA-MM-DD). Ausente ou "" = vazio (em teste). */
  inicioGorjeta?: string;
};

// "2.200,00" e "2200" são o mesmo salário: compara o número, não o texto da máscara.
function dinheiro(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Mudou salário, combinado, vínculo, cargo ou forma de pagamento: a ficha pede "vale a partir de". */
export function mudouCampoComHistorico(original: CamposComHistorico | null, atual: CamposComHistorico): boolean {
  if (!original) return false;
  return dinheiro(original.baseSalary) !== dinheiro(atual.baseSalary)
    // O combinado só vai ao backend para CLT; para quem não é, fica como está.
    || (atual.modality === "CLT" && dinheiro(original.salarioCombinado) !== dinheiro(atual.salarioCombinado))
    || (atual.modality === "CLT" && dinheiro(original.tetoIrGorjeta ?? "") !== dinheiro(atual.tetoIrGorjeta ?? ""))
    || original.modality !== atual.modality
    || original.position.trim() !== atual.position.trim()
    || original.recebeAdiantamento !== atual.recebeAdiantamento
    || (original.pagamentoQuinzenal ?? false) !== (atual.pagamentoQuinzenal ?? false)
    || (original.inicioGorjeta ?? "") !== (atual.inicioGorjeta ?? "");
}

/**
 * A entrada na gorjeta mudou e a data mais antiga (a de antes ou a nova) é de um mês
 * anterior ao atual: muda gorjetas já calculadas, o backend exige motivo.
 */
function entradaGorjetaRetroativa(original: CamposComHistorico, atual: CamposComHistorico, hojeIso: string): boolean {
  const antes = original.inicioGorjeta ?? "";
  const depois = atual.inicioGorjeta ?? "";
  if (antes === depois) return false;
  const datas = [antes, depois].filter((d) => /^\d{4}-\d{2}/.test(d)).sort();
  return datas.length > 0 && datas[0].slice(0, 7) < hojeIso.slice(0, 7);
}

/**
 * Data "vale a partir de" num mês anterior ao atual e mudou salário base, combinado ou
 * vínculo: o backend recusa sem motivo (muda cálculos de meses passados). A tela só
 * antecipa a regra. Cargo e adiantamento não entram — não mexem em valor fechado.
 */
export function motivoObrigatorio(
  original: CamposComHistorico | null, atual: CamposComHistorico, vigenteDesde: string, hojeIso: string,
): boolean {
  if (!original) return false;
  if (entradaGorjetaRetroativa(original, atual, hojeIso)) return true;
  if (!/^\d{4}-\d{2}/.test(vigenteDesde)) return false;
  if (vigenteDesde.slice(0, 7) >= hojeIso.slice(0, 7)) return false;
  return dinheiro(original.baseSalary) !== dinheiro(atual.baseSalary)
    || (atual.modality === "CLT" && dinheiro(original.salarioCombinado) !== dinheiro(atual.salarioCombinado))
    || (atual.modality === "CLT" && dinheiro(original.tetoIrGorjeta ?? "") !== dinheiro(atual.tetoIrGorjeta ?? ""))
    || original.modality !== atual.modality;
}

export const ROTULO_ORIGEM: Record<string, string> = {
  CADASTRO: "Cadastro",
  EQUIPE_GORJETA: "Equipe da gorjeta",
  CONFERENCIA_GORJETA: "Conferência da gorjeta",
  IMPORTADOR_PLANILHA: "Importação da planilha",
  BACKFILL: "Reconstruído da auditoria",
};

export const ehDinheiro = (l: Pick<EmployeeHistoricoLinha, "campo">) => l.campo === "baseSalary" || l.campo === "salarioCombinado" || l.campo === "tetoIrGorjeta";

/** Texto de um valor que não é dinheiro (dinheiro vai pelo <Money>, que respeita "ocultar valores"). */
export function textoDoValor(campo: EmployeeHistoricoLinha["campo"], v: string | null): string {
  if (v == null || v === "") return "vazio";
  if (campo === "modality") return v === "NAO_CLT" ? "Sem registro" : "CLT";
  if (campo === "recebeAdiantamento") return v === "true" ? "Recebe adiantamento" : "Só no pagamento";
  if (campo === "pagamentoQuinzenal") return v === "true" ? "Recebe por quinzena" : "Não recebe por quinzena";
  if (campo === "inicioGorjeta") return /^\d{4}-\d{2}-\d{2}/.test(v) ? diaBr(v) : v;
  return v;
}

/** dd/mm/aaaa de AAAA-MM-DD, sem passar por Date (o fuso puxaria para o dia anterior). */
export const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function momentoBr(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
