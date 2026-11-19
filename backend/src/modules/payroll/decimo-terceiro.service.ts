// 13º dos sem registro: monta a lista (prévia) e gera as duas parcelas como PayrollItem.
// Entram (1) quem é sem registro hoje e (2) quem foi registrado no ano: o período sem registro
// dele (até o fim do mês anterior à carteira) é pago aqui; o resto vem do extrato da contabilidade.
// CLT sem período sem registro fica de fora.
//
// Regra do valor (a mesma que a contabilidade usa no CLT): ver calcularDecimoTerceiroSR. A 2ª
// parcela é o ACERTO — 13º completo menos o que a 1ª pagou — e só é gerada com a gorjeta de
// novembro fechada. Parcela ainda não paga é atualizada se o cálculo mudou (salário, variáveis);
// a paga fica congelada e a diferença cai na 2ª; o que alguém ajustou à mão não é sobrescrito.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { computeTipCommission } from "./tip-commission.service.js";
import { cadastrosVigentes, carregarHistorico } from "./cadastro-historico.service.js";
import { DESCRICAO_COMBINADO_E_GORJETA, gorjetaIntegralDoCombinado, informadasDaTabela, informadasDasFerias, mediaDeclaradaMensal, variaveisDaDiferencaDaGorjeta, type MediaValorExtrato } from "./decimo-terceiro-gorjeta-combinado.js";
import { complementoSomado, DESCRICAO_COMBINADO, diferencaDoCombinado, foiSomado, inicioDoCombinado, liquidoDoExtrato } from "./decimo-terceiro-combinado.js";
import { type MesFaltando, mesesDoPeriodo13, mesesSemVariavel } from "./decimo-terceiro-meses-faltando.js";
import { type ResultadoSoma, somarCombinadoAoExtrato } from "./decimo-terceiro-combinado.service.js";
import { type LinhaDecimo13Clt, montarLinhasClt } from "./decimo-terceiro-clt.js";
import {
  calcularDecimoTerceiroSR, decidirParcela, fimSemRegistro, inicioDoDecimo, primeiraParaAcerto, ROTULO_13_COMBINADO_PARCELA_1, ROTULO_13_COMBINADO_PARCELA_2,
  ROTULO_13_EXTRATO_PARCELA_1, ROTULO_13_PARCELA_1, ROTULO_13_PARCELA_2, segundaParcela, type Decimo13SR,
} from "./decimo-terceiro-sr.js";
import { informadasDoAno } from "./gorjeta-integral-informada.service.js";
import { round2 } from "./vt-calc.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { FOLHA_CATEGORY, computeStatus } from "./payroll.service.js";

// Uma parcela na prévia. `existe` = já resolvida (ativa, paga ou excluída à mão): não conta como "a gerar".
export type ParcelaLinha = {
  existe: boolean; paga: boolean;
  lancado: number | null;   // valor do lançamento ativo
  devido: number | null;    // quanto deve ser, pelo cálculo de hoje
  gerar: boolean;           // criar, restaurar ou atualizar agora
  // Só a diferença do combinado: ainda não há título do extrato para somar (a diferença entra quando o extrato é importado).
  aguardaExtrato?: boolean;
  // Só a diferença do combinado: esta parcela já faz parte do título do extrato (o valor do título a inclui; não somar de novo no total).
  somadaAoExtrato?: boolean;
  // Título do extrato pago com valor diferente do líquido: conferir antes de lançar a diferença à parte.
  conferir?: boolean;
};

export type LinhaDecimo13 = {
  employeeId: string; nome: string; setor: string | null;
  calculo: Decimo13SR | null; motivoSemCalculo: string | null;
  p1: ParcelaLinha;
  p2: ParcelaLinha & { excesso: number };
  // Só quando a 2ª já foi paga: o que falta pagar (+) ou foi pago a mais (−) em relação ao calculado hoje.
  acerto: number | null;
  // Registrado depois do início real: só o período sem registro entra aqui (até `semRegistroAte`).
  preRegistro: boolean; semRegistroAte: string | null; registroEm: string | null;
  // Variáveis de mês informadas à mão (substituem a apuração no cálculo).
  // `conta`: o mês está dentro do período de 13º da pessoa (um mês informado fora dele não entra na média).
  informadas: Array<VariavelInformada & { conta: boolean }>;
  // Meses (1 a 11) do período da pessoa em que falta a variável para a média: a tela lista e deixa informar o valor.
  mesesFaltando: MesFaltando[];
  // SEM_REGISTRO: o 13º inteiro (ou o período sem registro). COMBINADO: só a diferença entre o salário
  // combinado e o registrado de quem é CLT (o registrado vem do extrato da contabilidade).
  origem: "SEM_REGISTRO" | "COMBINADO";
  rotulos: { p1: string; p2: string };
  // Só a diferença do combinado: a 1ª parcela é SOMADA ao título do extrato (um título só), não vira lançamento próprio.
  viaExtrato: boolean;
  // Só a diferença do combinado com a 1ª somada ao título do extrato: o que essa 1ª carrega/pagou de fato, base do acerto da 2ª.
  primeiraSomada: number | null;
  // A 1ª parcela desta linha vai SOMADA ao título do extrato (um título só, com a explicação): a diferença do combinado e o
  // 13º do período sem registro de quem foi registrado depois. Falso = a linha tem lançamento próprio.
  somaNoExtrato: boolean;
  // Como a soma se chama na explicação do título (null quando não há soma no extrato).
  complementoDescricao: string | null;
};

export type PreviaDecimo13 = {
  ano: number; linhas: LinhaDecimo13[];
  // A 2ª parcela só pode ser gerada com a gorjeta de novembro fechada (a média precisa dela).
  novembroFechado: boolean;
  avisos: string[];
  // Títulos do extrato em aberto que ainda carregam uma diferença do combinado que não vale mais (o combinado acabou ou a
  // pessoa saiu da prévia): "Lançar" desfaz a soma. O botão precisa estar habilitado para isso.
  somasOrfas: number;
};

const nomeDe = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
const diaRef = (ano: number) => new Date(Date.UTC(ano, 11, 20)); // salário e vínculo vigentes em 20/12
const iso = (d: Date) => d.toISOString().slice(0, 10);
const mmaaaa = (mes: number, ano: number) => `${String(mes).padStart(2, "0")}/${ano}`;
const ROTULOS_SR = { p1: ROTULO_13_PARCELA_1, p2: ROTULO_13_PARCELA_2 };
const ROTULOS_COMBINADO = { p1: ROTULO_13_COMBINADO_PARCELA_1, p2: ROTULO_13_COMBINADO_PARCELA_2 };
const TODOS_OS_ROTULOS = [ROTULOS_SR.p1, ROTULOS_SR.p2, ROTULOS_COMBINADO.p1, ROTULOS_COMBINADO.p2, ROTULO_13_EXTRATO_PARCELA_1];

// `apurados`: os meses que entram na média — fechados, ou abertos mas já encerrados (dados provisórios).
// Mês em andamento (período que ainda não terminou) fica de fora até fechar: valor parcial puxaria a média para baixo.
export type VariavelInformada = { mes: number; valor: number; motivo: string };
type Variaveis = {
  // Gorjeta integral (a mesma da folha de líquidos) de cada pessoa por mês: base da diferença somada ao 13º do combinado.
  gorjetaIntegral: Map<string, Map<number, number>>;
  porPessoa: Map<string, Map<number, number>>; status: Map<number, string>; apurados: Set<number>;
  informadas: Map<string, VariavelInformada[]>;
};

// Variáveis de cada pessoa por mês: gorjeta + hora extra + adicional noturno (o DSR sobre a hora
// extra fica de fora, como na contabilidade). Só os meses 1 a 11 servem ao 13º.
async function variaveisDoAno(ano: number): Promise<Variaveis> {
  const periodos = await prisma.tipPeriod.findMany({ where: { competenceYear: ano }, select: { competenceMonth: true, periodEnd: true } });
  const porPessoa = new Map<string, Map<number, number>>();
  const gorjetaIntegral = new Map<string, Map<number, number>>();
  const status = new Map<number, string>();
  const apurados = new Set<number>();
  const agora = Date.now();
  for (const per of periodos) {
    if (per.competenceMonth > 11) continue;
    const comp = await computeTipCommission(ano, per.competenceMonth, { incluirDadosPessoais: true });
    status.set(per.competenceMonth, comp.status ?? "OPEN");
    if (comp.status === "CLOSED" || per.periodEnd.getTime() < agora) apurados.add(per.competenceMonth);
    for (const p of comp.participants) {
      if (!p.employeeId) continue;
      const v = (p.rateioAmount ?? 0) + (p.valorHoraExtra ?? 0) + (p.valorAdicionalNoturno ?? 0);
      const meses = porPessoa.get(p.employeeId) ?? new Map<number, number>();
      meses.set(per.competenceMonth, (meses.get(per.competenceMonth) ?? 0) + v);
      porPessoa.set(p.employeeId, meses);
      // Gorjeta integral: líquida dos pontos (rateio − vales + créditos); fora do período ou paga na rescisão não conta.
      const integral = p.tipoCalculo !== "FORA_DO_PERIODO" && !p.pagoNaRescisao ? p.netCommission ?? 0 : 0;
      const gi = gorjetaIntegral.get(p.employeeId) ?? new Map<number, number>();
      gi.set(per.competenceMonth, round2((gi.get(per.competenceMonth) ?? 0) + integral));
      gorjetaIntegral.set(p.employeeId, gi);
    }
  }
  // Valor informado à mão substitui o da apuração, só aqui (a gorjeta em si não muda).
  const informadas = new Map<string, VariavelInformada[]>();
  const registros = await prisma.decimoTerceiroVariavel.findMany({
    where: { ano, mes: { lte: 11 } }, select: { employeeId: true, mes: true, valor: true, motivo: true }, orderBy: { mes: "asc" },
  });
  for (const r of registros) {
    const meses = porPessoa.get(r.employeeId) ?? new Map<number, number>();
    meses.set(r.mes, round2(Number(r.valor)));
    porPessoa.set(r.employeeId, meses);
    informadas.set(r.employeeId, [...(informadas.get(r.employeeId) ?? []), { mes: r.mes, valor: round2(Number(r.valor)), motivo: r.motivo }]);
  }
  return { gorjetaIntegral, porPessoa, status, apurados, informadas };
}

// Gorjeta DECLARADA que o extrato do 13º já pagou a cada pessoa (rubrica "MEDIA VALOR"), pelo CPF. Lê o texto guardado
// do extrato importado: não precisa reimportar.
async function mediaDeclaradaDoExtrato(ano: number): Promise<Map<string, MediaValorExtrato>> {
  const out = new Map<string, MediaValorExtrato>();
  // Import dinâmico: rh-extract.service puxa a leitura de PDF (pesada) e importa este módulo (ciclo).
  const { lerTextoExtrato } = await import("./rh-extract.service.js");
  const extratos = await prisma.rhExtract.findMany({
    where: { calculo: "DECIMO_TERCEIRO", competenceYear: ano }, select: { texto: true }, orderBy: { createdAt: "asc" },
  });
  for (const x of extratos) {
    if (!x.texto) continue;
    let funcionarios: Array<{ cpfNorm: string; mediaValor13?: MediaValorExtrato | null }>;
    try { funcionarios = lerTextoExtrato(x.texto).funcionarios; } catch { continue; } // extrato antigo de outro formato: não derruba o 13º de todos
    for (const f of funcionarios) {
      if (!f.mediaValor13) continue;
      // A mesma pessoa em mais de um extrato: vale a MAIOR declarada (a que menos soma), nunca a que pagaria a mais.
      const atual = out.get(f.cpfNorm);
      if (!atual || mediaDeclaradaMensal(f.mediaValor13) > mediaDeclaradaMensal(atual)) out.set(f.cpfNorm, f.mediaValor13);
    }
  }
  return out;
}

// Avisos sobre a base da média: mês sem apuração, em andamento ou ainda não fechado.
function avisosDaBase(ano: number, status: Map<number, string>, apurados: Set<number>): string[] {
  const abertos: string[] = [];
  const andamento: string[] = [];
  const ausentes: string[] = [];
  for (let m = 1; m <= 11; m += 1) {
    const st = status.get(m);
    if (st == null) ausentes.push(mmaaaa(m, ano));
    else if (st !== "CLOSED") (apurados.has(m) ? abertos : andamento).push(mmaaaa(m, ano));
  }
  const avisos: string[] = [];
  if (abertos.length > 0) avisos.push(`Gorjeta ainda não fechada em ${abertos.join(", ")}: a média desses meses pode mudar. Parcela não paga é atualizada quando você gerar de novo.`);
  if (andamento.length > 0) avisos.push(`Gorjeta de ${andamento.join(", ")} em andamento: fica de fora da média até fechar (a 2ª parcela só é gerada depois).`);
  if (ausentes.length > 0) avisos.push(`Sem apuração de gorjeta em ${ausentes.join(", ")}: esses meses ficam de fora da média (a gorjeta já era paga; a média usa só os meses apurados).`);
  return avisos;
}

type Item = { status?: unknown; amount: unknown; paidAmount: unknown; paymentDate: Date | null; deletedAt: Date | null; deletedById: string | null; periodLabel: string; employeeId: string; details?: unknown };

const valorDe = (i: Item | undefined) => (i ? round2(Number(i.amount)) : null);
const resolvida = (i: Item | undefined) => Boolean(i && !["criar", "restaurar"].includes(decidirParcela(i)));

function parcelaLinha(item: Item | undefined, devido: number | null): ParcelaLinha {
  const ativa = item && !item.deletedAt ? item : undefined;
  const mudou = ativa != null && !ativa.paymentDate && devido != null && Math.abs(round2(Number(ativa.amount)) - devido) >= 0.01;
  const gerar = devido != null && devido > 0 && (!resolvida(item) || (decidirParcela(item ?? null) === "ja-existe" && mudou));
  return { existe: resolvida(item), paga: Boolean(ativa?.paymentDate), lancado: valorDe(ativa), devido, gerar };
}

// As duas parcelas de uma linha: a 2ª é o acerto do que a 1ª pagou de fato (paga: o valor pago; senão, o calculado).
function parcelasDaLinha(
  itemDe: (id: string, rotulo: string) => Item | undefined, id: string, rotulos: { p1: string; p2: string }, calculo: Decimo13SR | null,
  primeiraSomada: number | null = null,
): Pick<LinhaDecimo13, "p1" | "p2" | "acerto"> {
  const i1 = itemDe(id, rotulos.p1);
  const i2 = itemDe(id, rotulos.p2);
  // 1ª somada ao título do extrato: vale o que ela carrega/pagou de fato, não o cálculo de hoje.
  const p2 = calculo ? segundaParcela(calculo.total, primeiraSomada ?? primeiraParaAcerto(i1 ?? null, calculo.parcela1)) : null;
  const pagoNa2 = i2 && !i2.deletedAt && i2.paymentDate ? round2(Number(i2.paidAmount ?? i2.amount)) : null;
  return {
    p1: parcelaLinha(i1, calculo?.parcela1 ?? null),
    p2: { ...parcelaLinha(i2, p2?.valor ?? null), excesso: p2?.excesso ?? 0 },
    acerto: calculo && p2 && pagoNa2 != null ? round2(p2.valor - pagoNa2 - p2.excesso) : null,
  };
}

// 1ª parcela da diferença do combinado: vai SOMADA ao título do 13º que veio do extrato (um título só, como no
// salário). Sem o título do extrato ela aguarda; com o título já pago sem a soma, vira lançamento próprio.
// O que a 1ª parcela da diferença carrega no título do extrato (em aberto: o somado; pago: a parte do combinado que saiu).
// null = não está somada (aguarda o extrato, ou a diferença foi lançada à parte).
export function primeiraSomadaDoExtrato(extrato: Item | undefined): number | null {
  const ativo = extrato && !extrato.deletedAt ? extrato : undefined;
  const complemento = ativo ? complementoSomado(ativo.details) : null;
  if (!ativo || complemento == null) return null;
  if (!ativo.paymentDate) return round2(complemento);
  const liquido = liquidoDoExtrato(ativo.details);
  const pagoAMais = liquido != null && ativo.paidAmount != null ? round2(Number(ativo.paidAmount) - liquido) : null;
  return pagoAMais != null ? Math.max(0, pagoAMais) : round2(complemento);
}

export function p1DoCombinado(extrato: Item | undefined, propria: ParcelaLinha, devido: number): { p1: ParcelaLinha; viaExtrato: boolean } {
  if (propria.existe || propria.lancado != null) return { p1: propria, viaExtrato: false }; // já lançada à parte
  const ativo = extrato && !extrato.deletedAt ? extrato : undefined;
  if (!ativo) return { p1: { ...propria, gerar: false, aguardaExtrato: true }, viaExtrato: false };
  const somado = foiSomado(ativo.details);
  if (ativo.paymentDate) {
    return somado
      ? { p1: { existe: true, paga: true, lancado: complementoSomado(ativo.details), devido, gerar: false, somadaAoExtrato: true }, viaExtrato: false }
      : { p1: propria, viaExtrato: false };
  }
  const somadoAntes = somado ? complementoSomado(ativo.details) ?? 0 : null;
  const igual = somadoAntes != null && Math.abs(somadoAntes - devido) < 0.01;
  // Somado com outro valor (o cálculo mudou): o título já carrega o valor antigo; gerar atualiza para o de hoje.
  return {
    p1: somadoAntes != null
      ? { existe: true, paga: false, lancado: somadoAntes, devido, gerar: !igual, somadaAoExtrato: true }
      : { existe: false, paga: false, lancado: null, devido, gerar: devido > 0 },
    viaExtrato: true,
  };
}

const reaisBr = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// A 1ª parcela de uma linha que vai somada ao título do extrato (combinado ou período sem registro): o estado dela e o que
// fazer. Título do extrato JÁ PAGO, sem a soma, com valor diferente do líquido: pode ter sido pago já com o valor a mais
// (ajuste à mão). Não gera à parte sem conferir: pagaria duas vezes.
function resolverViaExtrato(
  extrato: Item | undefined, proprias: ParcelaLinha, devido: number, nome: string, avisos: string[], oQueSoma: { sujeito: string; pago: string; lancar: string },
): { p1: ParcelaLinha; viaExtrato: boolean } {
  let r = p1DoCombinado(extrato, proprias, devido);
  const liquidoPago = extrato && !extrato.deletedAt && extrato.paymentDate && !foiSomado(extrato.details) ? liquidoDoExtrato(extrato.details) : null;
  const valorPago = extrato ? round2(Number(extrato.paidAmount ?? extrato.amount)) : null;
  if (liquidoPago != null && valorPago != null && Math.abs(valorPago - liquidoPago) >= 1 && !proprias.existe && proprias.lancado == null) {
    r = { p1: { existe: true, paga: true, lancado: null, devido, gerar: false, conferir: true }, viaExtrato: false };
    avisos.push(`${nome}: o título do 13º do extrato foi pago com ${reaisBr(valorPago)} e o líquido do extrato era ${reaisBr(liquidoPago)}: confira se ${oQueSoma.sujeito} já foi ${oQueSoma.pago} antes de ${oQueSoma.lancar} à parte (pode ter ido junto).`);
  }
  return r;
}

// Soma (ou desfaz a soma) da diferença do combinado nos títulos do extrato em aberto. Chamado ao gerar a
// 1ª parcela e ao importar o extrato do 13º.
export async function sincronizarCombinadoDoDecimo(ano: number, userId: string, previaPronta?: PreviaDecimo13): Promise<ResultadoSoma> {
  const previa = previaPronta ?? await listarDecimoTerceiroSR(ano);
  const complementos = new Map<string, { valor: number; descricao: string }>();
  for (const l of previa.linhas) {
    if (l.somaNoExtrato && l.viaExtrato && l.calculo) complementos.set(l.employeeId, { valor: l.calculo.parcela1, descricao: l.complementoDescricao ?? DESCRICAO_COMBINADO });
  }
  return somarCombinadoAoExtrato(ano, complementos, userId);
}

export async function listarDecimoTerceiroSR(ano: number): Promise<PreviaDecimo13> {
  // Desligado fica de fora: o 13º proporcional dele é verba da rescisão (opcional, sem registro);
  // gerar aqui pagaria duas vezes. Quem não recebe 13º (chave do cadastro) e cadastro excluído também.
  const emps = await prisma.employee.findMany({
    where: { deletedAt: null, terminationDate: null, recebeDecimoTerceiro: true },
    select: {
      id: true, firstName: true, lastName: true, sector: true, modality: true, baseSalary: true, salarioCombinado: true, cpf: true,
      admissionDate: true, admissaoCarteira: true, decimoTerceiroInicio: true, terminationDate: true,
    },
    orderBy: [{ firstName: "asc" }],
  });
  const fimDe = new Map(emps.map((e) => [e.id, fimSemRegistro(e.admissionDate, e.admissaoCarteira)]));
  // Vigente em 20/12, ou no último dia sem registro de quem foi registrado: o histórico decide salário e vínculo.
  const vigentes = await cadastrosVigentes(
    emps.map((e) => ({ ...e, baseSalary: e.baseSalary == null ? null : Number(e.baseSalary), salarioCombinado: e.salarioCombinado == null ? null : Number(e.salarioCombinado) })),
    (e) => fimDe.get(e.id) ?? diaRef(ano),
  );
  // Inclui os excluídos: o excluído à mão conta como "já existe" (o botão zera e ninguém o recria).
  const existentes: Item[] = await prisma.payrollItem.findMany({
    where: {
      type: "DECIMO_TERCEIRO", competenceYear: ano, employeeId: { in: emps.map((e) => e.id) },
      periodLabel: { in: TODOS_OS_ROTULOS },
    },
    select: { employeeId: true, periodLabel: true, status: true, amount: true, paidAmount: true, paymentDate: true, deletedAt: true, deletedById: true, details: true },
  });
  const itemDe = (id: string, rotulo: string) => existentes.find((x) => x.employeeId === id && x.periodLabel === rotulo);
  // Quem já tem o 13º do extrato da contabilidade (CLT) e não é pré-registro não é gerado aqui:
  // o extrato já o inclui por inteiro e gerar de novo pagaria duas vezes.
  const comExtrato = new Set(existentes.filter((x) => x.periodLabel === ROTULO_13_EXTRATO_PARCELA_1 && !x.deletedAt).map((x) => x.employeeId));
  const variaveis = await variaveisDoAno(ano);
  // Afastamento sem remuneração (pedido da pessoa) da escala: dia não trabalhado, entra na regra dos 15 dias.
  const afastados = new Map<string, Set<string>>();
  for (const d of await prisma.employeeScheduleDay.findMany({
    where: { type: "AFASTAMENTO", employeeId: { in: emps.map((e) => e.id) }, date: { gte: new Date(Date.UTC(ano, 0, 1)), lte: new Date(Date.UTC(ano, 11, 31)) } },
    select: { employeeId: true, date: true },
  })) {
    const dias = afastados.get(d.employeeId) ?? new Set<string>();
    dias.add(iso(d.date));
    afastados.set(d.employeeId, dias);
  }
  const linhas: LinhaDecimo13[] = [];
  const avisosCombinado: string[] = [];
  // Quem tem salário combinado já tem a diferença somada ao título do extrato: o período sem registro (se houver) não soma junto.
  const idsComCombinado = new Set(emps.filter((e) => vigentes.get(e.id)?.modality === "CLT" && vigentes.get(e.id)?.salarioCombinado != null).map((e) => e.id));
  for (const e of emps) {
    const v = vigentes.get(e.id);
    const fim = fimDe.get(e.id) ?? null;
    const preRegistro = fim != null;
    if (!v || (!preRegistro && v.modality !== "NAO_CLT")) continue;
    const salario = v.baseSalary == null ? null : Number(v.baseSalary);
    let calculo = calcularDecimoTerceiroSR({
      ano, salarioBase: salario, inicio: inicioDoDecimo(e.admissionDate, e.decimoTerceiroInicio), desligamento: e.terminationDate, ate: fim,
      diasAfastados: afastados.get(e.id),
      // Mês informado à mão conta para esta pessoa mesmo sem apuração (a gorjeta paga por fora é o caso típico).
      variaveis: variaveis.porPessoa.get(e.id),
      mesesApurados: new Set([...variaveis.apurados, ...(variaveis.informadas.get(e.id) ?? []).map((i) => i.mes)]),
    });
    // Registrado sem avos sem registro neste ano (carteira logo no começo ou em anos anteriores): nada a mostrar.
    if (preRegistro && !calculo && salario != null && salario > 0) continue;
    let motivoSemCalculo: string | null = null;
    if (!calculo) {
      motivoSemCalculo = !e.admissionDate ? "Sem data de início (admissão) no cadastro."
        : !(salario != null && salario > 0) ? "Sem salário base vigente no cadastro."
        : e.decimoTerceiroInicio && inicioDoDecimo(e.admissionDate, e.decimoTerceiroInicio) !== e.admissionDate
          ? `Sem avos no ano contando a partir do início do 13º (${iso(e.decimoTerceiroInicio).split("-").reverse().join("/")}).`
        : "Sem avos no ano (menos de 15 dias em cada mês).";
    } else if (!preRegistro && comExtrato.has(e.id)) {
      calculo = null;
      motivoSemCalculo = "Já tem o 13º do extrato da contabilidade: não é gerado aqui (pagaria duas vezes).";
    }
    // Registrado depois do início real: o 13º do período sem registro vai SOMADO ao título do extrato (um título só, com a explicação).
    const somaNoExtrato = preRegistro && calculo != null && !idsComCombinado.has(e.id);
    let extratoPre: Item | undefined;
    let primeiraSomadaPre: number | null = null;
    if (somaNoExtrato) {
      const lido = itemDe(e.id, ROTULO_13_EXTRATO_PARCELA_1);
      extratoPre = lido && String(lido.status ?? "") === "CANCELED" ? undefined : lido;
      primeiraSomadaPre = primeiraSomadaDoExtrato(extratoPre);
    }
    const parcelasSr = parcelasDaLinha(itemDe, e.id, ROTULOS_SR, calculo, primeiraSomadaPre);
    const viaPre = somaNoExtrato && calculo
      ? resolverViaExtrato(extratoPre, parcelasSr.p1, calculo.parcela1, nomeDe(e), avisosCombinado, { sujeito: "o 13º do período sem registro", pago: "pago", lancar: "lançá-lo" })
      : null;
    const dataBr = (d: string) => d.split("-").reverse().join("/");
    const periodoMeses = calculo
      ? mesesDoPeriodo13({ ano, inicio: inicioDoDecimo(e.admissionDate, e.decimoTerceiroInicio), desligamento: e.terminationDate, ate: fim, diasAfastados: afastados.get(e.id) })
      : [];
    linhas.push({
      employeeId: e.id, nome: nomeDe(e), setor: e.sector, calculo, motivoSemCalculo,
      ...parcelasSr, ...(viaPre ? { p1: viaPre.p1 } : {}),
      preRegistro, semRegistroAte: fim ? iso(fim) : null, registroEm: preRegistro && e.admissaoCarteira ? iso(e.admissaoCarteira) : null,
      informadas: (variaveis.informadas.get(e.id) ?? []).map((i) => ({ ...i, conta: periodoMeses.includes(i.mes) })),
      mesesFaltando: calculo ? mesesSemVariavel({
        ano, inicio: inicioDoDecimo(e.admissionDate, e.decimoTerceiroInicio), desligamento: e.terminationDate, ate: fim, diasAfastados: afastados.get(e.id),
        variaveis: variaveis.porPessoa.get(e.id), informados: new Set((variaveis.informadas.get(e.id) ?? []).map((i) => i.mes)),
        status: variaveis.status, apurados: variaveis.apurados,
      }) : [],
      origem: "SEM_REGISTRO", rotulos: ROTULOS_SR, viaExtrato: viaPre?.viaExtrato ?? false, primeiraSomada: primeiraSomadaPre,
      somaNoExtrato,
      complementoDescricao: somaNoExtrato && calculo
        ? `13º do período sem registro, 1ª parcela (${calculo.avosParcela1} ${calculo.avosParcela1 === 1 ? "avo" : "avos"}, de ${dataBr(calculo.desde)} a ${fim ? dataBr(iso(fim)) : "—"})`
        : null,
    });
  }
  // CLT com salário combinado: a diferença acima do registrado (o registrado vem do extrato).
  const comCombinado = emps.filter((e) => vigentes.get(e.id)?.modality === "CLT" && vigentes.get(e.id)?.salarioCombinado != null);
  const historicoCombinado = comCombinado.length > 0 ? await carregarHistorico(comCombinado.map((e) => e.id)) : new Map();
  const declaradas = comCombinado.length > 0 ? await mediaDeclaradaDoExtrato(ano) : new Map<string, MediaValorExtrato>();
  // Gorjeta informada à mão (tabela única, preenchida pelo modal de férias) preenche meses sem apuração. Retrocompatível: sem linha
  // na tabela, vale o que ficou guardado no título FERIAS (do mais antigo ao mais novo).
  const informadasDaTabelaPorPessoa = comCombinado.length > 0 ? await informadasDoAno(comCombinado.map((e) => e.id), ano) : new Map();
  const titulosFerias = comCombinado.length > 0
    ? await prisma.payrollItem.findMany({
      where: { type: "FERIAS", employeeId: { in: comCombinado.map((e) => e.id) }, deletedAt: null, status: { not: "CANCELED" } },
      select: { employeeId: true, details: true }, orderBy: { updatedAt: "asc" },
    })
    : [];
  for (const e of comCombinado) {
    const v = vigentes.get(e.id)!;
    const diferenca = diferencaDoCombinado(v.baseSalary, v.salarioCombinado);
    if (diferenca == null) continue;
    const extratoLido = itemDe(e.id, ROTULO_13_EXTRATO_PARCELA_1);
    const extrato = extratoLido && String(extratoLido.status ?? "") === "CANCELED" ? undefined : extratoLido;
    // Diferença da gorjeta integral (decisão do Eli, 18/11/2026): o extrato já pagou a gorjeta declarada; soma-se o que a
    // integral tem a mais. Valor informado à mão no mês vale como gorjeta integral dele. Sem a média do extrato não há
    // como descontar a declarada: não soma e avisa (nunca paga a mais).
    const declarada = declaradas.get(String(e.cpf ?? "").replace(/\D/g, ""));
    const doDecimo = new Map((variaveis.informadas.get(e.id) ?? []).map((i) => [i.mes, i.valor] as const));
    const dasFerias = new Map([
      ...informadasDasFerias(titulosFerias.filter((t) => t.employeeId === e.id).map((t) => t.details), ano),
      ...informadasDaTabela(informadasDaTabelaPorPessoa.get(e.id) ?? [], ano),
    ]);
    const { integralPorMes, mesesApurados: mesesApuradosDif, mesesDasFerias } = gorjetaIntegralDoCombinado({
      apuracao: variaveis.gorjetaIntegral.get(e.id) ?? new Map(), apurados: variaveis.apurados, doDecimo, dasFerias,
    });
    if (mesesDasFerias.length > 0) {
      avisosCombinado.push(`${nomeDe(e)}: a gorjeta de ${mesesDasFerias.map((m) => mmaaaa(m, ano)).join(", ")} veio do valor informado à mão (complemento das férias; mês sem apuração). Confira.`);
    }
    if (!declarada && extrato && [...integralPorMes.values()].some((v) => v > 0)) {
      avisosCombinado.push(`${nomeDe(e)}: o extrato do 13º não trouxe a média de valores (gorjeta declarada) dele; a diferença da gorjeta integral não foi somada. Reimporte o extrato do 13º.`);
    }
    // Limite conhecido: o extrato da 2ª parcela ainda não é lido; a 2ª usa a mesma média declarada da 1ª.
    if (declarada && !avisosCombinado.some((a) => a.includes("gorjeta integral na 2ª parcela"))) {
      avisosCombinado.push("A diferença da gorjeta integral na 2ª parcela assume a mesma média declarada do extrato da 1ª: confira com o extrato da 2ª parcela da contabilidade antes de pagar.");
    }
    const calculo = calcularDecimoTerceiroSR({
      ano, salarioBase: diferenca, inicio: inicioDoCombinado(historicoCombinado.get(e.id) ?? []) ?? e.admissionDate,
      desligamento: null, diasAfastados: afastados.get(e.id),
      ...(declarada ? { variaveis: variaveisDaDiferencaDaGorjeta(integralPorMes, mediaDeclaradaMensal(declarada), mesesApuradosDif), mesesApurados: mesesApuradosDif } : {}),
    });
    // Sem avos neste ano (combinado muito recente): nada a mostrar.
    if (!calculo) continue;
    const primeiraSomada = primeiraSomadaDoExtrato(extrato);
    const proprias = parcelasDaLinha(itemDe, e.id, ROTULOS_COMBINADO, calculo, primeiraSomada);
    const p1 = resolverViaExtrato(extrato, proprias.p1, calculo.parcela1, nomeDe(e), avisosCombinado, { sujeito: "a diferença do salário combinado", pago: "paga", lancar: "lançá-la" });
    linhas.push({
      employeeId: e.id, nome: nomeDe(e), setor: e.sector, calculo, motivoSemCalculo: null,
      ...proprias, p1: p1.p1,
      preRegistro: false, semRegistroAte: null, registroEm: null, informadas: [], mesesFaltando: [], origem: "COMBINADO", rotulos: ROTULOS_COMBINADO, viaExtrato: p1.viaExtrato, primeiraSomada,
      somaNoExtrato: true, complementoDescricao: calculo.mediaParcela1 > 0 || calculo.mediaFinal > 0 ? DESCRICAO_COMBINADO_E_GORJETA : DESCRICAO_COMBINADO,
    });
  }
  const comSomaViva = new Set(linhas.filter((l) => l.somaNoExtrato && l.viaExtrato).map((l) => l.employeeId));
  const extratosEmAberto = await prisma.payrollItem.findMany({
    where: { type: "DECIMO_TERCEIRO", competenceYear: ano, periodLabel: ROTULO_13_EXTRATO_PARCELA_1, deletedAt: null, status: { not: "CANCELED" } },
    select: { employeeId: true, details: true, paymentDate: true, deletedAt: true, status: true },
  });
  const orfas = extratosEmAberto.filter((x) => !x.paymentDate && !x.deletedAt && String(x.status ?? "") !== "CANCELED" && foiSomado(x.details) && !comSomaViva.has(x.employeeId));
  if (orfas.length > 0) {
    avisosCombinado.push(`${orfas.length} título(s) do 13º do extrato ainda carregam um valor somado (diferença de salário combinado ou 13º do período sem registro) que não vale mais: lance a 1ª parcela para desfazer a soma antes de pagar.`);
  }
  const avisos = [...avisosDaBase(ano, variaveis.status, variaveis.apurados), ...avisosCombinado];
  return { ano, linhas, novembroFechado: variaveis.status.get(11) === "CLOSED", avisos, somasOrfas: orfas.length };
}

export type EntradaVariavel = { employeeId: string; ano: number; mes: number; valor: number; motivo: string };

// Valida a entrada de uma variável informada: erro em texto claro, ou null se está ok.
export function validarVariavelInformada(e: Partial<EntradaVariavel>): string | null {
  if (typeof e.employeeId !== "string" || e.employeeId === "" || e.employeeId.length > 64) return "Funcionário obrigatório.";
  if (!Number.isInteger(e.mes) || (e.mes as number) < 1 || (e.mes as number) > 11) return "Mês inválido: o 13º usa os meses de 1 a 11.";
  if (typeof e.valor !== "number" || !Number.isFinite(e.valor) || e.valor < 0 || e.valor > 1_000_000) return "Valor inválido.";
  if (typeof e.motivo !== "string" || e.motivo.trim().length < 5) return "Informe o motivo (mínimo 5 caracteres).";
  if (e.motivo.length > 300) return "Motivo muito longo (máximo 300 caracteres).";
  return null;
}

// Grava (ou troca) a variável do mês da pessoa. Devolve o valor anterior, para a auditoria.
export async function informarVariavelDecimo13(e: EntradaVariavel, userId: string): Promise<{ anterior: number | null }> {
  const emp = await prisma.employee.findFirst({ where: { id: e.employeeId, deletedAt: null }, select: { id: true } });
  if (!emp) throw new Error("Funcionário não encontrado.");
  const chave = { employeeId_ano_mes: { employeeId: e.employeeId, ano: e.ano, mes: e.mes } };
  const antes = await prisma.decimoTerceiroVariavel.findUnique({ where: chave, select: { valor: true } });
  const valor = round2(e.valor);
  await prisma.decimoTerceiroVariavel.upsert({
    where: chave,
    create: { id: crypto.randomUUID(), employeeId: e.employeeId, ano: e.ano, mes: e.mes, valor, motivo: e.motivo.trim(), criadoPorId: userId },
    update: { valor, motivo: e.motivo.trim(), atualizadoPorId: userId },
  });
  return { anterior: antes ? round2(Number(antes.valor)) : null };
}

export async function removerVariavelDecimo13(employeeId: string, ano: number, mes: number): Promise<{ anterior: number | null }> {
  const r = await prisma.decimoTerceiroVariavel.findUnique({ where: { employeeId_ano_mes: { employeeId, ano, mes } }, select: { valor: true } });
  if (!r) return { anterior: null };
  await prisma.decimoTerceiroVariavel.delete({ where: { employeeId_ano_mes: { employeeId, ano, mes } } });
  return { anterior: round2(Number(r.valor)) };
}

export type ResultadoGeracao = {
  ano: number; parcela: 1 | 2; criadas: number; atualizadas: number; restauradas: number; semCalculo: number; avisos: string[];
  // Diferenças do combinado somadas ao título do extrato (1ª parcela).
  somadas: number;
};

// Gera a parcela pedida. Parcela já lançada é atualizada se ainda não foi paga, o cálculo mudou e
// ninguém mexeu no valor; paga e excluída à mão ficam como estão; só o excluído sem autor volta.
export async function gerarDecimoTerceiroSR(ano: number, userId: string, parcela: 1 | 2 = 1): Promise<ResultadoGeracao> {
  // As parcelas caem em novembro e dezembro: mês de folha fechado não recebe lançamento novo.
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, 10, 1)), "Geração do 13º");
  await assertPeriodWritableForDate(new Date(Date.UTC(ano, 11, 1)), "Geração do 13º");
  let previa = await listarDecimoTerceiroSR(ano);
  if (parcela === 2 && !previa.novembroFechado) {
    throw new Error(`A gorjeta de ${mmaaaa(11, ano)} ainda não está fechada: a 2ª parcela depende da média até novembro. Feche a apuração e gere de novo.`);
  }
  // A soma da diferença do combinado vem ANTES: a 2ª parcela é o acerto do que a 1ª carrega no título, e a soma pode mudar a 1ª.
  let somadas = 0;
  const avisosDaSoma: string[] = [];
  try {
    const soma = await sincronizarCombinadoDoDecimo(ano, userId, previa);
    somadas = soma.alterados.length;
    avisosDaSoma.push(...soma.avisos);
    if (somadas > 0) previa = await listarDecimoTerceiroSR(ano);
  } catch (err) {
    // Nada foi gravado pela soma: refazer é seguro (a soma é absoluta), mas o erro não pode passar calado.
    avisosDaSoma.push(`Não foi possível somar o valor a mais (salário combinado ou período sem registro) ao título do extrato: ${(err as Error).message}. Gere de novo para somar.`);
  }
  const dre = await prisma.dRECategory.findFirst({ where: { name: FOLHA_CATEGORY }, select: { id: true } });
  const avisos: string[] = [...avisosDaSoma];
  let criadas = 0;
  let atualizadas = 0;
  let restauradas = 0;
  await prisma.$transaction(async (tx) => {
    for (const l of previa.linhas) {
      const c = l.calculo;
      if (!c) continue;
      // A diferença do combinado da 1ª parcela entra no título do extrato (ou aguarda o extrato): não vira lançamento próprio.
      // (inclusive quando o título somado já foi PAGO: a 1ª saiu dentro dele e criar outra pagaria duas vezes)
      if (l.somaNoExtrato && parcela === 1 && (l.viaExtrato || l.p1.aguardaExtrato || l.p1.conferir || l.p1.somadaAoExtrato)) continue;
      // 2ª da diferença com a 1ª ainda sem título (aguarda o extrato): gerar agora pagaria só o restante e a 1ª ficaria sem pagar.
      if (l.somaNoExtrato && parcela === 2 && (l.p1.aguardaExtrato || l.p1.conferir || (l.viaExtrato && l.p1.gerar))) {
        avisos.push(`${l.nome}: a 1ª parcela (${l.complementoDescricao ?? DESCRICAO_COMBINADO}) ainda não está resolvida no título do extrato do 13º (aguarda o extrato ou o título foi ajustado à mão); a 2ª só é gerada depois.`);
        continue;
      }
      const rotulo = parcela === 1 ? l.rotulos.p1 : l.rotulos.p2;
      // Trava a pessoa e relê dentro da transação: dois "Gerar" juntos não se atropelam.
      await travarFolhaDaPessoa(tx, l.employeeId);
      const atuais = await tx.payrollItem.findMany({
        where: { employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, periodLabel: { in: [l.rotulos.p1, l.rotulos.p2] } },
        select: { id: true, periodLabel: true, amount: true, paidAmount: true, paymentDate: true, deletedAt: true, deletedById: true, details: true },
      });
      const doRotulo = (r: string) => atuais.find((x) => x.periodLabel === r) ?? null;
      const atual = doRotulo(rotulo);
      // O valor da parcela: a 1ª é o calculado; a 2ª fecha o total com o que a 1ª PAGOU de fato.
      const valor = parcela === 1 ? c.parcela1 : segundaParcela(c.total, l.primeiraSomada ?? primeiraParaAcerto(doRotulo(l.rotulos.p1), c.parcela1)).valor;
      if (valor <= 0) continue;
      const decisao = decidirParcela(atual);
      if (decisao === "excluida-a-mao") {
        avisos.push(`${l.nome}: ${rotulo} foi excluída à mão e não foi recriada; se precisar, restaure pela Folha.`);
        continue;
      }
      if (decisao === "ja-pago") continue;
      const venc = parcela === 1 ? c.vencimento1 : c.vencimento2;
      const due = new Date(`${venc}T00:00:00.000Z`);
      const details = {
        ...(l.origem === "COMBINADO" ? { combinado: true } : { semRegistro: true }), decimoTerceiro: true, parcela, avos: c.avos, avosParcela1: c.avosParcela1, desde: c.desde,
        mediaParcela1: c.mediaParcela1, mediaFinal: c.mediaFinal, totalDecimo: c.total, valorCalculado: valor, memoria: c.memoria,
        ...(l.preRegistro ? { preRegistro: true, semRegistroAte: l.semRegistroAte, registroEm: l.registroEm } : {}),
      } as Prisma.InputJsonValue;
      if (decisao === "ja-existe") {
        const lancado = round2(Number(atual!.amount));
        if (Math.abs(lancado - valor) < 0.01) continue;
        // Só atualiza o que ninguém ajustou: o valor lançado ainda é o que este cálculo gerou antes.
        const calculadoAntes = Number((atual!.details as { valorCalculado?: unknown } | null)?.valorCalculado);
        if (!Number.isFinite(calculadoAntes) || Math.abs(calculadoAntes - lancado) >= 0.01) {
          avisos.push(`${l.nome}: ${rotulo} tem o valor ajustado à mão (${lancado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}); o cálculo de hoje dá ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Não foi alterada.`);
          continue;
        }
        const r = await tx.payrollItem.updateMany({
          where: { id: atual!.id, deletedAt: null, paymentDate: null },
          data: { amount: valor, details, dreCategoryId: dre?.id ?? null, updatedById: userId },
        });
        atualizadas += r.count;
        continue;
      }
      const dados = { dueDate: due, amount: valor, details, status: computeStatus(due, null), dreCategoryId: dre?.id ?? null };
      if (decisao === "restaurar") {
        // Condicionado ao estado lido: se alguém mexeu no meio, não conta nem grava.
        const r = await tx.payrollItem.updateMany({
          where: { id: atual!.id, deletedAt: { not: null }, deletedById: null, paymentDate: null },
          data: { ...dados, source: "GENERATED", updatedById: userId, deletedAt: null, deletedById: null },
        });
        restauradas += r.count;
        continue;
      }
      const r = await tx.payrollItem.createMany({
        data: [{
          id: crypto.randomUUID(), employeeId: l.employeeId, type: "DECIMO_TERCEIRO", competenceYear: ano, competenceMonth: parcela === 1 ? 11 : 12,
          periodLabel: rotulo, ...dados, source: "GENERATED", createdById: userId,
        }],
        skipDuplicates: true,
      });
      criadas += r.count;
    }
  }, { timeout: 30_000, maxWait: 10_000 });
  const semCalculo = previa.linhas.filter((l) => !l.calculo).length;
  return { ano, parcela, criadas, atualizadas, restauradas, semCalculo, somadas, avisos: [...previa.avisos, ...avisos] };
}

// Quem tem registro: só mostra o que o extrato da contabilidade já trouxe (o cálculo é dela).
export async function listarDecimoTerceiroClt(ano: number): Promise<LinhaDecimo13Clt[]> {
  const emps = await prisma.employee.findMany({
    where: { deletedAt: null, terminationDate: null, recebeDecimoTerceiro: true },
    select: { id: true, firstName: true, lastName: true, sector: true, modality: true, baseSalary: true, admissionDate: true, terminationDate: true },
    orderBy: [{ firstName: "asc" }],
  });
  const vigentes = await cadastrosVigentes(
    emps.map((e) => ({ ...e, baseSalary: e.baseSalary == null ? null : Number(e.baseSalary) })),
    () => diaRef(ano),
  );
  const clt = emps.filter((e) => vigentes.get(e.id)?.modality === "CLT");
  const itens = await prisma.payrollItem.findMany({
    where: { type: "DECIMO_TERCEIRO", competenceYear: ano, deletedAt: null, status: { not: "CANCELED" }, employeeId: { in: clt.map((e) => e.id) } },
    select: { employeeId: true, periodLabel: true, amount: true, status: true },
  });
  return montarLinhasClt(
    clt.map((e) => ({ employeeId: e.id, nome: nomeDe(e), setor: e.sector })),
    itens.map((i) => ({ ...i, amount: Number(i.amount), status: String(i.status) })),
  );
}
