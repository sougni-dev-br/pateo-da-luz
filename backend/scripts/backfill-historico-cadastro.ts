// Reconstrói o histórico do cadastro de funcionários (salário, vínculo, empresa, cargo,
// salário combinado, adiantamento) a partir da auditoria. Uma linha por campo que mudou,
// vigente desde o dia da alteração (São Paulo), origem BACKFILL. Nunca lê nem mostra CPF.
//
// Por padrão só SIMULA e mostra o que faria. Para gravar: --aplicar.
//   TZ=UTC npx tsx scripts/backfill-historico-cadastro.ts [--aplicar [--producao]]
//
// Rodar de novo não duplica (cada linha guarda o id da auditoria de origem).

import { PrismaClient } from "@prisma/client";
import { executarBackfill } from "../src/modules/payroll/cadastro-historico-backfill.js";
import { CAMPOS_SALARIO, ROTULO_CAMPO, type CampoHistorico } from "../src/modules/payroll/cadastro-historico.js";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");

// Para onde vai gravar: mostra o host sempre; produção (Render) só com --producao.
const destino = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname || "?"; } catch { return "?"; } })();
console.log(`Banco de destino: ${destino}${aplicar ? " (GRAVANDO)" : " (simulação)"}`);
if (aplicar && /render\.com$/.test(destino) && !args.includes("--producao")) {
  throw new Error("O destino é o banco de produção: confirme com --producao junto de --aplicar.");
}

const dia = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
const valor = (campo: string, v: string | null, empresas: Map<string, string>) => {
  if (v == null) return "vazio";
  if (campo === "companyId") return empresas.get(v) ?? v;
  if (CAMPOS_SALARIO.has(campo as CampoHistorico)) return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
  return v;
};

async function main() {
  const r = await executarBackfill(prisma, { aplicar });
  const ids = [...new Set(r.linhas.map((l) => l.employeeId))];
  const [pessoas, empresas] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.company.findMany({ select: { id: true, tradeName: true } }),
  ]);
  const nome = new Map(pessoas.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.tradeName]));

  console.log(`Auditorias lidas: ${r.auditorias}${r.corte ? ` (só as de antes de ${r.corte.toISOString()}, quando o sistema passou a gravar o histórico)` : ""}`);
  for (const l of r.linhas) {
    const ja = !r.novas.includes(l);
    console.log(`${ja ? "JÁ EXISTE" : aplicar ? "GRAVA" : "SIMULA"} ${nome.get(l.employeeId) ?? l.employeeId} · ${ROTULO_CAMPO[l.campo]}: `
      + `${valor(l.campo, l.valorAnterior, nomeEmpresa)} → ${valor(l.campo, l.valorNovo, nomeEmpresa)} · vale desde ${dia(l.vigenteDesde)} (${l.action})`);
  }
  const porCampo = new Map<string, number>();
  for (const l of r.novas) porCampo.set(l.campo, (porCampo.get(l.campo) ?? 0) + 1);
  console.log(`\nLinhas novas: ${r.novas.length}; já existiam: ${r.jaExistiam}.`);
  for (const [campo, n] of porCampo) console.log(`  ${ROTULO_CAMPO[campo as CampoHistorico] ?? campo}: ${n}`);
  if (aplicar) console.log(`Gravadas: ${r.gravadas}.`);
  else if (r.novas.length) console.log("Nada foi gravado. Para gravar: --aplicar.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
