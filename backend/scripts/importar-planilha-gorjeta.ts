// Importa a aba "Cadastro Funcionários" da planilha de apuração da gorjeta para o
// cadastro do ERP: quem participa, função, ponto extra (pontos da planilha − função), empresa,
// e vínculo: quem tem empresa na planilha vira CLT; "s registro" vira sem registro. A linha da reserva (Ricardo Almeida na planilha) não vira
// funcionário nem é importada: a reserva agora é 0 e o que sobra vai sozinho ao fundo.
//
// Por padrão só SIMULA e mostra o que faria. Para gravar: --aplicar.
//   npx tsx scripts/importar-planilha-gorjeta.ts <planilha.xlsx> [--reserva "Ricardo Almeida"] [--aplicar]
//
// Casa o funcionário pelo nome completo (sem acento, sem caixa, ignorando "de/da/do").
// Nome parecido mas não igual NÃO é gravado: aparece na lista para conferir (use
// --aceitar-aproximados só depois de conferir). Grava como a tela de Equipe: com
// linha no histórico de função/pontos e registro de auditoria. Não mexe em
// salário, datas nem desligamento: divergências só são listadas. Quando o vínculo
// muda (CLT ↔ sem registro), a linha mostra "vínculo X → Y" para conferir.

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { registrarHistorico } from "../src/modules/payroll/tip-historico.service.js";
import { auditLog } from "../src/modules/security/security-utils.js";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
const aplicar = args.includes("--aplicar");
const aceitarAproximados = args.includes("--aceitar-aproximados");
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

// Data de vigência do histórico: --vigencia AAAA-MM-DD (padrão: hoje).
const iVig = args.indexOf("--vigencia");
const vigencia = (() => {
  const v = iVig >= 0 ? args[iVig + 1] : null;
  const d = v ? new Date(`${v}T00:00:00.000Z`) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
})();

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
    // Igual (sem "de/da/do"): casa com segurança.
    const iguais = funcionarios.filter((f) => {
      const cad = tokens(`${f.firstName} ${f.lastName}`).join(" ");
      return cad === alvo.join(" ") || norm(`${f.firstName} ${f.lastName}`) === n || (f.displayName && norm(f.displayName) === n);
    });
    if (iguais.length === 1) return { emp: iguais[0], exato: true };
    if (iguais.length > 1) return "AMBIGUO" as const;
    // Parecido: mesmo primeiro nome e os nomes da planilha contidos no cadastro. Só com confirmação.
    const parecidos = funcionarios.filter((f) => {
      const partes = tokens(`${f.firstName} ${f.lastName}`);
      return partes[0] === alvo[0] && alvo.slice(1).every((p) => partes.includes(p));
    });
    return parecidos.length === 1 ? { emp: parecidos[0], exato: false } : parecidos.length > 1 ? "AMBIGUO" as const : null;
  };

  let gravados = 0;
  const avisos: string[] = [];
  for (const l of linhas) {
    const achado = acharFuncionario(l.nome);
    const funcao = funcaoPorNome.get(norm(l.funcao)) ?? null;
    const empresa = acharEmpresa(l.empresa);
    const semRegistro = norm(l.empresa) === "s registro";
    const reserva = norm(l.nome) === norm(nomeReserva);
    const prefixo = `${l.codigo} ${l.nome}`;
    if (reserva) {
      const pontos = l.pontosPers ?? funcao?.points ?? null;
      console.log(`RESERVA ${prefixo} (${pontos ?? "?"} pts) → não é importada; a reserva fica 0 e o saldo do mês vai sozinho ao fundo (saldo inicial já lançado pela migration).`);
      continue;
    }

    if (achado === null) { avisos.push(`${prefixo}: não achei no cadastro — cadastre em Funcionários e rode de novo.`); continue; }
    if (achado === "AMBIGUO") { avisos.push(`${prefixo}: mais de um funcionário com esse nome — ajuste à mão.`); continue; }
    const emp = achado.emp;
    if (!achado.exato) {
      avisos.push(`${prefixo}: casado por aproximação com "${emp.firstName} ${emp.lastName}"${aceitarAproximados ? " (aceito)" : " — NÃO gravado; confira e rode com --aceitar-aproximados"}.`);
      if (!aceitarAproximados) continue;
    }
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

    // A planilha traz os pontos finais; o ERP guarda a diferença para a função como extra.
    const vinculoNovo = semRegistro ? "NAO_CLT" as const : empresa ? "CLT" as const : null;
    const mudaVinculo = vinculoNovo != null && vinculoNovo !== emp.modality;
    const nomeVinculo = (m: string | null) => (m === "CLT" ? "CLT" : m === "NAO_CLT" ? "sem registro" : "—");

    const extraBruto = l.pontosPers == null ? null : l.pontosPers - Number(funcao?.points ?? 0);
    const extra = extraBruto == null || Math.abs(extraBruto) < 0.005 ? null : Math.round(extraBruto * 100) / 100;
    console.log(
      `${aplicar ? "GRAVA" : "SIMULA"} ${prefixo} → função ${funcao?.name ?? "—"}` +
      `${extra != null ? `, extra ${extra > 0 ? "+" : ""}${extra} pt (planilha ${l.pontosPers})` : ""}` +
      `, ${semRegistro ? "sem registro" : `empresa ${empresa?.tradeName ?? "—"}`}` +
      `${mudaVinculo ? ` (vínculo ${nomeVinculo(emp.modality)} → ${nomeVinculo(vinculoNovo)})` : ""}`,
    );
    if (aplicar) {
      const dados = {
        participaGorjeta: true,
        tipoGorjeta: "PONTOS" as const,
        tipFunctionId: funcao?.id ?? null,
        pontosExtra: extra,
        pontosExtraMotivo: extra == null ? null : `Planilha de gorjeta (${l.codigo}): ${l.pontosPers} pts no lugar de ${Number(funcao?.points ?? 0)}`,
        ...(vinculoNovo ? { modality: vinculoNovo } : {}),
        ...(!semRegistro && empresa ? { companyId: empresa.id } : {}),
      };
      await prisma.$transaction(async (tx) => {
        await tx.employee.update({ where: { id: emp.id }, data: dados });
        await registrarHistorico(tx, emp.id, vigencia, "script-importacao", `Importação da planilha (${l.codigo})`);
      });
      await auditLog({ userId: null, action: "IMPORT_TIP_TEAM_MEMBER", entity: "Employee", entityId: emp.id, newValue: { ...dados, origem: arquivo } });
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
