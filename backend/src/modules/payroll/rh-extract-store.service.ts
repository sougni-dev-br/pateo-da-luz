// Armazenamento completo do "Extrato Mensal": o PDF, o texto e o holerite de cada
// pessoa (RhExtract + RhExtractPessoa + RhExtractRubrica), mais os avisos que só o
// extrato completo permite dar (rescisão não lançada, cadastro divergente).
import crypto from "node:crypto";
import { prisma } from "../../config/database.js";
import { diaDeReferencia } from "./cadastro-historico.js";
import { cadastrosVigentes } from "./cadastro-historico.service.js";
import type { CalculoExtrato, ExtratoParsed } from "./rh-extract.service.js";
import { funcionariosSemCpf, semCpf, type DetalhesExtrato, type PessoaExtrato } from "./rh-extract-detalhes.js";

const dataOuNull = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// Mesmo arquivo (sha256) = mesmo extrato: reimportar completa o registro em vez de duplicar.
// Registros antigos não têm sha256; casam pelo conteúdo (competência, CNPJ, pessoas e total).
async function extratoExistente(opts: {
  sha256: string; competenceYear: number; competenceMonth: number; cnpj: string | null; headcount: number; totalLiquido: number;
}) {
  const porSha = await prisma.rhExtract.findFirst({ where: { sha256: opts.sha256 }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (porSha) return porSha;
  return prisma.rhExtract.findFirst({
    where: {
      sha256: null, competenceYear: opts.competenceYear, competenceMonth: opts.competenceMonth,
      cnpj: opts.cnpj, headcount: opts.headcount, totalLiquido: opts.totalLiquido,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

function dadosPessoa(p: PessoaExtrato, employeeId: string | null) {
  return {
    id: crypto.randomUUID(),
    employeeId,
    matricula: p.matricula,
    nome: p.nome,
    situacao: p.situacao,
    vinculo: p.vinculo,
    horasMes: p.horasMes,
    cargoCodigo: p.cargoCodigo,
    cargo: p.cargo,
    cbo: p.cbo,
    salarioBase: p.salarioBase,
    admissao: dataOuNull(p.admissao),
    demissao: dataOuNull(p.demissao),
    demissaoMotivo: p.demissaoMotivo,
    proventos: p.proventos,
    descontos: p.descontos,
    liquido: p.liquido,
    baseInss: p.baseInss,
    baseFgts: p.baseFgts,
    baseIrrf: p.baseIrrf,
    valorFgts: p.valorFgts,
    liquidoRescisao: p.liquidoRescisao,
    conferido: p.conferido,
    texto: p.texto,
    rubricas: {
      create: p.rubricas.map((r) => ({
        id: crypto.randomUUID(), codigo: r.codigo, descricao: r.descricao, tipo: r.tipo, referencia: r.referencia, valor: r.valor,
      })),
    },
  };
}

export async function guardarExtrato(opts: {
  parsed: ExtratoParsed;
  detalhes: DetalhesExtrato;
  buffer: Buffer;
  texto: string;
  sha256: string;
  fileName: string;
  storagePath?: string | null;
  companyId: string;
  userId: string;
  totalLiquido: number;
  // CPF (só dígitos) → employeeId, já resolvido pelo importador.
  employeePorCpf: Map<string, string>;
}): Promise<{ id: string; atualizado: boolean }> {
  const { parsed, detalhes } = opts;
  const existente = await extratoExistente({
    sha256: opts.sha256, competenceYear: parsed.competenceYear, competenceMonth: parsed.competenceMonth,
    cnpj: parsed.cnpj, headcount: parsed.funcionarios.length, totalLiquido: opts.totalLiquido,
  });
  // O CPF só serve para casar com o cadastro durante a importação: não vai para o
  // registro (nem no texto, nem na lista de funcionários). O PDF em "arquivo" continua
  // com ele — é o documento original, servido só a quem pode ver Funcionários.
  const comum = {
    competenceYear: parsed.competenceYear, competenceMonth: parsed.competenceMonth, empresa: parsed.empresa, cnpj: parsed.cnpj,
    companyId: opts.companyId, totalLiquido: opts.totalLiquido, headcount: parsed.funcionarios.length,
    fileName: opts.fileName, sha256: opts.sha256, data: funcionariosSemCpf(parsed.funcionarios) as object,
    calculo: parsed.calculo, arquivo: opts.buffer, texto: semCpf(opts.texto), emissao: dataOuNull(detalhes.emissao),
    totalProventos: detalhes.totalProventos, totalDescontos: detalhes.totalDescontos,
  };

  // Tudo ou nada: um extrato não pode ficar com metade das pessoas regravadas.
  const id = await prisma.$transaction(async (tx) => {
    let rhId: string;
    if (existente) {
      // storagePath antigo fica: é o único rastro de onde o arquivo morava antes.
      await tx.rhExtract.update({ where: { id: existente.id }, data: comum });
      await tx.rhExtractPessoa.deleteMany({ where: { rhExtractId: existente.id } });
      rhId = existente.id;
    } else {
      const novo = await tx.rhExtract.create({
        data: { id: crypto.randomUUID(), ...comum, storagePath: opts.storagePath ?? null, importedById: opts.userId },
        select: { id: true },
      });
      rhId = novo.id;
    }
    // O mesmo arquivo importado mais de uma vez (antes do armazenamento completo, cada
    // importação criava um registro): fica um só, o que acabou de ser gravado.
    await tx.rhExtract.deleteMany({ where: { sha256: opts.sha256, id: { not: rhId } } });
    for (const p of detalhes.pessoas) {
      const employeeId = p.cpfNorm ? opts.employeePorCpf.get(p.cpfNorm) ?? null : null;
      await tx.rhExtractPessoa.create({ data: { ...dadosPessoa(p, employeeId), rhExtractId: rhId } });
    }
    return rhId;
  }, { timeout: 30_000 });

  return { id, atualizado: Boolean(existente) };
}

// Admissão em carteira vem do extrato: preenche só quem ainda não tem (a data que alguém
// já gravou no cadastro não é sobrescrita; se divergir, sai no aviso).
export async function preencherAdmissaoCarteira(detalhes: DetalhesExtrato, employeePorCpf: Map<string, string>, userId: string): Promise<number> {
  let n = 0;
  for (const p of detalhes.pessoas) {
    const employeeId = p.cpfNorm ? employeePorCpf.get(p.cpfNorm) : undefined;
    if (!employeeId || !p.admissao) continue;
    const r = await prisma.employee.updateMany({
      where: { id: employeeId, admissaoCarteira: null },
      data: { admissaoCarteira: new Date(`${p.admissao}T00:00:00Z`), updatedById: userId },
    });
    n += r.count;
  }
  return n;
}

// ─── Avisos (nunca bloqueiam a importação) ──────────────────────────────────

type EmpCadastro = {
  id: string; cpf: string; baseSalary: unknown; position: string | null; admissaoCarteira: Date | null;
};

function demitidoNoMes(p: PessoaExtrato, ano: number, mes: number): boolean {
  return Boolean(p.demissao) && Number(p.demissao!.slice(0, 4)) === ano && Number(p.demissao!.slice(5, 7)) === mes;
}

export async function avisosDoExtrato(opts: {
  detalhes: DetalhesExtrato;
  calculo: CalculoExtrato;
  competenceYear: number;
  competenceMonth: number;
  // Sem ver Funcionários, os avisos não trazem salário, líquido nem valores do cadastro.
  incluirDadosPessoais: boolean;
}): Promise<string[]> {
  const { detalhes, competenceYear: ano, competenceMonth: mes } = opts;
  if (detalhes.pessoas.length === 0) return [];
  const atuais = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, cpf: true, baseSalary: true, position: true, admissaoCarteira: true },
  });
  // Compara com o salário e o cargo VIGENTES no mês do extrato, não com os de hoje:
  // um aumento lançado depois não vira divergência num extrato antigo.
  const vigentes = await cadastrosVigentes(
    atuais.map((e) => ({ ...e, baseSalary: e.baseSalary == null ? null : Number(e.baseSalary) })),
    () => diaDeReferencia(ano, mes, null),
  );
  const emps: EmpCadastro[] = atuais.map((e) => vigentes.get(e.id) ?? e);
  const porCpf = new Map(emps.map((e) => [soDigitos(e.cpf), e]));
  const avisos: string[] = [];

  for (const p of detalhes.pessoas) {
    const emp = p.cpfNorm ? porCpf.get(p.cpfNorm) : undefined;

    if (!p.conferido) {
      avisos.push(opts.incluirDadosPessoais
        ? `Leitura de ${p.nome} não fechou (rubricas somam ${brl(p.somaProventos)} / ${brl(p.somaDescontos)}; extrato diz ${brl(p.proventos)} / ${brl(p.descontos)}): confira no PDF.`
        : `Leitura de ${p.nome} não fechou (a soma das rubricas não bate com o extrato): confira no PDF.`);
    }

    const rescisao = (p.liquidoRescisao ?? 0) > 0 || demitidoNoMes(p, ano, mes);
    if (rescisao && !(emp && await temRescisaoLancada(emp.id, p, ano, mes))) {
      const liq = p.liquidoRescisao ?? p.liquido;
      const quando = p.demissao ? `, demitido em ${ddmm(p.demissao)}` : "";
      avisos.push(opts.incluirDadosPessoais
        ? `Rescisão de ${p.nome} no extrato (líquido ${brl(liq)}${quando}): confira se está lançada em Contas a Pagar.`
        : `Rescisão de ${p.nome} no extrato${quando}: confira se está lançada em Contas a Pagar.`);
    }

    if (emp) avisos.push(...divergenciasDoCadastro(p, emp, opts.incluirDadosPessoais, `${String(mes).padStart(2, "0")}/${ano}`));
  }
  return avisos;
}

// Rescisão lançada = PayrollItem RESCISAO ativo da pessoa a partir do mês anterior à saída
// (a rescisão paga no início do mês costuma ter competência do mês da demissão).
async function temRescisaoLancada(employeeId: string, p: PessoaExtrato, ano: number, mes: number): Promise<boolean> {
  const ref = p.demissao ? Number(p.demissao.slice(0, 4)) * 12 + Number(p.demissao.slice(5, 7)) : ano * 12 + mes;
  const itens = await prisma.payrollItem.findMany({
    where: { employeeId, type: "RESCISAO", deletedAt: null },
    select: { competenceYear: true, competenceMonth: true },
  });
  return itens.some((i) => i.competenceYear * 12 + i.competenceMonth >= ref - 1);
}

function divergenciasDoCadastro(p: PessoaExtrato, emp: EmpCadastro, comValores: boolean, comp: string): string[] {
  const out: string[] = [];
  const salCad = emp.baseSalary == null ? null : Number(emp.baseSalary);
  if (p.salarioBase != null && salCad != null && Math.abs(p.salarioBase - salCad) > 0.01) {
    out.push(comValores
      ? `${p.nome}: salário base no extrato de ${comp} é ${brl(p.salarioBase)}, no cadastro ${brl(salCad)}. O cadastro não foi alterado.`
      : `${p.nome}: salário base no extrato de ${comp} difere do cadastro. O cadastro não foi alterado.`);
  }
  if (p.cargo && emp.position && semAcento(p.cargo) !== semAcento(emp.position)) {
    out.push(`${p.nome}: cargo no extrato de ${comp} é "${p.cargo}", no cadastro "${emp.position}". O cadastro não foi alterado.`);
  }
  // Compara com a admissão em carteira, não com o início real (esse pode ser antes do
  // registro). Vazia no cadastro: a importação preenche, não é divergência.
  const admCad = emp.admissaoCarteira ? emp.admissaoCarteira.toISOString().slice(0, 10) : null;
  if (p.admissao && admCad && p.admissao !== admCad) {
    out.push(`${p.nome}: admissão em carteira no extrato é ${ddmmaaaa(p.admissao)}, no cadastro ${ddmmaaaa(admCad)}. O cadastro não foi alterado.`);
  }
  return out;
}
