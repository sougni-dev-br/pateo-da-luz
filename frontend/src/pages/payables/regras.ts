// Regras puras da tela de Contas a Pagar: classificação de títulos, datas,
// parcelas e o agrupamento por vencimento usado na lista.
import type { Payable } from "../../api/client";
import type { StatusTone } from "../../design-system";

export const statusLabels: Record<string, string> = {
  OPEN: "Em aberto",
  PAID: "Pago",
  PAID_LATE: "Pago c/ atraso",
  OVERDUE: "Vencido",
  CANCELLED: "Cancelado"
};

export const statusTones: Record<string, StatusTone> = {
  OPEN: "warning",
  PAID: "success",
  PAID_LATE: "warning",
  OVERDUE: "danger",
  CANCELLED: "neutral"
};

export function isTaxPayment(p: Payable): boolean {
  return p.sourceType === "TAX_PAYMENT";
}

export function isPayroll(p: Payable): boolean {
  return p.sourceType === "PAYROLL";
}

// Diárias de extras: mesmo fluxo de baixa da folha, rotas próprias.
export function isExtra(p: Payable): boolean {
  return p.sourceType === "EXTRA";
}

// Título do lote de pagamento da folha: um por empresa, agrupando os salários da competência.
// A baixa é uma só (rota própria) e baixa cada pessoa dentro dele.
export function isFolhaLote(p: Payable): boolean {
  return p.sourceType === "FOLHA_LOTE";
}

/** Folha à parte: quem foi retirado do título da empresa (o "devolver" vale só aqui). */
export function ehFolhaAParte(p: Payable): boolean {
  return isFolhaLote(p) && p.folhaLoteGrupo === "A_PARTE";
}

// Títulos "simples" (imposto e folha): baixa com data + valor, sem forma de
// pagamento / empresa / diferença. A query de payables preenche os campos tax*
// para folha (tipo, funcionário, competência), então a UI é reaproveitada.
export function isSimpleLedger(p: Payable): boolean {
  return isTaxPayment(p) || isPayroll(p) || isExtra(p) || isFolhaLote(p);
}

export function estaEmAberto(p: Payable): boolean {
  return p.status === "OPEN" || p.status === "OVERDUE";
}

export function estaPago(p: Payable): boolean {
  return p.status === "PAID" || p.status === "PAID_LATE";
}

// Rótulos que a query de payables grava em taxDocumentType para a Folha.
// "1ª quinzena" e "Salário (acerto)": do sem registro (dia 15 e lista de pagamento da gorjeta).
export const TIPOS_FOLHA = ["Vale-transporte", "Adiantamento", "1ª quinzena", "Salário", "Salário (acerto)", "Rescisão", "Férias"] as const;

/** Sub-tipo "PAYROLL:Vale-transporte" filtra só aquele tipo dentro da Folha. */
export function combinaSubtipo(p: Payable, subtipo: string): boolean {
  // "Folha (tudo)": os lançamentos soltos e os títulos da folha liberada.
  if (subtipo === "PAYROLL") return p.sourceType === "PAYROLL" || p.sourceType === "FOLHA_LOTE";
  const [sourceType, tipoFolha] = subtipo.split(":");
  if (p.sourceType !== sourceType) return false;
  return !tipoFolha || p.taxDocumentType === tipoFolha;
}

export function dateKey(value?: string | null): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function chaveDeData(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayKey(): string {
  return chaveDeData(new Date());
}

export function addDaysKey(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return chaveDeData(date);
}

// Data de baixa sugerida: o vencimento quando ja passou, hoje quando ainda esta por vir.
// Chaves no formato YYYY-MM-DD comparam corretamente como string.
export function minDateKey(dueKey: string, todayK: string): string {
  if (!dueKey) return todayK;
  return dueKey < todayK ? dueKey : todayK;
}

export function basePaymentName(name: string): string {
  // "BOLETO 2X" e "DINHEIRO / 1x" viram a forma base.
  return name.trim().replace(/\s*(\/\s*)?\d+[Xx]$/, "").toUpperCase().trim();
}

/**
 * Forma prevista do título como valor do select de baixa ("id:<forma>"), ou "" quando não casa.
 * Casa primeiro pelo id da forma de origem e, se não achar, pelo nome; as formas parceladas
 * ("BOLETO 2X") viram a forma base ("BOLETO"), que é a que o select oferece.
 * Folha, extras e lote da folha não guardam forma: a prevista é PIX, como é paga a folha.
 */
const FORMA_DA_FOLHA = "PIX";

export function formaPrevistaDoTitulo(
  p: Payable,
  metodos: Array<{ id: string; name: string }>,
  formas: Array<{ id: string; label: string }>
): string {
  const daBase = (nome: string) => formas.find((o) => o.label === basePaymentName(nome));
  const origem = p.paymentMethodId ? metodos.find((m) => m.id === p.paymentMethodId) : undefined;
  const pessoal = isPayroll(p) || isExtra(p) || isFolhaLote(p);
  const forma = (origem && daBase(origem.name)) || (p.paymentMethodName ? daBase(p.paymentMethodName) : undefined)
    || (pessoal ? daBase(FORMA_DA_FOLHA) : undefined);
  return forma ? `id:${forma.id}` : "";
}

/** Forma da baixa de cada título no lote: a prevista do título (quando pedida e conhecida) ou a forma única. */
export function formaDaBaixaNoLote(usarFormaDoTitulo: boolean, prevista: string, formaUnica: string): string {
  return usarFormaDoTitulo && prevista ? prevista : formaUnica;
}

/** Empresa pagadora de cada título no lote: a do lançamento (quando pedida e conhecida) ou a empresa única. */
export function empresaDaBaixaNoLote(usarEmpresaDoTitulo: boolean, empresaDoTitulo: string | null | undefined, empresaUnica: string): string {
  return usarEmpresaDoTitulo && empresaDoTitulo ? empresaDoTitulo : empresaUnica;
}

/** Valor do select de forma ("id:..." ou "name:...") no formato que a API de baixa espera. */
export function payloadDaForma(valor: string): { paidPaymentMethodId: string | null; paidPaymentMethodName: string | null } {
  if (valor.startsWith("id:")) return { paidPaymentMethodId: valor.replace("id:", ""), paidPaymentMethodName: null };
  return { paidPaymentMethodId: null, paidPaymentMethodName: valor.replace("name:", "") };
}

export function inferTotalInstallments(methodName: string | null): number {
  if (!methodName) return 1;
  // Matches "BOLETO 2X", "BOLETO / 2x", "PIX / 1x" etc.
  const m = methodName.match(/[/ ]+(\d+)[Xx]$/);
  return m ? parseInt(m[1], 10) : 1;
}

export function formatInstallment(num: number | null, total?: number | null, methodName?: string | null): string {
  if (num == null) return "";
  const inferred = inferTotalInstallments(methodName ?? null);
  const t = Math.max(total ?? inferred, num); // denominator always >= numerator
  return `${num}/${t}`;
}

/** Diferença em dias entre duas chaves YYYY-MM-DD (b - a), sem fuso. */
export function diasEntre(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Prazo em palavras para um título em aberto: "venceu há 3 dias", "vence hoje", "em 5 dias". */
export function rotuloPrazo(dueKey: string, hoje: string): string {
  if (!dueKey) return "sem vencimento";
  const dias = diasEntre(hoje, dueKey);
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  if (dias === -1) return "venceu ontem";
  if (dias < 0) return `venceu há ${-dias} dias`;
  return `em ${dias} dias`;
}

export type GrupoVencimento =
  | "vencidos"
  | "hoje"
  | "proximos7"
  | "depois"
  | "semVencimento"
  | "pagos"
  | "cancelados";

export const ROTULO_GRUPO: Record<GrupoVencimento, string> = {
  vencidos: "Vencidos",
  hoje: "Vencem hoje",
  proximos7: "Próximos 7 dias",
  depois: "Mais adiante",
  semVencimento: "Sem vencimento",
  pagos: "Baixados",
  cancelados: "Cancelados"
};

const ORDEM_GRUPOS: GrupoVencimento[] = ["vencidos", "hoje", "proximos7", "depois", "semVencimento", "pagos", "cancelados"];

const DIAS_PROXIMOS = 7;

export function grupoDoTitulo(p: Payable, hoje: string): GrupoVencimento {
  if (estaPago(p)) return "pagos";
  if (p.status === "CANCELLED") return "cancelados";
  const due = dateKey(p.dueDate);
  if (!due) return "semVencimento";
  const dias = diasEntre(hoje, due);
  if (dias < 0) return "vencidos";
  if (dias === 0) return "hoje";
  if (dias <= DIAS_PROXIMOS) return "proximos7";
  return "depois";
}

export type GrupoDeTitulos = {
  chave: GrupoVencimento;
  rotulo: string;
  titulos: Payable[];
  total: number;
};

export function valorDoTitulo(p: Payable): number {
  const n = Number(p.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function somarValores(rows: Payable[]): number {
  return Number(rows.reduce((s, p) => s + valorDoTitulo(p), 0).toFixed(2));
}

function compararPorVencimento(a: Payable, b: Payable): number {
  const da = dateKey(a.dueDate);
  const db = dateKey(b.dueDate);
  if (da !== db) return da < db ? -1 : 1;
  return (a.supplierName ?? "").localeCompare(b.supplierName ?? "", "pt-BR");
}

// Baixados: o pagamento mais recente primeiro.
function compararPorPagamento(a: Payable, b: Payable): number {
  const pa = dateKey(a.paidDate);
  const pb = dateKey(b.paidDate);
  if (pa !== pb) return pa > pb ? -1 : 1;
  return compararPorVencimento(a, b);
}

/** Agrupa e ordena os títulos já filtrados. Grupos vazios não aparecem. */
export function agruparPorVencimento(rows: Payable[], hoje: string): GrupoDeTitulos[] {
  const mapa = new Map<GrupoVencimento, Payable[]>();
  for (const p of rows) {
    const chave = grupoDoTitulo(p, hoje);
    mapa.set(chave, [...(mapa.get(chave) ?? []), p]);
  }
  return ORDEM_GRUPOS
    .filter((chave) => mapa.has(chave))
    .map((chave) => {
      const titulos = [...(mapa.get(chave) ?? [])].sort(chave === "pagos" ? compararPorPagamento : compararPorVencimento);
      return { chave, rotulo: ROTULO_GRUPO[chave], titulos, total: somarValores(titulos) };
    });
}

export type Selo = { rotulo: string; tom: "imposto" | "folha" | "extra" | "fatura" | "legado" | "ciclo" };

/** Selo do tipo de título; título comum de compra não leva selo. */
export function seloDoTitulo(p: Payable): Selo | null {
  switch (p.sourceType) {
    case "TAX_PAYMENT": return { rotulo: "Imposto", tom: "imposto" };
    case "PAYROLL": return { rotulo: p.taxDocumentType ? `Folha · ${p.taxDocumentType}` : "Folha", tom: "folha" };
    case "EXTRA": return { rotulo: "Extra", tom: "extra" };
    case "FOLHA_LOTE": return { rotulo: "Folha · lote", tom: "folha" };
    case "CARD_STATEMENT": return { rotulo: "Fatura cartão", tom: "fatura" };
    case "LEGACY_CREDIT_CARD": return { rotulo: "Cartão legado", tom: "legado" };
    case "SUPPLIER_CYCLE": return { rotulo: "Ciclo fornecedor", tom: "ciclo" };
    default: return null;
  }
}

/** Quem recebe: no imposto o nome é o tipo da guia; nos demais, o fornecedor/funcionário. */
export function favorecidoDoTitulo(p: Payable): string {
  if (isTaxPayment(p)) return p.taxDocumentType ?? p.supplierName;
  return p.supplierName;
}

/** Linha de apoio sob o nome: documento, parcela e forma de pagamento. */
export function detalhesDoTitulo(p: Payable): string[] {
  if (isTaxPayment(p)) {
    return [
      p.taxCompanyName ?? "",
      p.taxDescription ?? "",
      p.taxCompetenceDate ? `Comp. ${competencia(p.taxCompetenceDate)}` : ""
    ].filter(Boolean);
  }
  if (isPayroll(p) || isExtra(p) || isFolhaLote(p)) {
    return [
      p.taxDescription ?? "",
      p.taxCompetenceDate ? `Comp. ${competencia(p.taxCompetenceDate)}` : ""
    ].filter(Boolean);
  }
  const partes: string[] = [];
  if (p.invoiceNumber) partes.push(`NF ${p.invoiceNumber}`);
  if (p.purchaseNumber) partes.push(`Ped. ${p.purchaseNumber}`);
  if (p.installment != null) partes.push(`Parc. ${formatInstallment(p.installment, p.totalInstallments, p.paymentMethodName)}`);
  if (p.paymentMethodName) partes.push(p.paymentMethodName);
  if (!p.invoiceNumber) partes.unshift("Sem NF");
  return partes;
}

function competencia(value: string): string {
  const k = dateKey(value);
  return k ? `${k.slice(5, 7)}/${k.slice(0, 4)}` : "";
}

export type FiltrosPagar = {
  filter: string;
  supplierId: string;
  paymentMethodId: string;
  status: string;
  sourceType: string;
  origin: string;
  noDueDate: boolean;
};

/** Quantos filtros do painel recolhível estão ativos (o atalho "Sem vencimento" conta junto). */
export function contarFiltrosAtivos(f: FiltrosPagar, atalhoAtivo: string | null): number {
  const campos = [f.supplierId, f.paymentMethodId, f.status, f.sourceType, f.origin !== "all" ? f.origin : ""];
  return campos.filter(Boolean).length + (atalhoAtivo === "noduedate" ? 1 : 0);
}

export const OPCOES_PERIODO = [
  { value: "overdue", label: "Vencidos" },
  { value: "today", label: "Vence hoje" },
  { value: "next7", label: "Próximos 7 dias" },
  { value: "next15", label: "Próximos 15 dias" },
  { value: "next30", label: "Próximos 30 dias" },
  { value: "currentMonth", label: "Mês atual" },
  { value: "previousMonth", label: "Mês anterior" },
  { value: "nextMonth", label: "Mês seguinte" },
  { value: "currentYear", label: "Ano atual" },
  { value: "paidMonth", label: "Pago no mês" },
  { value: "custom", label: "Período personalizado" }
];

export function rotuloPeriodo(preset: string): string {
  return OPCOES_PERIODO.find((o) => o.value === preset)?.label ?? "Período";
}

/**
 * Vencido não pago fica sempre à vista: o período escolhido vale para o que ainda vai vencer,
 * mas o que venceu antes do início dele e não foi pago entra na lista (grupo "Vencidos").
 * Junta sem repetir (mesmo título nas duas buscas).
 */
export function juntarVencidosAnteriores(doPeriodo: Payable[], vencidosAntes: Payable[]): Payable[] {
  const chave = (p: Payable) => `${p.sourceType ?? ""}:${p.id}`;
  const vistos = new Set(doPeriodo.map(chave));
  return [...vencidosAntes.filter((p) => !vistos.has(chave(p)) && estaEmAberto(p)), ...doPeriodo];
}

/**
 * Presets em que os vencidos de antes do período entram na lista (e no resumo): os que olham
 * o mês/ano corrente ou o que vem pela frente. "Vence hoje", "Últimos 7/30 dias", "Ontem",
 * "Vencidos" (já cobre tudo), "Mês anterior" e o personalizado mostram só o que vence neles.
 * "Pago no mês" é o mês atual (vale para o resumo; a lista pede só os pagos).
 */
const PRESETS_COM_VENCIDOS_ANTERIORES = new Set(["currentMonth", "currentYear", "next7", "next15", "next30", "nextMonth", "paidMonth"]);

export function periodoPuxaVencidosAnteriores(preset: string | null | undefined): boolean {
  return Boolean(preset) && PRESETS_COM_VENCIDOS_ANTERIORES.has(String(preset));
}

/** Vencido: venceu antes de hoje (chaves YYYY-MM-DD). */
function vencidoAntesDe(p: Payable, hoje: string): boolean {
  const due = dateKey(p.dueDate);
  return Boolean(due) && due < hoje;
}

/**
 * Data da baixa de cada título no lote. Com "usar a data de vencimento", o título vencido é
 * baixado na data em que venceu; o que ainda vai vencer (ou não tem vencimento) fica com a
 * data única informada — pagamento em data futura o backend recusa.
 */
export function dataDaBaixaNoLote(p: Payable, usarVencimento: boolean, dataUnica: string, hoje: string): string {
  if (usarVencimento && vencidoAntesDe(p, hoje)) return dateKey(p.dueDate);
  return dataUnica;
}

/** Datas do lote para o resumo: quantos já venceram, quantos ainda vão vencer e o intervalo dos vencimentos. */
export function resumoDatasDoLote(titulos: Payable[], hoje: string): { vencidos: number; aVencer: number; primeiro: string; ultimo: string } {
  const datas = titulos.map((p) => dateKey(p.dueDate)).filter(Boolean).sort();
  const vencidos = titulos.filter((p) => vencidoAntesDe(p, hoje)).length;
  return { vencidos, aVencer: titulos.length - vencidos, primeiro: datas[0] ?? "", ultimo: datas[datas.length - 1] ?? "" };
}

export const DIAS_ALERTA_BAIXA_HOJE = 7;

/** Quantos títulos venceram há mais de `dias` dias (o vencimento está a mais de `dias` antes de hoje). */
export function contarVencidosHaMaisDe(titulos: Payable[], hoje: string, dias = DIAS_ALERTA_BAIXA_HOJE): number {
  return titulos.filter((p) => vencidoAntesDe(p, hoje) && diasEntre(dateKey(p.dueDate), hoje) > dias).length;
}

/** Aviso da baixa em lote com a data de hoje quando há títulos vencidos há mais de uma semana. */
export function avisoDataDoLote(titulos: Payable[], dataUnica: string, usarVencimento: boolean, hoje: string): string | null {
  if (usarVencimento || dataUnica !== hoje) return null;
  const n = contarVencidosHaMaisDe(titulos, hoje);
  if (n === 0) return null;
  return n === 1
    ? "1 título venceu há mais de uma semana — confira a data real do pagamento."
    : `${n} títulos venceram há mais de uma semana — confira a data real do pagamento.`;
}
