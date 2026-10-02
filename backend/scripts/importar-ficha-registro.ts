// Importa a "Ficha de Registro de Empregado" (PDF da contabilidade) para o cadastro.
//
//   TZ=UTC npx tsx scripts/importar-ficha-registro.ts <ficha.pdf> [<outra.pdf> ...] [--aplicar [--producao]]
//
// Por padrão só SIMULA e lista, por pessoa, o que preencheria e as divergências. O texto do PDF
// sai do `pdftotext -layout` (Poppler; no Windows vem com o Git Bash), que mantém as colunas.
//
// Casa pelo CPF; ficha sem funcionário no ERP só é listada (não cria cadastro). Só preenche
// campo vazio — ver ficha-registro.ts. Dependentes, férias e carteira são regravados a cada
// importação. Nada aqui muda salário, cargo, vínculo, empresa, admissão ou turno.
//
// Os PDFs têm CPF, RG, PIS e endereço: não copie para dentro do repositório.

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { lerFichasRegistro } from "../src/modules/payroll/ficha-registro-parser.js";
import { ORIGEM_FICHA, planoDaFicha } from "../src/modules/payroll/ficha-registro.js";
import { regravarListasDaFicha } from "../src/modules/payroll/ficha-registro.service.js";
import { auditLog } from "../src/modules/security/security-utils.js";
import { conferirDestino } from "../src/lib/destino-banco.js";

const args = process.argv.slice(2);
const arquivos = args.filter((a) => !a.startsWith("--"));
if (arquivos.length === 0) throw new Error("Informe o PDF da ficha de registro.");
const { host, aplicar } = conferirDestino(args, process.env.DATABASE_URL);
console.log(`Banco de destino: ${host}${aplicar ? " (GRAVANDO)" : " (simulação)"}`);
if (process.env.TZ !== "UTC") console.warn("Aviso: rode com TZ=UTC (as datas de produção são em UTC).");

const prisma = new PrismaClient();
const soDigitos = (s: string) => s.replace(/\D/g, "");

function textoDoPdf(arquivo: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", arquivo, "-"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`Não consegui ler ${arquivo} com o pdftotext (instale o Poppler ou rode pelo Git Bash): ${e instanceof Error ? e.message : e}`);
  }
}

type Ficha = ReturnType<typeof lerFichasRegistro>[number];

// Uma ficha: confere, mostra o plano e (com --aplicar) grava numa transação. Devolve o que
// aconteceu para o resumo do fim.
async function importarUma(f: Ficha): Promise<"gravado" | "simulado" | "sem-cadastro" | "duplicado"> {
  // Cadastros antigos guardam o CPF com pontuação ("123.456.789-09"): procura as duas formas.
  const achados = await prisma.employee.findMany({
    where: { cpf: { in: [soDigitos(f.cpf), f.cpf] }, deletedAt: null },
    include: { company: { select: { cnpj: true } } },
  });
  if (achados.length === 0) return "sem-cadastro";
  if (achados.length > 1) {
    console.log(`● ${f.nome}: ${achados.length} cadastros com o mesmo CPF (com e sem pontuação) — não importada, resolver o duplicado antes.`);
    return "duplicado";
  }
  const [atual] = achados;
  const plano = planoDaFicha(atual, f);
  const campos = Object.keys(plano.dados);
  console.log(`● ${f.nome} → ${atual.firstName} ${atual.lastName}${atual.isActive ? "" : " [inativo]"}`);
  console.log(`  preenche (${campos.length}): ${campos.join(", ") || "nada"}`);
  console.log(`  dependentes ${plano.dependentes.length} · férias ${plano.ferias.length} · carteira ${plano.anotacoes.length}`);
  for (const a of plano.avisos) console.log(`  ⚠ ${a}`);
  if (!aplicar) return "simulado";

  await prisma.$transaction(async (tx) => {
    if (campos.length) await tx.employee.update({ where: { id: atual.id }, data: plano.dados });
    await regravarListasDaFicha(tx, atual.id, plano);
  }, { timeout: 30_000 }); // banco remoto: o padrão de 5 s é curto para 6 escritas
  // Só os NOMES dos campos e contagens: o valor (RG, PIS, endereço, filiação) já está no
  // cadastro e não precisa de uma segunda cópia no log.
  await auditLog({
    userId: null, action: "IMPORT_FICHA_REGISTRO", entity: "Employee", entityId: atual.id,
    newValue: { origem: ORIGEM_FICHA, registro: f.registro, camposPreenchidos: campos, dependentes: plano.dependentes.length, ferias: plano.ferias.length, carteira: plano.anotacoes.length, avisos: plano.avisos.length },
  });
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
  const resultado = new Map<string, string[]>();
  for (const f of fichas) {
    // Erro numa pessoa não para as outras; cada uma é uma transação e reimportar é seguro.
    let r: string;
    try {
      r = await importarUma(f);
    } catch (e) {
      console.log(`● ${f.nome}: ERRO — ${e instanceof Error ? e.message : e}`);
      r = "erro";
    }
    resultado.set(r, [...(resultado.get(r) ?? []), `${f.nome} (registro ${f.registro})`]);
  }

  const lista = (k: string) => resultado.get(k) ?? [];
  if (lista("sem-cadastro").length) console.log(`\nSem cadastro no ERP (não importadas): ${lista("sem-cadastro").join("; ")}`);
  if (lista("duplicado").length) console.log(`CPF em mais de um cadastro (não importadas): ${lista("duplicado").join("; ")}`);
  if (lista("erro").length) { console.log(`Com erro (não importadas): ${lista("erro").join("; ")}`); process.exitCode = 1; }
  console.log(aplicar ? `\nGravado: ${lista("gravado").length} funcionário(s).` : "\nSimulação: nada foi gravado. Para gravar, --aplicar.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
