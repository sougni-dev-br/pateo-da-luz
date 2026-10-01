// Verbas opcionais da rescisão de quem não tem registro (decisão do Eli, 01/10/2026):
// "Quero ter esse cálculo, isso deve ser opcional e uma decisão da empresa." Férias
// proporcionais + 1/3, 13º proporcional, aviso prévio indenizado e um valor livre (acordo,
// gratificação). Aparecem desmarcadas; só entram no bruto quando alguém marca, e o
// servidor recalcula — o valor vindo da tela não vale para férias, 13º e aviso.
//
// Base (S) = salário base vigente na data de saída. Início = Employee.admissionDate.
// Sem projeção do aviso nos avos de férias/13º.
import { round2 } from "./vt-calc.js";

const DIA_MS = 86_400_000;
const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const diasEntre = (a: Date, b: Date) => Math.round((utc(b) - utc(a)) / DIA_MS) + 1; // inclusivo
const ultimoDia = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();

// Soma meses mantendo o dia, preso ao último dia do mês destino (31/01 + 1 → 28/02).
function somarMeses(d: Date, meses: number): Date {
  const ano = d.getUTCFullYear();
  const mes0 = d.getUTCMonth() + meses;
  const alvoAno = ano + Math.floor(mes0 / 12);
  const alvoMes = ((mes0 % 12) + 12) % 12;
  return new Date(Date.UTC(alvoAno, alvoMes, Math.min(d.getUTCDate(), ultimoDia(alvoAno, alvoMes))));
}
const diaAntes = (d: Date) => new Date(utc(d) - DIA_MS);

export const DIAS_FRACAO_AVO = 15;
export const AVISO_DIAS_BASE = 30;
export const AVISO_DIAS_POR_ANO = 3;
export const AVISO_DIAS_MAXIMO = 90;
export const LIVRE_DESCRICAO_MINIMA = 3;
const VALOR_LIVRE_MAXIMO = 1_000_000;

// Anos completos de casa até a saída (o aniversário no próprio dia conta).
function anosCompletos(inicio: Date, saida: Date): number {
  if (utc(inicio) > utc(saida)) return 0;
  let anos = saida.getUTCFullYear() - inicio.getUTCFullYear();
  if (utc(somarMeses(inicio, 12 * anos)) > utc(saida)) anos -= 1;
  return Math.max(0, anos);
}

export type AvosFerias = { inicioAquisitivo: string; meses: number; diasFracao: number; avos: number; maisDe12Meses: boolean };

// Período aquisitivo em curso: do último aniversário da entrada (≤ saída). Avos = meses
// completos desde ele + 1 se a fração final tiver 15 dias ou mais. Máximo 12.
export function avosFerias(inicio: Date, saida: Date): AvosFerias {
  if (utc(inicio) > utc(saida)) return { inicioAquisitivo: isoDia(inicio), meses: 0, diasFracao: 0, avos: 0, maisDe12Meses: false };
  const anos = anosCompletos(inicio, saida);
  const aquisitivo = somarMeses(inicio, 12 * anos);
  let meses = 0;
  // O mês m fecha na véspera do "mesmo dia" m meses depois.
  while (meses < 12 && utc(diaAntes(somarMeses(aquisitivo, meses + 1))) <= utc(saida)) meses += 1;
  const fimDosMeses = somarMeses(aquisitivo, meses);
  const diasFracao = utc(fimDosMeses) > utc(saida) ? 0 : diasEntre(fimDosMeses, saida);
  const avos = Math.min(12, meses + (diasFracao >= DIAS_FRACAO_AVO ? 1 : 0));
  return { inicioAquisitivo: isoDia(aquisitivo), meses, diasFracao, avos, maisDe12Meses: anos >= 1 };
}

// 13º: ano civil da saída, de max(01/01, início) até a saída; cada mês com 15 dias ou mais
// trabalhados conta 1 avo.
export function avos13(inicio: Date, saida: Date): { avos: number; desde: string } {
  const ano = saida.getUTCFullYear();
  const primeiro = new Date(Date.UTC(ano, 0, 1));
  const desde = utc(inicio) > utc(primeiro) ? inicio : primeiro;
  if (utc(desde) > utc(saida)) return { avos: 0, desde: isoDia(desde) };
  let avos = 0;
  for (let mes0 = desde.getUTCMonth(); mes0 <= saida.getUTCMonth(); mes0 += 1) {
    const ini = new Date(Math.max(utc(desde), Date.UTC(ano, mes0, 1)));
    const fim = new Date(Math.min(utc(saida), Date.UTC(ano, mes0, ultimoDia(ano, mes0))));
    if (diasEntre(ini, fim) >= DIAS_FRACAO_AVO) avos += 1;
  }
  return { avos, desde: isoDia(desde) };
}

// Aviso prévio indenizado: 30 dias + 3 por ano completo, até 90.
export function diasAviso(inicio: Date, saida: Date): { anos: number; dias: number } {
  const anos = anosCompletos(inicio, saida);
  return { anos, dias: Math.min(AVISO_DIAS_MAXIMO, AVISO_DIAS_BASE + AVISO_DIAS_POR_ANO * anos) };
}

const avosTxt = (n: number) => `${n} ${n === 1 ? "avo" : "avos"}`;
const br = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// N = number no cálculo; number | null na tela de quem não vê Funcionários (valores ocultos).
export type CalculoVerbasDe<N> = {
  base: N;
  inicio: string;
  ferias: { avos: number; inicioAquisitivo: string; ferias: N; terco: N; valor: N; memoria: string };
  decimoTerceiro: { avos: number; desde: string; valor: N; memoria: string };
  aviso: { dias: number; anos: number; valor: N; memoria: string };
  avisoFeriasVencidas: string | null;
};
export type CalculoVerbas = CalculoVerbasDe<number>;
export type CalculoVerbasVisivel = CalculoVerbasDe<number | null>;

// O que a apuração devolve: o cálculo (fora do bruto sugerido) ou por que não há.
export type VerbasOpcionaisApuracao = { calculo: CalculoVerbasVisivel | null; observacao: string | null };

// O cálculo com os valores (a apuração do servidor sempre os tem; a mascarada, não).
export function calculoCompleto(c: CalculoVerbasVisivel | null | undefined): CalculoVerbas | null {
  if (!c || c.base == null || c.ferias.valor == null || c.decimoTerceiro.valor == null || c.aviso.valor == null) return null;
  return c as CalculoVerbas;
}

const MEMORIA_OCULTA = "valor oculto: exige a permissão de ver Funcionários";

// Sem ver Funcionários: avos e dias ficam (não revelam o salário); valores e memória saem.
export function ocultarValoresVerbas(v: VerbasOpcionaisApuracao | null | undefined): VerbasOpcionaisApuracao | null {
  if (!v?.calculo) return v ?? null;
  const c = v.calculo;
  return {
    ...v,
    calculo: {
      ...c, base: null,
      ferias: { ...c.ferias, ferias: null, terco: null, valor: null, memoria: MEMORIA_OCULTA },
      decimoTerceiro: { ...c.decimoTerceiro, valor: null, memoria: MEMORIA_OCULTA },
      aviso: { ...c.aviso, valor: null, memoria: MEMORIA_OCULTA },
    },
  };
}

export const AVISO_FERIAS_VENCIDAS = "Há período de férias completo sem registro de férias: não calculado automaticamente; se for o caso, use o valor livre";

// feriasRegistradas: início dos lançamentos de FÉRIAS da pessoa. Cobrem o período anterior
// os que começam a partir do início do aquisitivo anterior.
export function calcularVerbasOpcionais(e: {
  salarioBase: number | null; inicio: Date | null; saida: Date; feriasRegistradas: Date[];
}): CalculoVerbas | null {
  if (!e.inicio || e.salarioBase == null || !(e.salarioBase > 0)) return null;
  const S = round2(e.salarioBase);
  const f = avosFerias(e.inicio, e.saida);
  const ferias = round2((S / 12) * f.avos);
  const terco = round2(ferias / 3);
  const t = avos13(e.inicio, e.saida);
  const a = diasAviso(e.inicio, e.saida);
  const aquisitivoAnterior = somarMeses(new Date(`${f.inicioAquisitivo}T00:00:00Z`), -12);
  const cobertas = e.feriasRegistradas.some((x) => utc(x) >= utc(aquisitivoAnterior));
  return {
    base: S,
    inicio: isoDia(e.inicio),
    ferias: {
      avos: f.avos, inicioAquisitivo: f.inicioAquisitivo, ferias, terco, valor: round2(ferias + terco),
      memoria: `S ${br(S)} ÷ 12 × ${avosTxt(f.avos)} = ${br(ferias)} + 1/3 (${br(terco)})`,
    },
    decimoTerceiro: { avos: t.avos, desde: t.desde, valor: round2((S / 12) * t.avos), memoria: `S ${br(S)} ÷ 12 × ${avosTxt(t.avos)}` },
    aviso: { dias: a.dias, anos: a.anos, valor: round2((S * a.dias) / 30), memoria: `S ${br(S)} ÷ 30 × ${a.dias} dias` },
    avisoFeriasVencidas: f.maisDe12Meses && !cobertas ? AVISO_FERIAS_VENCIDAS : null,
  };
}

// ─── O que a tela marcou ───────────────────────────────────────────────────────
export type EscolhaVerbas = { ferias: boolean; decimoTerceiro: boolean; aviso: boolean; livre: { valor: number; descricao: string } | null };
export const ESCOLHA_VAZIA: EscolhaVerbas = { ferias: false, decimoTerceiro: false, aviso: false, livre: null };

export const algumaMarcada = (e: EscolhaVerbas) => e.ferias || e.decimoTerceiro || e.aviso || e.livre != null;

// Lê o corpo da requisição. Só `true` marca; o valor livre exige valor > 0 e descrição.
export function lerEscolhaVerbas(v: unknown): { erro: string } | { escolha: EscolhaVerbas } {
  if (v == null) return { escolha: ESCOLHA_VAZIA };
  if (typeof v !== "object" || Array.isArray(v)) return { erro: "Verbas opcionais em formato inválido." };
  const o = v as Record<string, unknown>;
  let livre: EscolhaVerbas["livre"] = null;
  if (o.livre != null) {
    if (typeof o.livre !== "object") return { erro: "Valor livre em formato inválido." };
    const l = o.livre as Record<string, unknown>;
    const valor = Number(l.valor);
    if (!Number.isFinite(valor) || valor <= 0 || valor > VALOR_LIVRE_MAXIMO) {
      return { erro: "Valor livre precisa ser um número maior que zero (até 1.000.000)." };
    }
    const descricao = typeof l.descricao === "string" ? l.descricao.trim().slice(0, 200) : "";
    if (descricao.length < LIVRE_DESCRICAO_MINIMA) {
      return { erro: `Descreva o valor livre (acordo, gratificação…) em pelo menos ${LIVRE_DESCRICAO_MINIMA} letras: a descrição é obrigatória.` };
    }
    livre = { valor: round2(valor), descricao };
  }
  return { escolha: { ferias: o.ferias === true, decimoTerceiro: o.decimoTerceiro === true, aviso: o.aviso === true, livre } };
}

export type VerbaMarcada = {
  tipo: "FERIAS" | "DECIMO_TERCEIRO" | "AVISO" | "LIVRE";
  rotulo: string;
  valor: number;
  memoria: string | null;
  avos?: number;
  dias?: number;
  terco?: number;
  descricao?: string;
};

// As verbas marcadas, com o valor do cálculo do servidor, e o total que entra no bruto.
export function aplicarVerbasOpcionais(calc: CalculoVerbas | null, e: EscolhaVerbas):
  { erro: string } | { itens: VerbaMarcada[]; total: number } {
  if ((e.ferias || e.decimoTerceiro || e.aviso) && !calc) {
    return { erro: "Não dá para calcular férias, 13º ou aviso: falta o salário base vigente na saída ou a data de início no cadastro." };
  }
  const itens: VerbaMarcada[] = [];
  if (e.ferias && calc) {
    itens.push({ tipo: "FERIAS", rotulo: "Férias proporcionais + 1/3", valor: calc.ferias.valor, memoria: calc.ferias.memoria, avos: calc.ferias.avos, terco: calc.ferias.terco });
  }
  if (e.decimoTerceiro && calc) {
    itens.push({ tipo: "DECIMO_TERCEIRO", rotulo: "13º proporcional", valor: calc.decimoTerceiro.valor, memoria: calc.decimoTerceiro.memoria, avos: calc.decimoTerceiro.avos });
  }
  if (e.aviso && calc) {
    itens.push({ tipo: "AVISO", rotulo: "Aviso prévio indenizado", valor: calc.aviso.valor, memoria: calc.aviso.memoria, dias: calc.aviso.dias });
  }
  if (e.livre) itens.push({ tipo: "LIVRE", rotulo: e.livre.descricao, valor: e.livre.valor, memoria: null, descricao: e.livre.descricao });
  return { itens, total: round2(itens.reduce((s, i) => s + i.valor, 0)) };
}

// A escolha que gerou os itens gravados (para manter no ajuste).
export function escolhaDosItens(itens: VerbaMarcada[]): EscolhaVerbas {
  const livre = itens.find((i) => i.tipo === "LIVRE");
  return {
    ferias: itens.some((i) => i.tipo === "FERIAS"),
    decimoTerceiro: itens.some((i) => i.tipo === "DECIMO_TERCEIRO"),
    aviso: itens.some((i) => i.tipo === "AVISO"),
    livre: livre ? { valor: livre.valor, descricao: livre.descricao ?? livre.rotulo } : null,
  };
}
