import type { ListaFerias, NivelFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias, SituacaoFerias } from "../../../api/client";
import type { StatusTone } from "../../../design-system";

export type FiltroFerias = "PENDENTES" | "PROGRAMADAS" | "EM_AQUISICAO" | "GOZADAS" | "TODAS";

export type LinhaFerias = { pessoa: PessoaFerias; periodo: PeriodoFerias };

export const FILTROS: Array<{ id: FiltroFerias; rotulo: string; tom: "danger" | "warning" | "info" | "success" | "neutral" }> = [
  { id: "PENDENTES", rotulo: "A programar", tom: "warning" },
  { id: "PROGRAMADAS", rotulo: "Programadas", tom: "info" },
  { id: "EM_AQUISICAO", rotulo: "Em aquisição", tom: "neutral" },
  { id: "GOZADAS", rotulo: "Já gozadas", tom: "success" },
  { id: "TODAS", rotulo: "Todas", tom: "neutral" },
];

const PRECISA_PROGRAMAR: SituacaoFerias[] = ["VENCIDA", "A_VENCER", "DISPONIVEL"];

/**
 * "A programar" inclui o período já programado depois do prazo: o alerta do Dashboard o conta
 * como vencido e o link tem de levar a uma lista onde ele aparece.
 */
export function pertenceAoFiltro(p: Pick<PeriodoFerias, "situacao" | "foraDoPrazo">, filtro: FiltroFerias): boolean {
  if (filtro === "TODAS") return true;
  if (filtro === "PENDENTES") return PRECISA_PROGRAMAR.includes(p.situacao) || (p.foraDoPrazo && p.situacao !== "EM_AQUISICAO");
  if (filtro === "PROGRAMADAS") return p.situacao === "PROGRAMADA";
  if (filtro === "EM_AQUISICAO") return p.situacao === "EM_AQUISICAO";
  return p.situacao === "GOZADA";
}

const PESO_NIVEL: Record<NivelFerias, number> = { perigo: 0, atencao: 1, ok: 2 };

/** Um período por linha; os mais urgentes primeiro, depois pelo limite para gozo. */
export function linhasDaLista(lista: ListaFerias): LinhaFerias[] {
  return lista.pessoas
    .flatMap((pessoa) => pessoa.periodos.map((periodo) => ({ pessoa, periodo })))
    .sort((a, b) =>
      PESO_NIVEL[a.periodo.nivel] - PESO_NIVEL[b.periodo.nivel]
      || a.periodo.limiteInicioGozo.localeCompare(b.periodo.limiteInicioGozo)
      || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));
}

export function contarPorFiltro(linhas: LinhaFerias[]): Record<FiltroFerias, number> {
  return Object.fromEntries(FILTROS.map((f) => [f.id, linhas.filter((l) => pertenceAoFiltro(l.periodo, f.id)).length])) as Record<FiltroFerias, number>;
}

export const dataBr = (iso: string | null): string => (iso ? iso.split("-").reverse().join("/") : "—");
export const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);
const dias = (n: number) => `${n} ${plural(n, "dia", "dias")}`;

/** Texto do prazo: quanto falta (ou há quanto venceu) para o último dia de começar as férias. */
export function textoPrazo(p: PeriodoFerias): string {
  if (p.situacao === "EM_AQUISICAO") return p.diasParaCompletar === null ? "" : `direito em ${dias(p.diasParaCompletar)}`;
  if (p.diasParaLimite === null) return "";
  if (p.diasParaLimite < 0) return `venceu há ${dias(-p.diasParaLimite)}`;
  if (p.diasParaLimite === 0) return "vence hoje";
  return `faltam ${dias(p.diasParaLimite)}`;
}

export const ROTULO_SITUACAO: Record<SituacaoFerias, string> = {
  EM_AQUISICAO: "Em aquisição",
  DISPONIVEL: "No prazo",
  A_VENCER: "A vencer",
  VENCIDA: "Vencida",
  PROGRAMADA: "Programada",
  GOZADA: "Gozada",
};

export function tomDaSituacao(p: PeriodoFerias): StatusTone {
  if (p.nivel === "perigo") return "danger";
  if (p.nivel === "atencao") return "warning";
  if (p.situacao === "PROGRAMADA") return "info";
  if (p.situacao === "GOZADA") return "success";
  return "neutral";
}

export function rotuloDaSituacao(p: PeriodoFerias): string {
  if (p.foraDoPrazo && p.situacao !== "EM_AQUISICAO") return "Fora do prazo";
  return ROTULO_SITUACAO[p.situacao];
}

export function resumoProgramacao(g: ProgramacaoFerias): string {
  const datas = g.gozoInicio ? `${dataBr(g.gozoInicio)} a ${dataBr(g.gozoFim)}` : "sem data";
  const abono = g.diasAbono > 0 ? ` + abono de ${g.diasAbono}` : "";
  return `${datas} · ${dias(g.dias)}${abono}`;
}

const DIA_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Soma dias a uma data "AAAA-MM-DD" (UTC, sem fuso). */
export function somaDias(dia: string, n: number): string {
  return iso(Date.parse(`${dia}T00:00:00.000Z`) + n * DIA_MS);
}

/** Último dia de gozo e dia de volta ao trabalho, para a prévia do formulário. */
export function fimEVolta(inicio: string, qtd: number): { fim: string; volta: string } | null {
  const t = Date.parse(`${inicio}T00:00:00.000Z`);
  if (Number.isNaN(t) || !Number.isInteger(qtd) || qtd < 1) return null;
  return { fim: iso(t + (qtd - 1) * DIA_MS), volta: iso(t + qtd * DIA_MS) };
}

/** Último dia para começar `qtd` dias de férias sem passar do fim do concessivo. */
export const ultimoDiaParaComecar = (fimConcessivo: string, qtd: number): string => somaDias(fimConcessivo, -(Math.max(qtd, 1) - 1));
