// Leitura do "Extrato Mensal" (holerite) devolvido pelo RH.
// Extrai, por empresa/competência: nome, CPF, líquido e gorjeta de cada funcionário.
// Usa pdf-parse (Node puro) — o texto vem sem layout de colunas, mas os rótulos
// (CPF:, Líquido:, GORJETA) permitem parsear com segurança.
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import { prisma } from "../../config/database.js";
import { FOLHA_CATEGORY } from "./payroll.service.js";
import { assertPeriodWritableForDate } from "../cmv-real/cmv-real.service.js";
import { lerDetalhesExtrato } from "./rh-extract-detalhes.js";
import { avisosDoExtrato, guardarExtrato, preencherAdmissaoCarteira } from "./rh-extract-store.service.js";
import { aposSaida, duplicadosDe, ehComplemento } from "./folha-duplicidade.js";
import { avisoGorjetaPendente, gorjetasDaCompetencia, mapaCombinados } from "./salario-combinado.service.js";
import { type GorjetaDaApuracao, gorjetaDaPessoa, salarioDaFolha } from "./salario-combinado-folha.js";
import { nomeProprio } from "../../shared/utils/nome-proprio.js";

export type ExtratoFuncionario = {
  nome: string;
  cpf: string;       // como veio no PDF (formatado)
  cpfNorm: string;   // apenas dígitos (para casar com o cadastro)
  liquido: number;
  gorjeta: number | null;
  // Adiantamento salarial descontado no mês (DESC.ADIANT.SALARIAL).
  adiantamento: number | null;
  // "Trabalhando", "Demitido", "Afastado"… como vem no extrato.
  situacao: string | null;
};

// O mesmo "Extrato Mensal" da contabilidade sai em dois cálculos: a folha do mês
// (líquido já sem o adiantamento) e o adiantamento do dia 20 ("Cálculo: Adiantamento").
export type CalculoExtrato = "MENSAL" | "ADIANTAMENTO";

export type ExtratoParsed = {
  calculo: CalculoExtrato;
  empresa: string;
  cnpj: string | null;
  competenceYear: number;
  competenceMonth: number;
  funcionarios: ExtratoFuncionario[];
};

function brToNumber(v: string): number {
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
export function onlyDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

export async function extrairTextoPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text ?? "";
}

export async function parseExtratoMensal(buffer: Buffer): Promise<ExtratoParsed> {
  return lerTextoExtrato(await extrairTextoPdf(buffer));
}

// Leitura do texto já extraído (separada para poder testar sem PDF).
export function lerTextoExtrato(txt: string): ExtratoParsed {

  // Cabeçalho (a pdf-parse embaralha rótulos/valores; captamos por padrão do valor).
  const cnpj = txt.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)?.[1] ?? null;
  const empresa = (txt.match(/\n([A-ZÀ-Ú][A-ZÀ-Ú0-9 .&'’\-]+LTDA)\b/)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const comp = txt.match(/EXTRATO MENSAL\s*\n?\s*(\d{2})\/(\d{4})/) ?? txt.match(/(\d{2})\/(\d{4})/);
  const competenceMonth = comp ? Number(comp[1]) : 0;
  const competenceYear = comp ? Number(comp[2]) : 0;
  const calculo: CalculoExtrato = /C[áa]lculo:\s*Adiantamento/i.test(txt) ? "ADIANTAMENTO" : "MENSAL";

  // Cada funcionário vai de "<matrícula> <NOME> Empr.:" até o próximo "NF:".
  const funcionarios: ExtratoFuncionario[] = [];
  const blockRe = /(\d+)\s+([A-ZÀ-Ú][A-ZÀ-Ú'’.\s]+?)\s*Empr\.:([\s\S]*?)NF:/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(txt))) {
    const nome = m[2].replace(/\s+/g, " ").trim();
    const body = m[3];
    const liq = body.match(/Informativa Dedutora:\s*\d+\s+([\d.,]+)/)?.[1];
    if (!liq) continue;
    const cpf = body.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/)?.[1] ?? "";
    // Gorjeta (conferência): valor-provento na linha da GORJETA. Tolerante ao layout —
    // pega o valor com centavos que aparece após o marcador de provento "P".
    const gor =
      body.match(/GORJETA[\s\S]{0,60}?\bP\b[\s\S]{0,6}?([\d]{1,3}(?:\.\d{3})*,\d{2})/)?.[1] ??
      body.match(/GORJETA[\s\S]{0,40}?([\d]{1,3}(?:\.\d{3})*,\d{2})/)?.[1] ??
      null;
    // Na folha do mês é o desconto (DESC.ADIANT.SALARIAL); no extrato do adiantamento é o
    // provento (980 ADIANTAMENTO SALARIAL), sem o troco do arredondamento.
    const adiant = calculo === "ADIANTAMENTO"
      ? body.match(/ADIANTAMENTO SALARIAL\s+P\s+(\d{1,3}(?:\.\d{3})*,\d{2})/)?.[1] ?? null
      : body.match(/DESC\.ADIANT\.SALARIAL\s+(\d{1,3}(?:\.\d{3})*,\d{2})/)?.[1] ?? null;
    const situacao = body.match(/(Trabalhando|Demitid[oa]|Afastad[oa]|F[ée]rias)\s+CPF:/)?.[1] ?? null;
    funcionarios.push({
      nome,
      cpf,
      cpfNorm: onlyDigits(cpf),
      liquido: brToNumber(liq),
      gorjeta: gor ? brToNumber(gor) : null,
      adiantamento: adiant ? brToNumber(adiant) : null,
      situacao,
    });
  }

  return { calculo, empresa, cnpj, competenceYear, competenceMonth, funcionarios };
}

// O extrato traz o nome em MAIÚSCULAS: o cadastro criado daqui já nasce no padrão (nome
// próprio) e com o nome inteiro em nomeCompleto. A divisão é pela 1ª palavra — prenome
// composto ("Ana Beatriz") se acerta à mão no cadastro.
export function splitName(full: string): { firstName: string; lastName: string; nomeCompleto: string | null } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() || full || "—";
  const lastName = parts.join(" ") || firstName;
  return {
    firstName: nomeProprio(firstName) ?? firstName,
    lastName: nomeProprio(lastName, { continuacao: true }) ?? lastName,
    nomeCompleto: nomeProprio(full)?.slice(0, 120) ?? null,
  };
}

// Categoria de DRE para a folha. Busca pelo MESMO nome exato que payroll.service usa.
//
// Antes isto era um findFirst fuzzy (contains "Salár" OR "Folha" OR "Pessoal") sem orderBy,
// e havia tres candidatas em producao: "Folha de Pagamento" (PESSOAL), "Folha de Pessoal"
// (DESPESAS_OPERACIONAIS) e "Provisão 13° Salário" (PLANEJAMENTO). O banco devolvia a que
// quisesse. Na pratica pegou "Folha de Pessoal", entao o salario de agosto/2026 foi parar
// em DESPESAS_OPERACIONAIS em vez de PESSOAL — e no mes seguinte poderia cair na PROVISAO.
// A soma do DRE nao muda; a LINHA muda, e muda sozinha.
//
// O fallback tambem criava a categoria com dreGroup "DESPESAS_OPERACIONAIS", divergindo do
// seed canonico de dre.routes.ts, que cria "Folha de Pagamento" em PESSOAL.
async function getFolhaDreCategoryId(): Promise<string> {
  const found = await prisma.dRECategory.findFirst({
    where: { name: FOLHA_CATEGORY },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.dRECategory.create({ data: { id: crypto.randomUUID(), name: FOLHA_CATEGORY, dreGroup: "PESSOAL" } });
  return created.id;
}

// Antes de o importador distinguir os dois cálculos, o extrato do adiantamento entrava
// como SALARIO ("Extrato MM/AAAA"). Reimportado, o mesmo título (mesma pessoa, mesmo
// valor) vira ADIANTAMENTO no lugar — mantém pagamento e histórico, sem duplicar.
// Só converte o SALARIO ativo (deletedAt null): excluído, à mão ou não, fica como está.
// E não converte se a chave do adiantamento já estiver ocupada, nem por item excluído —
// a chave única não inclui deletedAt, e o adiantamento excluído à mão continua excluído.
async function converterAdiantamentoGravadoComoSalario(
  employeeId: string, competenceYear: number, competenceMonth: number, mmaaaa: string, periodLabel: string, liquido: number, userId: string,
) {
  const antigo = await prisma.payrollItem.findFirst({
    where: { employeeId, type: "SALARIO", competenceYear, competenceMonth, periodLabel: `Extrato ${mmaaaa}`, source: "EXTRATO_RH", deletedAt: null },
    select: { id: true, amount: true },
  });
  if (!antigo || !mesmoValor(Number(antigo.amount), liquido)) return;
  const jaExiste = await prisma.payrollItem.findFirst({
    where: { employeeId, type: "ADIANTAMENTO", competenceYear, competenceMonth, periodLabel },
    select: { id: true },
  });
  if (jaExiste) return;
  await prisma.payrollItem.update({ where: { id: antigo.id }, data: { type: "ADIANTAMENTO", periodLabel, updatedById: userId } });
}

const mesmoValor = (a: number, b: number) => Math.abs(a - b) < 0.01;
const ehZero = (v: number) => Math.abs(v) < 0.005;

// Excluído À MÃO = alguém apagou pela tela (deletedById preenchido). Reimportar o extrato
// não pode desfazer essa decisão em silêncio: o lançamento fica excluído e a importação
// avisa. Excluído SEM deletedById é o caso legado (exclusões de antes de o sistema gravar
// quem excluiu): esse continua sendo restaurado. Não dá para saber se foi decisão de
// alguém, e o upsert casa com ele de qualquer jeito (a chave única não inclui deletedAt)
// — sem restaurar, atualizaria um item invisível: a importação diria "título gerado" e o
// salário sumiria do DRE.
type SituacaoDaChave = { deletedAt: Date | null; deletedById: string | null };
export function excluidoAMao(item: SituacaoDaChave | null | undefined): boolean {
  return Boolean(item?.deletedAt && item.deletedById);
}

const ddmmEmSaoPaulo = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);

export function avisoExcluidoAMao(nome: string, calculo: CalculoExtrato, mmaaaa: string, deletedAt: Date): string {
  const tipo = calculo === "ADIANTAMENTO" ? "Adiantamento" : "Salário";
  return `Lançamento de ${nome} (${tipo} ${mmaaaa}) foi excluído à mão em ${ddmmEmSaoPaulo(deletedAt)} e não foi recriado; se precisar, restaure pela Folha.`;
}

function chaveDoExtrato(calculo: CalculoExtrato, mmaaaa: string) {
  return calculo === "ADIANTAMENTO"
    ? { type: "ADIANTAMENTO" as const, periodLabel: `Adiantamento ${mmaaaa}` }
    : { type: "SALARIO" as const, periodLabel: `Extrato ${mmaaaa}` };
}

// Quantas pessoas do extrato já têm o lançamento dele no Contas a Pagar. Reimportar
// atualiza esses (o upsert casa pela chave), não duplica — a tela precisa dizer isso.
// Não conta o que a importação vai PULAR (excluído à mão) nem o excluído legado, que
// volta como novo. No adiantamento conta também o SALARIO "Extrato" gravado antes que
// vai ser convertido — só o ativo e de mesmo valor, o mesmo critério da conversão.
export async function contarLancamentosExistentes(
  pessoas: Array<{ employeeId: string; liquido: number }>, calculo: CalculoExtrato, competenceYear: number, competenceMonth: number,
): Promise<number> {
  if (pessoas.length === 0) return 0;
  const mmaaaa = `${String(competenceMonth).padStart(2, "0")}/${competenceYear}`;
  const chave = chaveDoExtrato(calculo, mmaaaa);
  const salarioAntigo = { type: "SALARIO" as const, periodLabel: `Extrato ${mmaaaa}` };
  const chaves = calculo === "ADIANTAMENTO" ? [chave, salarioAntigo] : [chave];
  const itens = await prisma.payrollItem.findMany({
    where: { employeeId: { in: [...new Set(pessoas.map((p) => p.employeeId))] }, competenceYear, competenceMonth, OR: chaves },
    select: { employeeId: true, type: true, periodLabel: true, amount: true, source: true, deletedAt: true },
  });
  const contados = new Set<string>();
  for (const p of pessoas) {
    const doEmp = itens.filter((i) => i.employeeId === p.employeeId);
    const principal = doEmp.find((i) => i.type === chave.type && i.periodLabel === chave.periodLabel);
    if (principal) {
      if (principal.deletedAt == null) contados.add(p.employeeId);
      continue;
    }
    const vaiConverter = calculo === "ADIANTAMENTO" && doEmp.some((i) =>
      i.type === "SALARIO" && i.periodLabel === salarioAntigo.periodLabel && i.source === "EXTRATO_RH"
      && i.deletedAt == null && mesmoValor(Number(i.amount), p.liquido));
    if (vaiConverter) contados.add(p.employeeId);
  }
  return contados.size;
}

// O mesmo pagamento (pessoa + tipo + competência) já vivo com OUTRO rótulo: o gerado pela
// folha ("Salário"), o lançado à mão. A chave única inclui o rótulo e não pega esse caso.
// Complemento não conta (é pagamento a mais, de propósito).
async function outroDoMesmoPagamento(chave: { employeeId: string; type: "SALARIO" | "ADIANTAMENTO"; competenceYear: number; competenceMonth: number; periodLabel: string }) {
  const vivos = await prisma.payrollItem.findMany({
    where: {
      employeeId: chave.employeeId, type: chave.type, competenceYear: chave.competenceYear, competenceMonth: chave.competenceMonth,
      deletedAt: null, status: { not: "CANCELED" }, NOT: { periodLabel: chave.periodLabel },
    },
    select: { id: true, employeeId: true, type: true, competenceYear: true, competenceMonth: true, periodLabel: true, periodStart: true, details: true, status: true, deletedAt: true, paymentDate: true, amount: true },
  });
  return duplicadosDe(chave, vivos.filter((v) => !ehComplemento(v.details)))[0] ?? null;
}

const brl = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmmaaaa = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

// Adiantamento tirado da folha do mês: só quando o mês ainda não tem o adiantamento
// daquela pessoa (ativo ou excluído — o excluído à mão continua excluído). Devolve se criou.
export async function lancarAdiantamentoDaFolha(a: {
  employeeId: string; competenceYear: number; competenceMonth: number; mmaaaa: string; valor: number;
  diaAdiantamento: number; dreCategoryId: string | null; empresa: string; userId: string;
}): Promise<boolean> {
  const periodLabel = `Adiantamento ${a.mmaaaa}`;
  const chave = { employeeId: a.employeeId, type: "ADIANTAMENTO" as const, competenceYear: a.competenceYear, competenceMonth: a.competenceMonth, periodLabel };
  const existe = await prisma.payrollItem.findUnique({
    where: { employeeId_type_competenceYear_competenceMonth_periodLabel: chave }, select: { id: true },
  });
  if (existe) return false;
  // Adiantamento do mês já lançado com outro rótulo (gerado pela folha, à mão): é o mesmo.
  if (await outroDoMesmoPagamento({ employeeId: a.employeeId, type: "ADIANTAMENTO", competenceYear: a.competenceYear, competenceMonth: a.competenceMonth, periodLabel })) return false;
  const ultimoDia = new Date(Date.UTC(a.competenceYear, a.competenceMonth, 0)).getUTCDate();
  await prisma.payrollItem.create({
    data: {
      id: crypto.randomUUID(), ...chave,
      dueDate: new Date(Date.UTC(a.competenceYear, a.competenceMonth - 1, Math.min(a.diaAdiantamento, ultimoDia))),
      amount: Math.round(a.valor * 100) / 100, dreCategoryId: a.dreCategoryId, source: "EXTRATO_RH",
      details: {
        calculo: "ADIANTAMENTO", origem: "FOLHA_DO_MES", empresa: a.empresa, adiantamentoBruto: a.valor,
        observacao: "Tirado do desconto DESC.ADIANT.SALARIAL da folha do mês: valor bruto (antes do IRRF retido, sem o troco).",
      },
      createdById: a.userId,
    },
  });
  return true;
}

export type ImportExtratoResult = {
  calculo: CalculoExtrato;
  // Dos títulos gravados, quantos já existiam (foram atualizados) e quantos são novos
  // (criados, ou excluídos antigos sem autor restaurados).
  titulosAtualizados: number;
  titulosNovos: number;
  // Não gravados: excluídos à mão (cada um vira aviso) e líquido zero sem lançamento.
  titulosPulados: number;
  // Folha do mês: adiantamentos criados a partir do desconto da folha (sem o extrato do dia 20).
  adiantamentosDaFolha: number;
  empresa: string;
  companyId: string;
  competenceYear: number;
  competenceMonth: number;
  totalLiquido: number;
  funcionariosCadastrados: number;
  titulosGerados: number;
  rhExtractId: string;
  // O mesmo arquivo já estava guardado: o registro foi completado, não duplicado.
  extratoAtualizado: boolean;
  pessoasLidas: number;
  pessoasConferidas: number;
  avisos: string[];
};

// Importa o extrato: casa/cria empresa e funcionários, gera os salários no Contas a Pagar
// (PayrollItem SALARIO, com vínculo ao DRE) e registra o extrato para rastreabilidade.
export async function importExtrato(opts: {
  buffer: Buffer; userId: string; fileName: string; storagePath?: string; sha256?: string; dueDay?: number;
  incluirDadosPessoais?: boolean;
}): Promise<ImportExtratoResult> {
  const texto = await extrairTextoPdf(opts.buffer);
  const parsed = lerTextoExtrato(texto);
  if (parsed.funcionarios.length === 0) throw new Error("Nenhum funcionário lido do extrato.");
  const { competenceYear, competenceMonth } = parsed;
  if (!competenceYear || !competenceMonth) throw new Error("Competência não identificada no extrato.");

  // Importar o extrato GRAVA folha na competencia lida do PDF. Se aquele mes ja foi
  // fechado, a importacao reescrevia despesa de pessoal de um mes apurado, em silencio.
  // A trava so pode ficar aqui: a rota nao sabe a competencia antes de ler o arquivo.
  // Lanca porque a rota devolve 422 com esta mensagem — quem importou precisa saber
  // que nada entrou, e por que.
  await assertPeriodWritableForDate(
    new Date(Date.UTC(competenceYear, competenceMonth - 1, 1)),
    "Importacao do extrato do RH"
  );

  // Empresa por CNPJ (compara por dígitos); cria se não existir.
  const cnpjNorm = onlyDigits(parsed.cnpj ?? "");
  const companies = await prisma.company.findMany({ select: { id: true, cnpj: true } });
  let companyId = companies.find((c) => onlyDigits(c.cnpj) === cnpjNorm && cnpjNorm)?.id;
  if (!companyId) {
    const code = "RH-" + (cnpjNorm.slice(0, 12) || Date.now().toString());
    const created = await prisma.company.create({
      data: { id: crypto.randomUUID(), code, tradeName: parsed.empresa || code, legalName: parsed.empresa || code, cnpj: parsed.cnpj || code },
    });
    companyId = created.id;
  }

  const settings = await prisma.payrollSettings.findUnique({ where: { id: "singleton" } });
  const adiantamento = parsed.calculo === "ADIANTAMENTO";
  let dueDate: Date;
  if (adiantamento) {
    // Adiantamento vence no próprio mês da competência, no dia do adiantamento (20).
    const dia = opts.dueDay ?? settings?.advanceDueDay ?? 20;
    dueDate = new Date(Date.UTC(competenceYear, competenceMonth - 1, Math.min(dia, 28)));
  } else {
    // Salário da competência vence no mês seguinte, no dia configurado.
    const dueDay = opts.dueDay ?? settings?.salaryDueDay ?? 5;
    let ny = competenceYear, nm = competenceMonth + 1;
    if (nm > 12) { nm = 1; ny += 1; }
    dueDate = new Date(Date.UTC(ny, nm - 1, Math.min(dueDay, 28)));
  }
  const dreCategoryId = await getFolhaDreCategoryId();

  const allEmp = await prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, cpf: true, terminationDate: true } });
  const byCpf = new Map(allEmp.map((e) => [onlyDigits(e.cpf), e.id]));
  const saidaDe = new Map(allEmp.map((e) => [e.id, e.terminationDate ?? null]));
  const mmaaaa = `${String(competenceMonth).padStart(2, "0")}/${competenceYear}`;
  const { type: tipo, periodLabel } = chaveDoExtrato(parsed.calculo, mmaaaa);
  const details = (f: ExtratoFuncionario) => ({ calculo: parsed.calculo, liquido: f.liquido, gorjeta: f.gorjeta, adiantamento: f.adiantamento, empresa: parsed.empresa });

  // Salário combinado vigente na competência (folha do mês): o SALARIO vai pelo valor integral.
  const combinados = adiantamento ? new Map<string, number>() : await mapaCombinados(competenceYear, competenceMonth,
    parsed.funcionarios.map((f) => (f.cpfNorm ? byCpf.get(f.cpfNorm) : undefined)).filter((x): x is string => Boolean(x)));
  const avisosDaImportacao: string[] = [];
  // Gorjeta da competência: só calculada se alguém tiver combinado, e uma vez.
  let gorjetas: Map<string, GorjetaDaApuracao> | null | undefined;
  const gorjetaDe = async (employeeId: string) => {
    if (gorjetas === undefined) {
      try { gorjetas = await gorjetasDaCompetencia(competenceYear, competenceMonth); } catch (err) {
        gorjetas = null;
        avisosDaImportacao.push(`Não foi possível calcular a gorjeta de ${mmaaaa} para os salários combinados: ${(err as Error).message}`);
      }
    }
    return gorjetaDaPessoa(gorjetas, employeeId);
  };
  // Valor e detalhes do lançamento: o líquido do extrato, ou o integral de quem tem combinado.
  const lancamento = async (f: ExtratoFuncionario, empId: string) => {
    const combinado = combinados.get(empId);
    if (combinado == null) return { valor: f.liquido, detalhes: details(f) };
    const calc = salarioDaFolha({ liquidoExtrato: f.liquido, adiantamento: f.adiantamento, combinado, gorjeta: await gorjetaDe(empId) });
    if (calc.pendenteGorjeta) avisosDaImportacao.push(avisoGorjetaPendente(f.nome));
    if (calc.aviso) avisosDaImportacao.push(`Salário combinado de ${f.nome}: ${calc.aviso}.`);
    return { valor: calc.valor, detalhes: { ...details(f), ...calc.detalhes } };
  };

  let funcionariosCadastrados = 0;
  let titulosAtualizados = 0;
  let titulosNovos = 0;
  let titulosPulados = 0;
  let zerados = 0;
  let adiantamentosDaFolha = 0;
  for (const f of parsed.funcionarios) {
    let empId = f.cpfNorm ? byCpf.get(f.cpfNorm) : undefined;
    if (!empId) {
      const { firstName, lastName, nomeCompleto } = splitName(f.nome);
      const cpfValue = f.cpf || `SEMCPF-${crypto.randomUUID().slice(0, 8)}`;
      const emp = await prisma.employee.create({
        data: { id: crypto.randomUUID(), firstName, lastName, nomeCompleto, cpf: cpfValue, companyId, createdById: opts.userId },
      });
      empId = emp.id;
      funcionariosCadastrados += 1;
      if (f.cpfNorm) byCpf.set(f.cpfNorm, empId);
    }
    // Competência depois do desligamento: nada é lançado (o holerite fica guardado).
    const saida = saidaDe.get(empId) ?? null;
    if (aposSaida({ employeeId: empId, type: tipo, competenceYear, competenceMonth }, saida)) {
      titulosPulados += 1;
      avisosDaImportacao.push(`${f.nome} saiu em ${ddmmaaaa(saida!)}: ${tipo === "ADIANTAMENTO" ? "adiantamento" : "salário"} de ${mmaaaa} não lançado (competência depois da saída).`);
      continue;
    }
    if (adiantamento) await converterAdiantamentoGravadoComoSalario(empId, competenceYear, competenceMonth, mmaaaa, periodLabel, f.liquido, opts.userId);
    // Folha do mês sem o extrato do adiantamento: o desconto DESC.ADIANT.SALARIAL diz quanto
    // foi adiantado no dia 20. Sem lançamento de adiantamento no mês, cria um a partir dele
    // (valor bruto: antes do IRRF retido e sem o troco). O extrato do adiantamento, se vier
    // depois, cai na mesma chave e acerta para o valor pago.
    if (!adiantamento && (f.adiantamento ?? 0) > 0 && await lancarAdiantamentoDaFolha({
      employeeId: empId, competenceYear, competenceMonth, mmaaaa, valor: f.adiantamento!,
      diaAdiantamento: settings?.advanceDueDay ?? 20, dreCategoryId, empresa: parsed.empresa, userId: opts.userId,
    })) adiantamentosDaFolha += 1;

    const chaveUnica = { employeeId: empId, type: tipo, competenceYear, competenceMonth, periodLabel };
    const existente = await prisma.payrollItem.findUnique({
      where: { employeeId_type_competenceYear_competenceMonth_periodLabel: chaveUnica },
      select: { id: true, deletedAt: true, deletedById: true, paymentDate: true },
    });
    if (existente && excluidoAMao(existente)) {
      titulosPulados += 1;
      avisosDaImportacao.push(avisoExcluidoAMao(f.nome, parsed.calculo, mmaaaa, existente.deletedAt!));
      continue;
    }
    const ativo = Boolean(existente && existente.deletedAt == null);
    // Já pago: o valor e o detalhe ficam como foram pagos. Reimportar só avisa a diferença.
    if (ativo && existente!.paymentDate != null) {
      titulosPulados += 1;
      avisosDaImportacao.push(`${f.nome}: ${tipo === "ADIANTAMENTO" ? "adiantamento" : "salário"} de ${mmaaaa} já pago: não atualizado (extrato traz ${brl(f.liquido)}).`);
      continue;
    }
    // Líquido zero não vira lançamento novo (nem restaura um excluído): fica só no
    // holerite guardado. O lançamento que já está ativo não é apagado: segue sendo
    // atualizado com o valor do extrato, como sempre (inclusive para zero).
    if (!ativo && ehZero(f.liquido)) {
      titulosPulados += 1;
      zerados += 1;
      continue;
    }
    // Ia criar (ou restaurar) o lançamento do extrato, mas o mesmo pagamento já existe com
    // outro rótulo: não cria o segundo. Avisa com os dois valores para conferir à mão.
    const jaLancado = ativo ? null : await outroDoMesmoPagamento(chaveUnica);
    if (jaLancado) {
      titulosPulados += 1;
      avisosDaImportacao.push(
        `${f.nome}: ${tipo === "ADIANTAMENTO" ? "adiantamento" : "salário"} de ${mmaaaa} já está na Folha como "${jaLancado.periodLabel}" ` +
        `(${brl(jaLancado.amount)}, ${jaLancado.paymentDate ? "pago" : "em aberto"}); o extrato (${brl(f.liquido)}) não criou outro. Confira o valor à mão.`,
      );
      continue;
    }
    const { valor, detalhes } = await lancamento(f, empId);
    if (existente) {
      await prisma.payrollItem.update({
        where: { id: existente.id },
        // deletedAt/deletedById limpos de propósito: aqui só chega o ativo ou o excluído
        // legado (sem autor), que volta a aparecer — ver excluidoAMao.
        data: { amount: valor, dueDate, dreCategoryId, source: "EXTRATO_RH", details: detalhes, updatedById: opts.userId, deletedAt: null, deletedById: null },
      });
    } else {
      await prisma.payrollItem.create({
        data: {
          id: crypto.randomUUID(), ...chaveUnica, dueDate, amount: valor, dreCategoryId, source: "EXTRATO_RH",
          details: detalhes, createdById: opts.userId,
        },
      });
    }
    if (ativo) titulosAtualizados += 1; else titulosNovos += 1;
  }
  if (zerados > 0) {
    avisosDaImportacao.push(`${zerados} pessoa(s) com líquido zero no extrato: nenhum lançamento novo foi criado (ficam só no holerite guardado).`);
  }
  if (adiantamentosDaFolha > 0) {
    avisosDaImportacao.push(
      `${adiantamentosDaFolha} adiantamento(s) de ${mmaaaa} lançado(s) a partir do desconto da folha (vencimento dia ${settings?.advanceDueDay ?? 20}): ` +
      "valor bruto, antes do IRRF retido e sem o troco. Importe o extrato do adiantamento para acertar o valor pago.",
    );
  }
  const titulosGerados = titulosAtualizados + titulosNovos;

  const totalLiquido = Math.round(parsed.funcionarios.reduce((a, f) => a + f.liquido, 0) * 100) / 100;
  // O PDF, o texto e o holerite de cada pessoa vão para o banco (o disco do servidor é efêmero).
  const detalhes = lerDetalhesExtrato(texto);
  const rh = await guardarExtrato({
    parsed, detalhes, buffer: opts.buffer, texto,
    sha256: opts.sha256 ?? crypto.createHash("sha256").update(opts.buffer).digest("hex"),
    fileName: opts.fileName, storagePath: opts.storagePath ?? null, companyId, userId: opts.userId, totalLiquido,
    employeePorCpf: byCpf,
  });
  await preencherAdmissaoCarteira(detalhes, byCpf, opts.userId);
  const avisosDoPdf = await avisosDoExtrato({
    detalhes, calculo: parsed.calculo, competenceYear, competenceMonth, incluirDadosPessoais: opts.incluirDadosPessoais ?? false,
  });

  return {
    calculo: parsed.calculo, empresa: parsed.empresa, companyId, competenceYear, competenceMonth, totalLiquido, funcionariosCadastrados, titulosGerados,
    titulosAtualizados, titulosNovos, titulosPulados, adiantamentosDaFolha,
    rhExtractId: rh.id, extratoAtualizado: rh.atualizado,
    pessoasLidas: detalhes.pessoas.length, pessoasConferidas: detalhes.pessoas.filter((p) => p.conferido).length,
    avisos: [...avisosDaImportacao, ...avisosDoPdf],
  };
}
