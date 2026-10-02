import type { ScheduleDayType, ScheduleEmployee } from "../../api/client";

// Catálogo das marcas e utilitários da Escala, compartilhados pela escala normal e
// pela seção "Fora da escala — só ocorrências".

export const DOW_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];

// Paleta única da escala — MESMAS cores na tela e no mural impresso.
export const COLORS = {
  folga: "#1f2937",     // escuro
  // FF e FBH vivem na MESMA família da folga de propósito: no mural as três
  // significam a mesma coisa — essa pessoa não trabalha hoje. Cor nova só para
  // elas aumentaria o que precisa ser decorado sem ganho de leitura; a distinção
  // fica nas letras, que quem precisa do detalhe lê de perto.
  folgaFeriado: "#334155",  // cinza um tom acima
  folgaBanco: "#475569",    // cinza dois tons acima
  falta: "#b91c1c",     // vermelho forte — X de falta (longe do salmao do domingo)
  atestado: "#7c3aed",  // violeta — AT de atestado (nao confunde com ferias azul)
  turno: "#ea580c",     // laranja vibrante (distinto da folga)
  // UMA cor por evento — a MESMA no cabeçalho da data e na coluna inteira,
  // igual domingo/feriado. Dois tons para o mesmo evento gerava dupla leitura.
  // Intensidade média/clara: pinta a coluna sem sufocar as marcas F/T.
  eventoPequeno: "#2dd4bf", // teal
  eventoMedio: "#fbbf24",   // âmbar
  eventoGrande: "#e879f9",  // magenta (longe do salmão do domingo)
  ferias: "#2563eb",    // azul
  // Afastamento não remunerado: marrom/âmbar escuro — fora do trabalho como férias, mas
  // sem nada a ver com descanso pago; longe do azul das férias e do violeta do atestado.
  afastamento: "#92400e",
  domingo: "#ff8a8a",   // vermelho/rosa
  feriado: "#8fd14f",   // verde
};

export type Marca<T extends ScheduleDayType = ScheduleDayType> = {
  tipo: T;
  letra: string;
  nome: string;
  cor: string;
  /** Sai na escala impressa do mural? Falta e atestado NÃO saem. */
  noMural: boolean;
  /** Texto do title na célula. */
  ajuda: string;
};

// Catálogo das marcas da célula. Fonte ÚNICA para a paleta, a legenda, o
// desenho da célula e a impressão — antes cada um desses lugares repetia a
// própria lista, e bastava esquecer um para a marca sumir de algum canto.
export type MarcaCelula = "FOLGA" | "FOLGA_FERIADO" | "FOLGA_BANCO_HORAS" | "TURNO" | "FALTA" | "ATESTADO" | "AFASTAMENTO";
export const MARCAS: Array<Marca<MarcaCelula>> = [
  { tipo: "FOLGA", letra: "F", nome: "Folga", cor: COLORS.folga, noMural: true, ajuda: "Folga" },
  { tipo: "FOLGA_FERIADO", letra: "FF", nome: "Folga de feriado", cor: COLORS.folgaFeriado, noMural: true, ajuda: "Folga de feriado — debita o saldo de feriado trabalhado" },
  { tipo: "FOLGA_BANCO_HORAS", letra: "FBH", nome: "Folga banco de horas", cor: COLORS.folgaBanco, noMural: true, ajuda: "Folga do banco de horas" },
  { tipo: "TURNO", letra: "T", nome: "Turno / cobertura", cor: COLORS.turno, noMural: true, ajuda: "Turno estendido (cobertura)" },
  { tipo: "FALTA", letra: "X", nome: "Falta", cor: COLORS.falta, noMural: false, ajuda: "Falta — desconta no próximo VT" },
  { tipo: "ATESTADO", letra: "AT", nome: "Atestado", cor: COLORS.atestado, noMural: false, ajuda: "Atestado médico — desconta no próximo VT" },
  // Sai no mural: a equipe precisa saber que a pessoa não vem (o motivo nunca sai).
  {
    tipo: "AFASTAMENTO", letra: "AF", nome: "Afastamento não remunerado", cor: COLORS.afastamento, noMural: true,
    ajuda: "Afastamento não remunerado — sem salário nem VT; na gorjeta segue a regra do fechamento. Lança, edita e exclui em Folha → Lançar afastamento",
  },
];
export const MARCA_POR_TIPO = new Map(MARCAS.map((m) => [m.tipo, m]));

// Quem está fora da escala só recebe ocorrências: sem turno, e com férias marcáveis
// aqui (na escala normal as férias vêm da Folha). Mesmas cores e letras da escala.
export type MarcaOcorrencia = "FOLGA" | "FOLGA_FERIADO" | "FOLGA_BANCO_HORAS" | "FALTA" | "ATESTADO" | "AFASTAMENTO" | "FERIAS";
export const MARCAS_OCORRENCIA: Array<Marca<MarcaOcorrencia>> = [
  ...MARCAS.filter((m): m is Marca<Exclude<MarcaCelula, "TURNO">> => m.tipo !== "TURNO"),
  { tipo: "FERIAS", letra: "Fér", nome: "Férias", cor: COLORS.ferias, noMural: false, ajuda: "Férias — contam na gorjeta; o VT de férias continua vindo da Folha" },
];
export const TIPOS_OCORRENCIA = new Set<ScheduleDayType>(MARCAS_OCORRENCIA.map((m) => m.tipo));

// Afastamento não remunerado só nasce, muda e sai pela Folha (intervalo, motivo, trava de período
// e auditoria): na escala ele aparece, mas não vai para o pincel nem se edita na célula.
const SO_PELA_FOLHA = new Set<ScheduleDayType>(["AFASTAMENTO"]);
export function editavelNaEscala(tipo: ScheduleDayType | undefined): boolean {
  return tipo == null || !SO_PELA_FOLHA.has(tipo);
}
export const MARCAS_PINCEL = MARCAS.filter((m) => editavelNaEscala(m.tipo));
export const MARCAS_OCORRENCIA_PINCEL = MARCAS_OCORRENCIA.filter((m) => editavelNaEscala(m.tipo));

// Marca de dia em que a pessoa não trabalha (folgas, falta, atestado, férias, afastamento).
const NAO_TRABALHADOS = new Set<ScheduleDayType>(["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS", "FALTA", "ATESTADO", "FERIAS", "AFASTAMENTO"]);
export function ehDiaNaoTrabalhado(tipo: ScheduleDayType | undefined): boolean {
  return tipo != null && NAO_TRABALHADOS.has(tipo);
}

export function keyOf(employeeId: string, day: number) {
  return `${employeeId}|${day}`;
}
export function fullName(e: { firstName: string; lastName: string; displayName?: string | null }) {
  return e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();
}
export function dateMs(year: number, month: number, day: number) {
  return Date.UTC(year, month - 1, day);
}
export function withinEmployment(e: ScheduleEmployee, year: number, month: number, day: number) {
  const t = dateMs(year, month, day);
  if (e.admissionDate) {
    const a = new Date(e.admissionDate).getTime();
    if (!isNaN(a) && t < a) return false;
  }
  if (e.terminationDate) {
    const term = new Date(e.terminationDate).getTime();
    if (!isNaN(term) && t > term) return false;
  }
  return true;
}
export function dataCurta(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Próxima marca da célula "só ocorrência". Com pincel, aplica (ou limpa se já é a
// mesma); sem pincel, cicla — → F → X → AT → —, o equivalente ao F → T da escala sem o turno.
export function proximaOcorrencia(atual: ScheduleDayType | undefined, pincel: MarcaOcorrencia | null): ScheduleDayType | null {
  if (pincel) return atual === pincel ? null : pincel;
  if (!atual) return "FOLGA";
  if (atual === "FOLGA") return "FALTA";
  if (atual === "FALTA") return "ATESTADO";
  return null;
}
