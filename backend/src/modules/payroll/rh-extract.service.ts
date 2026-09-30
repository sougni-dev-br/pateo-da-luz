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

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() || full || "—";
  const lastName = parts.join(" ") || firstName;
  return { firstName, lastName };
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
async function converterAdiantamentoGravadoComoSalario(
  employeeId: string, competenceYear: number, competenceMonth: number, mmaaaa: string, periodLabel: string, liquido: number, userId: string,
) {
  const antigo = await prisma.payrollItem.findFirst({
    where: { employeeId, type: "SALARIO", competenceYear, competenceMonth, periodLabel: `Extrato ${mmaaaa}`, source: "EXTRATO_RH", deletedAt: null },
    select: { id: true, amount: true },
  });
  if (!antigo || Math.abs(Number(antigo.amount) - liquido) >= 0.01) return;
  const jaExiste = await prisma.payrollItem.findFirst({
    where: { employeeId, type: "ADIANTAMENTO", competenceYear, competenceMonth, periodLabel },
    select: { id: true },
  });
  if (jaExiste) return;
  await prisma.payrollItem.update({ where: { id: antigo.id }, data: { type: "ADIANTAMENTO", periodLabel, updatedById: userId } });
}

export type ImportExtratoResult = {
  calculo: CalculoExtrato;
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
  const tipo = adiantamento ? "ADIANTAMENTO" as const : "SALARIO" as const;
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

  const allEmp = await prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, cpf: true } });
  const byCpf = new Map(allEmp.map((e) => [onlyDigits(e.cpf), e.id]));
  const mmaaaa = `${String(competenceMonth).padStart(2, "0")}/${competenceYear}`;
  const periodLabel = adiantamento ? `Adiantamento ${mmaaaa}` : `Extrato ${mmaaaa}`;
  const details = (f: ExtratoFuncionario) => ({ calculo: parsed.calculo, liquido: f.liquido, gorjeta: f.gorjeta, adiantamento: f.adiantamento, empresa: parsed.empresa });

  let funcionariosCadastrados = 0;
  let titulosGerados = 0;
  for (const f of parsed.funcionarios) {
    let empId = f.cpfNorm ? byCpf.get(f.cpfNorm) : undefined;
    if (!empId) {
      const { firstName, lastName } = splitName(f.nome);
      const cpfValue = f.cpf || `SEMCPF-${crypto.randomUUID().slice(0, 8)}`;
      const emp = await prisma.employee.create({
        data: { id: crypto.randomUUID(), firstName, lastName, cpf: cpfValue, companyId, createdById: opts.userId },
      });
      empId = emp.id;
      funcionariosCadastrados += 1;
      if (f.cpfNorm) byCpf.set(f.cpfNorm, empId);
    }
    if (adiantamento) await converterAdiantamentoGravadoComoSalario(empId, competenceYear, competenceMonth, mmaaaa, periodLabel, f.liquido, opts.userId);
    await prisma.payrollItem.upsert({
      where: { employeeId_type_competenceYear_competenceMonth_periodLabel: { employeeId: empId, type: tipo, competenceYear, competenceMonth, periodLabel } },
      create: {
        id: crypto.randomUUID(), employeeId: empId, type: tipo, competenceYear, competenceMonth, periodLabel,
        dueDate, amount: f.liquido, dreCategoryId, source: "EXTRATO_RH",
        details: details(f), createdById: opts.userId,
      },
      // deletedAt/deletedById limpos de proposito: a chave unica nao inclui deletedAt, entao
      // este upsert casa com um item apagado. Sem limpar, ele atualizava o valor e deixava o
      // lancamento invisivel — a importacao dizia "titulo gerado" e o salario sumia do DRE.
      update: { amount: f.liquido, dueDate, dreCategoryId, source: "EXTRATO_RH", details: details(f), updatedById: opts.userId, deletedAt: null, deletedById: null },
    });
    titulosGerados += 1;
  }

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
  const avisos = await avisosDoExtrato({
    detalhes, calculo: parsed.calculo, competenceYear, competenceMonth, incluirDadosPessoais: opts.incluirDadosPessoais ?? false,
  });

  return {
    calculo: parsed.calculo, empresa: parsed.empresa, companyId, competenceYear, competenceMonth, totalLiquido, funcionariosCadastrados, titulosGerados,
    rhExtractId: rh.id, extratoAtualizado: rh.atualizado,
    pessoasLidas: detalhes.pessoas.length, pessoasConferidas: detalhes.pessoas.filter((p) => p.conferido).length, avisos,
  };
}
