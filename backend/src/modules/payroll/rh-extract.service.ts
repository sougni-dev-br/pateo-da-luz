// Leitura do "Extrato Mensal" (holerite) devolvido pelo RH.
// Extrai, por empresa/competência: nome, CPF, líquido e gorjeta de cada funcionário.
// Usa pdf-parse (Node puro) — o texto vem sem layout de colunas, mas os rótulos
// (CPF:, Líquido:, GORJETA) permitem parsear com segurança.
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import { prisma } from "../../config/database.js";

export type ExtratoFuncionario = {
  nome: string;
  cpf: string;       // como veio no PDF (formatado)
  cpfNorm: string;   // apenas dígitos (para casar com o cadastro)
  liquido: number;
  gorjeta: number | null;
};

export type ExtratoParsed = {
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

export async function parseExtratoMensal(buffer: Buffer): Promise<ExtratoParsed> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  const txt = result.text ?? "";

  // Cabeçalho (a pdf-parse embaralha rótulos/valores; captamos por padrão do valor).
  const cnpj = txt.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)?.[1] ?? null;
  const empresa = (txt.match(/\n([A-ZÀ-Ú][A-ZÀ-Ú0-9 .&'’\-]+LTDA)\b/)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const comp = txt.match(/EXTRATO MENSAL\s*\n?\s*(\d{2})\/(\d{4})/) ?? txt.match(/(\d{2})\/(\d{4})/);
  const competenceMonth = comp ? Number(comp[1]) : 0;
  const competenceYear = comp ? Number(comp[2]) : 0;

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
    funcionarios.push({
      nome,
      cpf,
      cpfNorm: onlyDigits(cpf),
      liquido: brToNumber(liq),
      gorjeta: gor ? brToNumber(gor) : null,
    });
  }

  return { empresa, cnpj, competenceYear, competenceMonth, funcionarios };
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  const firstName = parts.shift() || full || "—";
  const lastName = parts.join(" ") || firstName;
  return { firstName, lastName };
}

// Categoria de DRE para a folha (busca existente; cria "Folha de Pagamento" se não houver).
async function getFolhaDreCategoryId(): Promise<string> {
  const found = await prisma.dRECategory.findFirst({
    where: { OR: [{ name: { contains: "Salár", mode: "insensitive" } }, { name: { contains: "Folha", mode: "insensitive" } }, { name: { contains: "Pessoal", mode: "insensitive" } }] },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.dRECategory.create({ data: { id: crypto.randomUUID(), name: "Folha de Pagamento", dreGroup: "DESPESAS_OPERACIONAIS" } });
  return created.id;
}

export type ImportExtratoResult = {
  empresa: string;
  companyId: string;
  competenceYear: number;
  competenceMonth: number;
  totalLiquido: number;
  funcionariosCadastrados: number;
  titulosGerados: number;
  rhExtractId: string;
};

// Importa o extrato: casa/cria empresa e funcionários, gera os salários no Contas a Pagar
// (PayrollItem SALARIO, com vínculo ao DRE) e registra o extrato para rastreabilidade.
export async function importExtrato(opts: {
  buffer: Buffer; userId: string; fileName: string; storagePath?: string; sha256?: string; dueDay?: number;
}): Promise<ImportExtratoResult> {
  const parsed = await parseExtratoMensal(opts.buffer);
  if (parsed.funcionarios.length === 0) throw new Error("Nenhum funcionário lido do extrato.");
  const { competenceYear, competenceMonth } = parsed;
  if (!competenceYear || !competenceMonth) throw new Error("Competência não identificada no extrato.");

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
  const dueDay = opts.dueDay ?? settings?.salaryDueDay ?? 5;
  // Salário da competência vence no mês seguinte, no dia configurado.
  let ny = competenceYear, nm = competenceMonth + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  const dueDate = new Date(Date.UTC(ny, nm - 1, Math.min(dueDay, 28)));
  const dreCategoryId = await getFolhaDreCategoryId();

  const allEmp = await prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, cpf: true } });
  const byCpf = new Map(allEmp.map((e) => [onlyDigits(e.cpf), e.id]));
  const periodLabel = `Extrato ${String(competenceMonth).padStart(2, "0")}/${competenceYear}`;

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
    await prisma.payrollItem.upsert({
      where: { employeeId_type_competenceYear_competenceMonth_periodLabel: { employeeId: empId, type: "SALARIO", competenceYear, competenceMonth, periodLabel } },
      create: {
        id: crypto.randomUUID(), employeeId: empId, type: "SALARIO", competenceYear, competenceMonth, periodLabel,
        dueDate, amount: f.liquido, dreCategoryId, source: "EXTRATO_RH",
        details: { liquido: f.liquido, gorjeta: f.gorjeta, empresa: parsed.empresa }, createdById: opts.userId,
      },
      update: { amount: f.liquido, dueDate, dreCategoryId, source: "EXTRATO_RH", details: { liquido: f.liquido, gorjeta: f.gorjeta, empresa: parsed.empresa }, updatedById: opts.userId },
    });
    titulosGerados += 1;
  }

  const totalLiquido = Math.round(parsed.funcionarios.reduce((a, f) => a + f.liquido, 0) * 100) / 100;
  const rh = await prisma.rhExtract.create({
    data: {
      id: crypto.randomUUID(), competenceYear, competenceMonth, empresa: parsed.empresa, cnpj: parsed.cnpj,
      companyId, totalLiquido, headcount: parsed.funcionarios.length,
      fileName: opts.fileName, storagePath: opts.storagePath ?? null, sha256: opts.sha256 ?? null,
      data: parsed.funcionarios as unknown as object, importedById: opts.userId,
    },
  });

  return { empresa: parsed.empresa, companyId, competenceYear, competenceMonth, totalLiquido, funcionariosCadastrados, titulosGerados, rhExtractId: rh.id };
}
