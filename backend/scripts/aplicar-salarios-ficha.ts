// Confere o salário do cadastro com o da "Ficha de Registro de Empregado" (PDF da contabilidade)
// e, com --aplicar, lança no histórico do cadastro o que faltar.
//
//   TZ=UTC npx tsx scripts/aplicar-salarios-ficha.ts <ficha.pdf> [<outra.pdf> ...] --desde=AAAA-MM-DD
//       [--motivo="Dissídio 2026"] [--aplicar [--producao]]
//
// Por padrão só SIMULA: lista, por pessoa, cada degrau da ficha a partir de --desde que o
// cadastro ainda não tem. Nada antes de --desde é mexido. Todos os degraus de uma pessoa entram
// numa transação só, no histórico, com a data de vigência da ficha e o motivo (o cadastro exige
// motivo quando a mudança é retroativa); o salário atual passa a ser o do último degrau. O plano
// é refeito DENTRO da transação, com a pessoa travada. Rodar de novo não duplica e completa uma
// aplicação que tenha parado no meio.
//
// Não grava: desligado, vigência antes da admissão do cadastro, vigência futura, pessoa cujo
// cadastro já tem mudança de salário à mão na janela. Esses casos só são listados.
//
// O texto do PDF sai do `pdftotext -layout` (Poppler; no Windows vem com o Git Bash). Casa pelo
// CPF; ficha sem funcionário no ERP só é listada. Os PDFs têm CPF, RG e endereço: não copie
// para dentro do repositório.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { serializar } from "../src/modules/payroll/cadastro-historico.js";
import { lerFichasRegistro } from "../src/modules/payroll/ficha-registro-parser.js";
import { ORIGEM_FICHA } from "../src/modules/payroll/ficha-registro.js";
import { travarFolhaDaPessoa } from "../src/modules/payroll/folha-trava.js";
import {
  ORIGEM_SALARIO_FICHA, type PassoPlanejado, passosDaFicha, planejarSalarios, textoDoPasso,
} from "../src/modules/payroll/salarios-da-ficha.js";
import { auditLog } from "../src/modules/security/security-utils.js";
import { conferirDestino } from "../src/lib/destino-banco.js";

const args = process.argv.slice(2);
const arquivos = args.filter((a) => !a.startsWith("--"));
if (arquivos.length === 0) throw new Error("Informe o PDF da ficha de registro.");
const valorDe = (nome: string) => args.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? null;
const desde = valorDe("desde");
if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error("Informe a data inicial: --desde=AAAA-MM-DD (ex.: --desde=2026-11-01).");
const MOTIVO_PADRAO = "Dissídio 2026, conforme ficha de registro da contabilidade";
const motivo = (valorDe("motivo") ?? MOTIVO_PADRAO).trim().slice(0, 300);
// Mesma exigência do cadastro para mudança retroativa de salário: pelo menos 5 letras.
if ((motivo.match(/\p{L}/gu)?.length ?? 0) < 5) throw new Error("--motivo precisa ter pelo menos 5 letras.");
const { host, aplicar } = conferirDestino(args, process.env.DATABASE_URL);
console.log(`Banco de destino: ${host}${aplicar ? " (GRAVANDO)" : " (simulação)"} · a partir de ${desde.split("-").reverse().join("/")}`);
if (process.env.TZ !== "UTC") console.warn("Aviso: rode com TZ=UTC (as datas de produção são em UTC).");

const prisma = new PrismaClient();
const soDigitos = (s: string) => s.replace(/\D/g, "");
// "Hoje" em São Paulo, como a rota do cadastro: entre 21h e meia-noite o UTC já é o dia seguinte.
const hojeIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const primeiroNome = (s: string) => s.trim().split(/\s+/)[0]?.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase() ?? "";
const reais = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dia = (d: Date) => d.toISOString().slice(0, 10);

function textoDoPdf(arquivo: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", arquivo, "-"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`Não consegui ler ${arquivo} com o pdftotext (instale o Poppler ou rode pelo Git Bash): ${e instanceof Error ? e.message : e}`);
  }
}

type Ficha = ReturnType<typeof lerFichasRegistro>[number];
type Resultado = "gravado" | "simulado" | "em-dia" | "sem-cadastro" | "duplicado" | "revisar";
type Cliente = Pick<PrismaClient, "employee" | "employeeHistorico">;

// Lê a pessoa e o histórico de salário e monta o plano. Usado antes (para mostrar) e de novo
// dentro da transação (para gravar o que vale naquele instante).
async function planoDe(db: Cliente, employeeId: string, f: Ficha) {
  const emp = await db.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true, isActive: true, baseSalary: true, admissionDate: true, terminationDate: true },
  });
  const atual = emp.baseSalary == null ? null : Number(emp.baseSalary);
  const linhas = await db.employeeHistorico.findMany({
    where: { employeeId, campo: "baseSalary" },
    select: { campo: true, valorAnterior: true, valorNovo: true, vigenteDesde: true, createdAt: true, origem: true },
  });
  return { emp, atual, plano: planejarSalarios(passosDaFicha(f, desde!), linhas, atual, desde!) };
}

// Por que um plano não pode ser gravado sozinho (vazio = pode).
function impedimentos(emp: { terminationDate: Date | null; admissionDate: Date | null }, passos: readonly PassoPlanejado[]): string[] {
  const motivos: string[] = [];
  if (emp.terminationDate) motivos.push("desligado: mexer no salário retroativo muda a rescisão; confira à mão.");
  if (passos.some((p) => p.vigencia > hojeIso)) motivos.push("há degrau com vigência futura: não é gravado por este script.");
  const admissao = emp.admissionDate ? dia(emp.admissionDate) : null;
  if (admissao && passos.some((p) => p.vigencia < admissao)) {
    motivos.push(`há degrau com vigência anterior à admissão do cadastro (${admissao.split("-").reverse().join("/")}): o cadastro recusaria; corrija a admissão antes.`);
  }
  return motivos;
}

async function conferirUma(f: Ficha): Promise<Resultado> {
  // Cadastros antigos guardam o CPF com pontuação: procura as duas formas.
  const achados = await prisma.employee.findMany({ where: { cpf: { in: [soDigitos(f.cpf), f.cpf] }, deletedAt: null }, select: { id: true } });
  if (achados.length === 0) return "sem-cadastro";
  if (achados.length > 1) {
    console.log(`● ${f.nome}: ${achados.length} cadastros com o mesmo CPF — pulada, resolver o duplicado antes.`);
    return "duplicado";
  }
  const { emp, atual, plano } = await planoDe(prisma, achados[0].id, f);
  console.log(`● ${f.nome} → ${emp.firstName} ${emp.lastName}${emp.isActive ? "" : " [inativo]"} · salário atual ${reais(atual)}`);
  const confere = primeiroNome(f.nome) === primeiroNome(emp.firstName);
  if (!confere) console.log("  ⚠ o primeiro nome da ficha não é o do cadastro (CPF igual): confira antes de gravar.");
  for (const a of plano.avisos) console.log(`  ⚠ ${a}`);
  if (plano.avisos.length > 0 || !confere) return "revisar";
  if (plano.passos.length === 0) {
    console.log("  em dia: o cadastro já tem os degraus da ficha.");
    return "em-dia";
  }
  for (const p of plano.passos) console.log(`  + ${textoDoPasso(p)}`);
  const barreiras = impedimentos(emp, plano.passos);
  for (const b of barreiras) console.log(`  ⚠ ${b}`);
  if (barreiras.length > 0) return "revisar";
  // Só informa: o histórico por vigência recalcula folha e gorjeta dos meses a partir da data.
  const [anoDesde, mesDesde] = [Number(desde!.slice(0, 4)), Number(desde!.slice(5, 7))];
  const pagos = await prisma.payrollItem.count({
    where: {
      employeeId: emp.id, deletedAt: null, paymentDate: { not: null },
      OR: [{ competenceYear: { gt: anoDesde } }, { competenceYear: anoDesde, competenceMonth: { gte: mesDesde } }],
    },
  });
  if (pagos > 0) console.log(`  ℹ ${pagos} lançamento(s) de folha já pago(s) a partir de ${String(mesDesde).padStart(2, "0")}/${anoDesde}: o recálculo desses meses usa o salário novo.`);
  if (!aplicar) return "simulado";

  // Tudo da pessoa numa transação, com ela travada, refazendo o plano com o que está no banco agora
  // (alguém pode ter editado o cadastro entre a simulação e a gravação).
  const gravado = await prisma.$transaction(async (tx) => {
    await travarFolhaDaPessoa(tx, emp.id);
    const agora = await planoDe(tx, emp.id, f);
    if (agora.plano.avisos.length > 0 || impedimentos(agora.emp, agora.plano.passos).length > 0) return null;
    if (agora.plano.passos.length === 0) return [];
    // createdAt explícito e crescente: o histórico reproduz na ordem em que foi REGISTRADO, e as
    // linhas de uma mesma transação nasceriam com o mesmo instante.
    const base = Date.now();
    await tx.employeeHistorico.createMany({
      data: agora.plano.passos.map((p, i) => ({
        id: crypto.randomUUID(), employeeId: emp.id, campo: "baseSalary",
        valorAnterior: serializar("baseSalary", p.antes), valorNovo: serializar("baseSalary", p.valor),
        vigenteDesde: new Date(`${p.vigencia}T00:00:00.000Z`), motivo, origem: ORIGEM_SALARIO_FICHA,
        criadoPorId: null, criadoPorNome: "Script: salários da ficha de registro", createdAt: new Date(base + i),
      })),
    });
    await tx.employee.update({ where: { id: emp.id }, data: { baseSalary: agora.plano.passos[agora.plano.passos.length - 1].valor } });
    return agora.plano.passos;
  }, { timeout: 30_000 });
  if (gravado === null) {
    console.log("  ⚠ o cadastro mudou entre a simulação e a gravação: nada foi gravado para esta pessoa. Rode de novo.");
    return "revisar";
  }
  if (gravado.length === 0) return "em-dia";
  // Só datas e contagem: os valores já estão no histórico do cadastro. O salário já está gravado:
  // falha de auditoria é avisada, não vira "erro" da pessoa.
  try {
    await auditLog({
      userId: null, action: "APLICAR_SALARIOS_FICHA_REGISTRO", entity: "Employee", entityId: emp.id,
      newValue: { origem: ORIGEM_FICHA, registro: f.registro, degraus: gravado.length, vigencias: gravado.map((p) => p.vigencia), motivo },
    });
  } catch (e) {
    console.log(`  ⚠ salário gravado, mas a auditoria falhou: ${e instanceof Error ? e.message : e}`);
  }
  return "gravado";
}

async function main() {
  const fichas = arquivos.flatMap((a) => {
    try {
      return lerFichasRegistro(textoDoPdf(a));
    } catch (e) {
      throw new Error(`${a}: ${e instanceof Error ? e.message : e} — nada foi gravado.`);
    }
  });
  console.log(`${fichas.length} ficha(s) lida(s) de ${arquivos.length} arquivo(s).\n`);
  const resultado = new Map<Resultado | "erro", string[]>();
  for (const f of fichas) {
    // Erro numa pessoa não para as outras; cada pessoa é uma transação e rodar de novo é seguro.
    let r: Resultado | "erro";
    try {
      r = await conferirUma(f);
    } catch (e) {
      console.log(`● ${f.nome}: ERRO — ${e instanceof Error ? e.message : e}`);
      r = "erro";
    }
    resultado.set(r, [...(resultado.get(r) ?? []), f.nome]);
  }
  const lista = (k: Resultado | "erro") => resultado.get(k) ?? [];
  console.log("");
  if (lista("sem-cadastro").length) console.log(`Sem cadastro no ERP (não conferidas): ${lista("sem-cadastro").join("; ")}`);
  if (lista("revisar").length) console.log(`Para revisar à mão (nada gravado): ${lista("revisar").join("; ")}`);
  if (lista("duplicado").length) console.log(`CPF em mais de um cadastro (puladas): ${lista("duplicado").join("; ")}`);
  if (lista("erro").length) { console.log(`Com erro: ${lista("erro").join("; ")}`); process.exitCode = 1; }
  console.log(`Em dia: ${lista("em-dia").length} · a ajustar: ${lista("simulado").length + lista("gravado").length}`);
  console.log(aplicar ? `Gravado: ${lista("gravado").length} funcionário(s).` : "Simulação: nada foi gravado. Para gravar, --aplicar.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
