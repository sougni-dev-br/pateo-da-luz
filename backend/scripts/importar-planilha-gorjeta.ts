// Importa a aba "Cadastro Funcionários" da planilha de apuração da gorjeta para o
// cadastro do ERP: quem participa, função, pontos personalizados, empresa,
// "sem registro" e a reserva da casa.
//
// Por padrão só SIMULA e mostra o que faria. Para gravar: --aplicar.
//   npx tsx scripts/importar-planilha-gorjeta.ts <planilha.xlsx> [--reserva "Ricardo Almeida"] [--aplicar]
//
// Casa o funcionário pelo nome (sem acento, sem caixa). Não mexe em salário, datas
// nem desligamento: divergências nesses campos só são listadas, para conferir à mão.

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
const aplicar = args.includes("--aplicar");
const iReserva = args.indexOf("--reserva");
const nomeReserva = iReserva >= 0 ? args[iReserva + 1] : "Ricardo Almeida";

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function valor(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) return (v as { result: unknown }).result;
  if (v && typeof v === "object" && "richText" in (v as Record<string, unknown>)) {
    return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join("");
  }
  return v;
}

const texto = (c: ExcelJS.Cell) => {
  const v = valor(c);
  return v == null ? "" : String(v).trim();
};
const numero = (c: ExcelJS.Cell) => {
  const v = valor(c);
  return typeof v === "number" ? v : v == null || v === "" ? null : Number(v);
};
const data = (c: ExcelJS.Cell) => {
  const v = valor(c);
  return v instanceof Date && !isNaN(v.getTime()) ? v : null;
};
// Palavras que a planilha e o cadastro escrevem de jeitos diferentes ("Jodeni Pereira de Oliveira").
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t && !LIGACOES.has(t));

const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

type Linha = {
  codigo: string; empresa: string; nome: string; funcao: string;
  pontosPers: number | null; salario: number | null; admissao: Date | null; desligamento: Date | null;
};

async function lerPlanilha(caminho: string): Promise<Linha[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.getWorksheet("Cadastro Funcionários");
  if (!ws) throw new Error('Aba "Cadastro Funcionários" não encontrada.');
  const linhas: Linha[] = [];
  for (let r = 5; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nome = texto(row.getCell(3));
    if (!nome) continue;
    linhas.push({
      codigo: texto(row.getCell(1)),
      empresa: texto(row.getCell(2)),
      nome,
      funcao: texto(row.getCell(5)),
      pontosPers: numero(row.getCell(7)),
      salario: numero(row.getCell(9)),
      admissao: data(row.getCell(10)),
      desligamento: data(row.getCell(11)),
    });
  }
  return linhas;
}

async function main() {
  if (!arquivo) throw new Error("Informe o caminho da planilha .xlsx.");
  const linhas = await lerPlanilha(arquivo);
  const [funcionarios, funcoes, empresas] = await Promise.all([
    prisma.employee.findMany({
      where: { deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, displayName: true, modality: true, baseSalary: true,
        admissionDate: true, terminationDate: true,
      },
    }),
    prisma.tipFunction.findMany(),
    prisma.company.findMany({ select: { id: true, tradeName: true, legalName: true } }),
  ]);

  const funcaoPorNome = new Map(funcoes.map((f) => [norm(f.name), f]));
  // Nome igual vence; senão, a única empresa que tem todas as palavras ("Pateo Frei" → "Pateo da Luz Frei").
  const acharEmpresa = (nome: string) => {
    const n = norm(nome);
    if (!n || n === "s registro") return null;
    const exata = empresas.find((c) => norm(c.tradeName) === n);
    if (exata) return exata;
    const alvo = tokens(nome);
    const contem = empresas.filter((c) => alvo.every((t) => tokens(c.tradeName).includes(t)));
    return contem.length === 1 ? contem[0] : null;
  };
  const acharFuncionario = (nome: string) => {
    const n = norm(nome);
    const alvo = tokens(nome);
    const candidatos = funcionarios.filter((f) => {
      if (norm(`${f.firstName} ${f.lastName}`) === n || (f.displayName && norm(f.displayName) === n)) return true;
      // Mesmo primeiro nome e todos os demais nomes da planilha presentes no cadastro.
      const partes = tokens(`${f.firstName} ${f.lastName}`);
      return partes[0] === alvo[0] && alvo.slice(1).every((p) => partes.includes(p));
    });
    return candidatos.length === 1 ? candidatos[0] : candidatos.length > 1 ? "AMBIGUO" as const : null;
  };

  let gravados = 0;
  const avisos: string[] = [];
  for (const l of linhas) {
    const emp = acharFuncionario(l.nome);
    const funcao = funcaoPorNome.get(norm(l.funcao)) ?? null;
    const empresa = acharEmpresa(l.empresa);
    const semRegistro = norm(l.empresa) === "s registro";
    const reserva = norm(l.nome) === norm(nomeReserva);
    const prefixo = `${l.codigo} ${l.nome}`;

    if (emp === null) { avisos.push(`${prefixo}: não achei no cadastro — cadastre em Funcionários e rode de novo.`); continue; }
    if (emp === "AMBIGUO") { avisos.push(`${prefixo}: mais de um funcionário com esse nome — ajuste à mão.`); continue; }
    if (!funcao && l.funcao) avisos.push(`${prefixo}: função "${l.funcao}" não existe na tabela.`);
    if (!empresa && !semRegistro && l.empresa) avisos.push(`${prefixo}: empresa "${l.empresa}" não encontrada.`);
    if (l.salario != null && Number(emp.baseSalary ?? 0) !== l.salario) {
      avisos.push(`${prefixo}: salário no ERP ${emp.baseSalary ?? "vazio"} × planilha ${l.salario} (não alterado).`);
    }
    if (dia(emp.admissionDate) !== dia(l.admissao)) {
      avisos.push(`${prefixo}: admissão no ERP ${dia(emp.admissionDate)} × planilha ${dia(l.admissao)} (não alterada).`);
    }
    if (dia(emp.terminationDate) !== dia(l.desligamento)) {
      avisos.push(`${prefixo}: desligamento no ERP ${dia(emp.terminationDate)} × planilha ${dia(l.desligamento)} (não alterado).`);
    }

    console.log(
      `${aplicar ? "GRAVA" : "SIMULA"} ${prefixo} → função ${funcao?.name ?? "—"}` +
      `${l.pontosPers != null ? `, ${l.pontosPers} pts pers.` : ""}` +
      `, ${semRegistro ? "sem registro" : `empresa ${empresa?.tradeName ?? "—"}`}${reserva ? ", RESERVA" : ""}`,
    );
    if (aplicar) {
      await prisma.employee.update({
        where: { id: emp.id },
        data: {
          participaGorjeta: true,
          tipoGorjeta: "PONTOS",
          tipFunctionId: funcao?.id ?? null,
          pontosPadrao: l.pontosPers,
          gorjetaReserva: reserva,
          ...(semRegistro ? { modality: "NAO_CLT" as const } : empresa ? { companyId: empresa.id } : {}),
        },
      });
      gravados += 1;
    }
  }

  console.log(`\n${linhas.length} linhas na planilha${aplicar ? `, ${gravados} gravadas` : " (simulação — nada gravado)"}.`);
  if (avisos.length) {
    console.log(`\nConferir (${avisos.length}):`);
    for (const a of avisos) console.log(" - " + a);
  }
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
