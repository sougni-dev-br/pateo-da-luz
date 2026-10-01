// Travas contra pagar duas vezes a mesma coisa na folha.
//
// "O mesmo pagamento" = mesma pessoa + mesmo tipo + mesma competência. No VT (e nas
// férias) entra também o início do período: as duas quinzenas do mês são vales
// diferentes. A chave única do banco inclui o rótulo (periodLabel), então ela não
// pega o salário gerado ("Salário") e o do extrato ("Extrato 09/2026") da mesma
// pessoa no mesmo mês — é esse buraco que estas funções fecham.
//
// Liberados de propósito: as parcelas da MESMA rescisão (grupoRescisao) e o lançamento
// marcado como complemento (details.complemento, com motivo e autor).

export const MOTIVO_MINIMO = 10;

export type ItemFolha = {
  id?: string;
  employeeId: string;
  type: string;
  competenceYear: number;
  competenceMonth: number;
  periodStart?: Date | string | null;
  periodLabel?: string | null;
  details?: unknown;
  status?: string | null;
  deletedAt?: Date | string | null;
  paymentDate?: Date | string | null;
  paidAmount?: unknown;
  amount?: unknown;
  dueDate?: Date | string | null;
};

// Tipos em que o início do período distingue um pagamento do outro.
const TIPOS_POR_PERIODO = new Set(["VALE_TRANSPORTE", "FERIAS"]);
// Tipos que não podem ter período começando depois da saída da pessoa.
const TIPOS_ATE_A_SAIDA = new Set(["SALARIO", "ADIANTAMENTO", "VALE_TRANSPORTE"]);

export function diaIso(d: Date | string | null | undefined): string | null {
  if (d == null || d === "") return null;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const data = d instanceof Date ? d : new Date(d);
  return Number.isNaN(data.getTime()) ? null : data.toISOString().slice(0, 10);
}

export function itemVivo(i: ItemFolha): boolean {
  return i.deletedAt == null && i.status !== "CANCELED";
}

function detalhes(details: unknown): Record<string, unknown> {
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
}

export function grupoRescisao(details: unknown): string | null {
  const g = detalhes(details).grupoRescisao;
  return typeof g === "string" && g ? g : null;
}

export function ehComplemento(details: unknown): boolean {
  return detalhes(details).complemento != null;
}

export function mesmoPagamento(a: ItemFolha, b: ItemFolha): boolean {
  if (a.id && b.id && a.id === b.id) return false;
  if (a.employeeId !== b.employeeId || a.type !== b.type) return false;
  if (a.competenceYear !== b.competenceYear || a.competenceMonth !== b.competenceMonth) return false;
  if (a.type === "RESCISAO") {
    const ga = grupoRescisao(a.details);
    return !(ga && ga === grupoRescisao(b.details));
  }
  if (TIPOS_POR_PERIODO.has(a.type)) {
    const pa = diaIso(a.periodStart);
    const pb = diaIso(b.periodStart);
    // Sem o início de um dos dois não dá para saber a quinzena: conta como o mesmo.
    return pa && pb ? pa === pb : true;
  }
  return true;
}

// Os existentes (vivos) que seriam o mesmo pagamento que o novo.
export function duplicadosDe(novo: ItemFolha, existentes: ItemFolha[]): ItemFolha[] {
  return existentes.filter((e) => itemVivo(e) && mesmoPagamento(novo, e));
}

// Na baixa: os OUTROS itens do mesmo pagamento que já foram pagos. Complemento (de
// qualquer lado) não acusa — ele existe justamente para pagar a mais.
export function pagamentosEmDuplicidade(item: ItemFolha, outros: ItemFolha[]): ItemFolha[] {
  if (ehComplemento(item.details)) return [];
  return outros.filter((o) => itemVivo(o) && o.paymentDate != null && !ehComplemento(o.details) && mesmoPagamento(item, o));
}

export type SuspeitoDoLote = { item: ItemFolha; jaPagos: ItemFolha[]; noLote: ItemFolha[] };

// Baixa em lote: cada item que já tem o mesmo pagamento pago, ou que repete outro
// item do PRÓPRIO lote (os dois iriam ser pagos agora).
export function suspeitosDoLote(lote: ItemFolha[], pagos: ItemFolha[]): SuspeitoDoLote[] {
  const suspeitos: SuspeitoDoLote[] = [];
  for (const item of lote) {
    const jaPagos = pagamentosEmDuplicidade(item, pagos);
    const noLote = ehComplemento(item.details)
      ? []
      : lote.filter((o) => o !== item && !ehComplemento(o.details) && mesmoPagamento(item, o));
    if (jaPagos.length > 0 || noLote.length > 0) suspeitos.push({ item, jaPagos, noLote });
  }
  return suspeitos;
}

// Primeiro dia do período que o item paga: o início do VT (ou o 1º dia da
// competência, se não tiver); salário e adiantamento valem a competência inteira.
export function inicioDoPeriodo(item: ItemFolha): string {
  const doMes = `${item.competenceYear}-${String(item.competenceMonth).padStart(2, "0")}-01`;
  if (item.type === "VALE_TRANSPORTE") return diaIso(item.periodStart) ?? doMes;
  return doMes;
}

// Salário, adiantamento ou VT cujo período começa depois do dia da saída. O mês da
// saída (e a quinzena que a contém) continua liberado; rescisão e férias, sempre.
export function aposSaida(item: ItemFolha, terminationDate: Date | string | null | undefined): boolean {
  if (!TIPOS_ATE_A_SAIDA.has(item.type)) return false;
  const saida = diaIso(terminationDate);
  if (!saida) return false;
  return inicioDoPeriodo(item) > saida;
}

// A chave única do banco inclui o rótulo e NÃO inclui deletedAt: o rótulo novo não pode
// repetir nenhum já usado na competência, nem de item excluído. "Salário" → "Salário (2)".
export function rotuloLivre(base: string, ocupados: Iterable<string>): string {
  const usados = new Set(ocupados);
  if (!usados.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidato = `${base} (${n})`;
    if (!usados.has(candidato)) return candidato;
  }
}

export function motivoValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= MOTIVO_MINIMO ? t.slice(0, 1000) : null;
}

const ROTULOS: Record<string, string> = {
  SALARIO: "Salário", ADIANTAMENTO: "Adiantamento", VALE_TRANSPORTE: "Vale-transporte", RESCISAO: "Rescisão", FERIAS: "Férias",
};
export const rotuloTipo = (type: string) => ROTULOS[type] ?? type;
export const competenciaDe = (i: { competenceYear: number; competenceMonth: number }) =>
  `${String(i.competenceMonth).padStart(2, "0")}/${i.competenceYear}`;

export function resumoItem(i: ItemFolha) {
  const valor = Number(i.amount ?? 0);
  return {
    id: i.id ?? null,
    tipo: i.type,
    tipoRotulo: rotuloTipo(i.type),
    rotulo: i.periodLabel ?? null,
    competencia: competenciaDe(i),
    inicioPeriodo: diaIso(i.periodStart),
    valor: Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0,
    valorPago: i.paidAmount == null ? null : Number(i.paidAmount),
    status: i.paymentDate ? "PAID" : (i.status ?? "PENDING"),
    vencimento: diaIso(i.dueDate),
    pagoEm: diaIso(i.paymentDate),
  };
}
export type ResumoItemFolha = ReturnType<typeof resumoItem>;
