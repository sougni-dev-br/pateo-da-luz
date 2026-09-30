// Tira o CPF dos extratos do RH já gravados: RhExtract.texto (texto do PDF), RhExtract.data
// (lista de funcionários, que guardava cpf/cpfNorm) e RhExtractPessoa.texto (bloco de cada
// pessoa, mascarado antes só no formato 000.000.000-00). O PDF original (arquivo) não é
// tocado. Imprime só contagens — nunca nome, CPF ou valor.
//
// Por padrão só SIMULA. Para gravar: --aplicar. Qualquer banco que não seja local
// (localhost, 127.0.0.1, ::1, host.docker.internal) exige também --producao.
//   TZ=UTC npx tsx scripts/limpar-cpf-extratos.ts [--aplicar [--producao]]
//
// Rodar de novo não muda nada (o que já está limpo fica igual).

import { PrismaClient, type Prisma } from "@prisma/client";
import { conferirDestino } from "../src/lib/destino-banco.js";
import { funcionariosSemCpf, semCpf } from "../src/modules/payroll/rh-extract-detalhes.js";

const LOTE_EXTRATOS = 20;
const LOTE_PESSOAS = 200;

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const { host, aplicar } = conferirDestino(args, process.env.DATABASE_URL);
console.log(`Banco de destino: ${host}${aplicar ? " (GRAVANDO)" : " (simulação)"}`);

const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function limparExtratos() {
  const r = { lidos: 0, texto: 0, data: 0, gravados: 0 };
  let cursor: string | undefined;
  for (;;) {
    const lote = await prisma.rhExtract.findMany({
      select: { id: true, texto: true, data: true },
      orderBy: { id: "asc" },
      take: LOTE_EXTRATOS,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (lote.length === 0) break;
    cursor = lote[lote.length - 1].id;
    for (const e of lote) {
      r.lidos += 1;
      const texto = e.texto == null ? null : semCpf(e.texto);
      const data = funcionariosSemCpf(e.data);
      const mudouTexto = texto !== e.texto;
      const mudouData = !iguais(data, e.data);
      if (mudouTexto) r.texto += 1;
      if (mudouData) r.data += 1;
      if (!aplicar || (!mudouTexto && !mudouData)) continue;
      await prisma.rhExtract.update({
        where: { id: e.id },
        data: { ...(mudouTexto ? { texto } : {}), ...(mudouData ? { data: data as Prisma.InputJsonValue } : {}) },
      });
      r.gravados += 1;
    }
  }
  return r;
}

async function limparPessoas() {
  const r = { lidas: 0, texto: 0, gravadas: 0 };
  let cursor: string | undefined;
  for (;;) {
    const lote = await prisma.rhExtractPessoa.findMany({
      select: { id: true, texto: true },
      orderBy: { id: "asc" },
      take: LOTE_PESSOAS,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (lote.length === 0) break;
    cursor = lote[lote.length - 1].id;
    for (const p of lote) {
      r.lidas += 1;
      if (p.texto == null) continue;
      const texto = semCpf(p.texto);
      if (texto === p.texto) continue;
      r.texto += 1;
      if (!aplicar) continue;
      await prisma.rhExtractPessoa.update({ where: { id: p.id }, data: { texto } });
      r.gravadas += 1;
    }
  }
  return r;
}

async function main() {
  const e = await limparExtratos();
  const p = await limparPessoas();
  console.log(`Extratos lidos: ${e.lidos}; com CPF no texto: ${e.texto}; com CPF na lista de funcionários: ${e.data}.`);
  console.log(`Holerites (pessoas) lidos: ${p.lidas}; com CPF no texto: ${p.texto}.`);
  if (aplicar) console.log(`Gravados: ${e.gravados} extrato(s), ${p.gravadas} holerite(s).`);
  else if (e.texto + e.data + p.texto > 0) console.log("Nada foi gravado. Para gravar: --aplicar.");
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
