// Cálculo puro das diárias de extras — sem banco, para testar isolado.

export type Duracao = "INTEIRA" | "MEIA";
export type ValoresPadrao = { inteira: number; meia: number };
export type ValoresDiaria = {
  baseAmount: number;
  baseAdjustReason: string | null;
  transportAmount: number;
  bonusAmount: number;
  discountAmount: number;
  totalAmount: number;
};

const MOTIVO_MINIMO = 3;
// Teto por campo: uma diária de verdade nunca chega perto disso, e acima de
// ~10^10 o DECIMAL(12,2) estoura e vira erro 500 em vez de mensagem.
export const VALOR_MAXIMO = 100_000;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");

// Aceita número ou texto decimal ("10,60", "10.60"). Vazio = 0; qualquer outra
// coisa ("1e3", "0x10") = NaN — Number() aceitaria essas formas.
function valor(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  // "1.000" / "12.500" (só grupos de três após o ponto) é milhar à brasileira;
  // "10.60" continua decimal.
  const milhar = /^\d{1,3}(\.\d{3})+$/.test(s);
  const normalizado = s.includes(",") || milhar ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d+)?$/.test(normalizado) ? Number(normalizado) : Number.NaN;
}

export function valorPadrao(duracao: Duracao, padrao: ValoresPadrao) {
  return duracao === "MEIA" ? padrao.meia : padrao.inteira;
}

// Na edição, `anterior` é a diária gravada: manter o mesmo valor e a mesma
// duração não exige motivo de novo, mesmo que o padrão tenha mudado depois —
// senão corrigir só a observação de uma diária antiga ficaria bloqueado.
export type DiariaAnterior = { duration: Duracao; baseAmount: number; baseAdjustReason: string | null };

export function lerValoresDiaria(
  b: Record<string, unknown>,
  padrao: ValoresPadrao,
  anterior?: DiariaAnterior
): { ok: true; valores: ValoresDiaria } | { ok: false; erro: string } {
  const duracao: Duracao = b.duration === "MEIA" ? "MEIA" : "INTEIRA";
  const esperado = valorPadrao(duracao, padrao);
  // Sem valor informado: na edição herda o gravado (mudar o padrão depois não
  // reescreve diária antiga); no lançamento novo, usa o padrão.
  const semValor = b.baseAmount == null || b.baseAmount === "";
  const base = semValor ? (anterior && anterior.duration === duracao ? anterior.baseAmount : esperado) : valor(b.baseAmount);
  const transporte = valor(b.transportAmount);
  const acrescimo = valor(b.bonusAmount);
  const desconto = valor(b.discountAmount);

  if ([base, transporte, acrescimo, desconto].some((n) => !Number.isFinite(n))) return { ok: false, erro: "Valor inválido." };
  if ([base, transporte, acrescimo, desconto].some((n) => n < 0)) return { ok: false, erro: "Os valores não podem ser negativos." };
  if ([base, transporte, acrescimo, desconto].some((n) => n > VALOR_MAXIMO)) return { ok: false, erro: `Valor acima do permitido (${brl(VALOR_MAXIMO)}).` };

  const mantido = anterior != null && anterior.duration === duracao && Math.abs(round2(base) - anterior.baseAmount) < 0.005;
  const ajustado = Math.abs(round2(base) - (mantido ? anterior.baseAmount : esperado)) >= 0.005 || (mantido && anterior.baseAdjustReason != null);
  const motivo = String(b.baseAdjustReason ?? "").trim() || (mantido ? anterior.baseAdjustReason ?? "" : "");
  if (ajustado && !mantido && motivo.length < MOTIVO_MINIMO) {
    return { ok: false, erro: `Valor da diária diferente do padrão (${brl(esperado)}): informe o motivo.` };
  }

  const bruto = round2(base + transporte + acrescimo);
  if (round2(desconto) > bruto) return { ok: false, erro: "O desconto não pode ser maior que a diária somada aos acréscimos." };

  return {
    ok: true,
    valores: {
      baseAmount: round2(base),
      baseAdjustReason: ajustado ? motivo : null,
      transportAmount: round2(transporte),
      bonusAmount: round2(acrescimo),
      discountAmount: round2(desconto),
      totalAmount: round2(bruto - desconto),
    },
  };
}

// "8:05" → "08:05"; vazio → null; inválido → false.
export function lerHorario(v: unknown): string | null | false {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return false;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export type DiariaParaResumo = {
  status: string;
  duration: string;
  totalAmount: number;
  sector: string;
  reason: string;
  eventName?: string | null;
  pessoaId: string;
  pessoaNome: string;
  origem: "CASA" | "FORA";
};

type Grupo = { chave: string; total: number; diarias: number };

function agrupar(lista: DiariaParaResumo[], chaveDe: (d: DiariaParaResumo) => string): Grupo[] {
  const mapa = new Map<string, Grupo>();
  for (const d of lista) {
    const chave = chaveDe(d);
    const g = mapa.get(chave) ?? { chave, total: 0, diarias: 0 };
    g.total = round2(g.total + d.totalAmount);
    g.diarias += d.duration === "MEIA" ? 0.5 : 1;
    mapa.set(chave, g);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

// O custo do mês conta só o que foi REALIZADO. Previsto aparece à parte (é
// compromisso, não gasto); faltou e cancelada não custam nada.
export function resumirDiarias(lista: DiariaParaResumo[]) {
  const realizadas = lista.filter((d) => d.status === "REALIZADA");
  const soma = (l: DiariaParaResumo[]) => round2(l.reduce((s, d) => s + d.totalAmount, 0));
  const pessoas = agrupar(realizadas, (d) => d.pessoaId);
  const info = new Map(realizadas.map((d) => [d.pessoaId, d]));
  return {
    custoRealizado: soma(realizadas),
    custoPrevisto: soma(lista.filter((d) => d.status === "PREVISTA")),
    custoCasa: soma(realizadas.filter((d) => d.origem === "CASA")),
    custoFora: soma(realizadas.filter((d) => d.origem === "FORA")),
    diariasRealizadas: realizadas.reduce((s, d) => s + (d.duration === "MEIA" ? 0.5 : 1), 0),
    naoCompareceu: lista.filter((d) => d.status === "NAO_COMPARECEU").length,
    porSetor: agrupar(realizadas, (d) => d.sector),
    porMotivo: agrupar(realizadas, (d) => d.reason),
    // Só diárias com o nome do evento: "quanto custou o evento X em extras".
    porEvento: agrupar(realizadas.filter((d) => d.eventName), (d) => d.eventName!),
    porPessoa: pessoas.map((g) => {
      const d = info.get(g.chave)!;
      return { pessoaId: g.chave, nome: d.pessoaNome, origem: d.origem, total: g.total, diarias: g.diarias };
    }),
  };
}

// ─── Habitualidade de pessoa de fora ───────────────────────────────────────────
// Diária frequente e regular é o principal risco de vínculo empregatício. Três
// sinais, com limites configuráveis (PayrollSettings): dias na mesma semana
// (seg–dom), dias em 30 dias e semanas seguidas com diária. Só AVISA.
export type LimitesHabitualidade = { porSemana: number; em30Dias: number; semanasSeguidas: number };
export type Habitualidade = {
  diasUltimos30: number;
  maiorSemana: number;
  semanaDaMaior: string | null;
  semanasSeguidas: number;
  motivos: string[];
  emRisco: boolean;
};

const DIA_MS = 86_400_000;
const paraDia = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA_MS);
const deDia = (n: number) => new Date(n * DIA_MS).toISOString().slice(0, 10);
// Segunda-feira da semana (1/1/1970 foi quinta: dia 0 → deslocamento 3).
const segunda = (n: number) => n - ((n + 3) % 7);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Avalia a pessoa olhando a partir de hoje e, se houver, do dia mais recente
// (prevista futura) e dos dias pedidos (a diária sendo lançada). Fica o pior
// caso: uma prevista distante não pode apagar o aviso de hoje, e a diária
// agendada avisa antes de acontecer.
export function avaliarHabitualidade(datas: string[], hoje: string, limites: LimitesHabitualidade, olharTambem: string[] = []): Habitualidade {
  const dias = [...new Set(datas.map(paraDia))].sort((a, b) => a - b);
  if (dias.length === 0) return { diasUltimos30: 0, maiorSemana: 0, semanaDaMaior: null, semanasSeguidas: 0, motivos: [], emRisco: false };
  const refs = new Set([paraDia(hoje), dias[dias.length - 1], ...olharTambem.map(paraDia)]);
  const avaliacoes = [...refs].sort((a, b) => b - a).map((ref) => avaliarEm(dias, ref, limites));
  return avaliacoes.reduce((pior, a) => (a.motivos.length > pior.motivos.length || (a.motivos.length === pior.motivos.length && a.diasUltimos30 > pior.diasUltimos30) ? a : pior));
}

function avaliarEm(dias: number[], ref: number, limites: LimitesHabitualidade): Habitualidade {
  const diasUltimos30 = dias.filter((d) => d > ref - 30 && d <= ref).length;

  const porSemana = new Map<number, number>();
  for (const d of dias) if (d > ref - 56) porSemana.set(segunda(d), (porSemana.get(segunda(d)) ?? 0) + 1);
  let maiorSemana = 0;
  let semanaDaMaior: number | null = null;
  // Empate: cita a semana mais recente, a que interessa para decidir a próxima diária.
  for (const [s, n] of porSemana) if (n > maiorSemana || (n === maiorSemana && semanaDaMaior != null && s > semanaDaMaior)) { maiorSemana = n; semanaDaMaior = s; }

  const comDiaria = new Set(dias.map(segunda));
  // A semana corrente ainda vazia não quebra a sequência (pode ter acabado de começar).
  let inicio = segunda(ref);
  if (!comDiaria.has(inicio)) inicio -= 7;
  let semanasSeguidas = 0;
  for (let s = inicio; comDiaria.has(s); s -= 7) semanasSeguidas++;

  const motivos: string[] = [];
  if (maiorSemana >= limites.porSemana && semanaDaMaior != null) motivos.push(`${maiorSemana} dias na semana de ${ddmm(deDia(semanaDaMaior))}`);
  if (diasUltimos30 >= limites.em30Dias) motivos.push(`${diasUltimos30} dias em 30 dias`);
  if (semanasSeguidas >= limites.semanasSeguidas) motivos.push(`${semanasSeguidas} semanas seguidas`);
  return {
    diasUltimos30, maiorSemana, semanaDaMaior: semanaDaMaior == null ? null : deDia(semanaDaMaior),
    semanasSeguidas, motivos, emRisco: motivos.length > 0,
  };
}
