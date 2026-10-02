// Padroniza a escrita do cadastro de funcionários (nome próprio; cidade da lista com acento):
// nome, sobrenome, nome completo, filiação, nacionalidade, naturalidade, endereço, dependentes
// e cargos da carteira. Salvar o cadastro e importar a ficha já gravam assim; este script
// acerta o que foi gravado antes.
//
//   TZ=UTC npx tsx scripts/padronizar-nomes-funcionarios.ts [--aplicar [--producao]]
//
// Por padrão só SIMULA e lista o antes → depois. "Como quero ser chamado" não é tocado (é a
// escolha da pessoa), nem UF, documentos ou o cargo do cadastro.

import { PrismaClient } from "@prisma/client";
import { acentosDoNomeCompleto, cidadeProprio, nomeProprio } from "../src/shared/utils/nome-proprio.js";
import { auditLog } from "../src/modules/security/security-utils.js";
import { conferirDestino } from "../src/lib/destino-banco.js";

const args = process.argv.slice(2);
const { host, aplicar } = conferirDestino(args, process.env.DATABASE_URL);
console.log(`Banco de destino: ${host}${aplicar ? " (GRAVANDO)" : " (simulação)"}`);
const prisma = new PrismaClient();

const NOMES = ["firstName", "lastName", "nomeCompleto", "nomeMae", "nomePai", "nacionalidade", "address", "addressComplement", "neighborhood"] as const;
const CIDADES = ["city", "naturalidade"] as const;
type Campo = (typeof NOMES)[number] | (typeof CIDADES)[number];

async function main() {
  const emps = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, ...Object.fromEntries([...NOMES, ...CIDADES].map((c) => [c, true])) as Record<Campo, true>,
      dependentes: { select: { id: true, nome: true } }, anotacoesCarteira: { select: { id: true, cargo: true, cargoAnterior: true } } },
    orderBy: { firstName: "asc" },
  });
  let pessoas = 0;
  const falhas: string[] = [];
  for (const e of emps) {
    const atual = e as unknown as Record<Campo, string | null>;
    const dados: Partial<Record<Campo, string | null>> = {};
    const completo = nomeProprio(atual.nomeCompleto);
    const novo = (c: (typeof NOMES)[number]) => {
      // Sobrenome continua o nome ("da Silva"); nome e sobrenome recuperam o acento da carteira.
      const v = nomeProprio(atual[c], { continuacao: c === "lastName" });
      return c === "firstName" || c === "lastName" ? acentosDoNomeCompleto(v, completo) : v;
    };
    for (const c of NOMES) {
      const v = novo(c);
      // Nome e sobrenome são obrigatórios: nunca trocar por vazio.
      if (v !== atual[c] && !(v == null && (c === "firstName" || c === "lastName"))) dados[c] = v;
    }
    for (const c of CIDADES) { const v = cidadeProprio(atual[c]); if (v !== atual[c]) dados[c] = v; }
    const deps = e.dependentes.filter((d) => nomeProprio(d.nome) !== d.nome);
    const cargos = e.anotacoesCarteira.filter((a) => nomeProprio(a.cargo) !== a.cargo || nomeProprio(a.cargoAnterior) !== a.cargoAnterior);
    if (Object.keys(dados).length === 0 && deps.length === 0 && cargos.length === 0) continue;

    pessoas++;
    console.log(`● ${atual.firstName} ${atual.lastName}`);
    for (const [c, v] of Object.entries(dados)) console.log(`  ${c}: "${atual[c as Campo]}" → "${v}"`);
    for (const d of deps) console.log(`  dependente: "${d.nome}" → "${nomeProprio(d.nome)}"`);
    if (cargos.length) console.log(`  carteira: ${cargos.length} cargo(s) no padrão`);
    if (!aplicar) continue;

    // Erro numa pessoa não para as outras; cada uma é uma transação e rodar de novo é seguro.
    try {
      await prisma.$transaction(async (tx) => {
        if (Object.keys(dados).length) await tx.employee.update({ where: { id: e.id }, data: dados });
        for (const d of deps) await tx.employeeDependente.update({ where: { id: d.id }, data: { nome: nomeProprio(d.nome) ?? d.nome } });
        for (const a of cargos) await tx.employeeAnotacaoCarteira.update({ where: { id: a.id }, data: { cargo: nomeProprio(a.cargo), cargoAnterior: nomeProprio(a.cargoAnterior) } });
      }, { timeout: 30_000 }); // banco remoto: o padrão de 5 s é curto para várias escritas
    } catch (err) {
      falhas.push(`${atual.firstName} ${atual.lastName}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    // Antes e depois de cada campo no log: a padronização é a única cópia do valor antigo.
    await auditLog({ userId: null, action: "PADRONIZAR_NOMES_FUNCIONARIO", entity: "Employee", entityId: e.id,
      previousValue: {
        ...Object.fromEntries(Object.keys(dados).map((c) => [c, atual[c as Campo]])),
        dependentes: deps.map((d) => d.nome),
        cargosCarteira: cargos.map((a) => ({ id: a.id, cargo: a.cargo, cargoAnterior: a.cargoAnterior })),
      },
      newValue: { ...dados, dependentes: deps.map((d) => nomeProprio(d.nome) ?? d.nome), cargosCarteira: cargos.length } });
  }
  if (falhas.length) { console.log(`
Com erro (não gravados): ${falhas.join("; ")}`); process.exitCode = 1; }
  console.log(`\n${pessoas} de ${emps.length} cadastro(s) ${aplicar ? "padronizado(s)" : "a padronizar (simulação; para gravar, --aplicar)"}.`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
