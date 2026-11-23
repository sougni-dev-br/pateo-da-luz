// Carrega o histórico mensal do Salão (2025) a partir da aba "Base mensal" da planilha de planejamento,
// para o comparativo ano × ano de Planejamento. Só cobre meses que o ERP não tem no faturamento diário.
//
//   TZ=UTC npx tsx scripts/importar-historico-salao.ts <planilha.xlsx> [--anos=2025] [--aplicar [--producao]]
//
// Por padrão só SIMULA. Rodar de novo atualiza as mesmas linhas (ano + mês), não duplica.
// --anos aceita vários separados por vírgula. Meses cujo faturamento diário no ERP cobre o mês (90% dos
// dias ou mais) são listados e NÃO são gravados: o ERP é a fonte, o histórico só preenche o que falta.

import ExcelJS from "exceljs";
import { Prisma, PrismaClient } from "@prisma/client";
import { conferirDestino } from "../src/lib/destino-banco.js";
import { erpCobreOMes } from "../src/modules/planning/planejamento-comparativo.js";
import { lerBaseMensal } from "../src/modules/planning/historico-salao-parse.js";
import { REVENUE_CHANNEL_SALON } from "../src/modules/monthly/revenue-channels.js";

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
if (!arquivo) throw new Error("Informe a planilha de planejamento (.xlsx).");
const anos = (args.find((a) => a.startsWith("--anos="))?.slice(7) ?? "2025").split(",").map(Number);
if (anos.some((a) => !Number.isInteger(a) || a < 2000)) throw new Error("--anos precisa de anos válidos, ex.: --anos=2025.");

const { host, aplicar } = conferirDestino(args, process.env.DATABASE_URL);
console.log(`Banco de destino: ${host}${aplicar ? " (GRAVANDO)" : " (simulação)"} · anos ${anos.join(", ")}`);

const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const prisma = new PrismaClient();

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo!);
  const aba = wb.getWorksheet("Base mensal");
  if (!aba) throw new Error('A planilha não tem a aba "Base mensal".');

  const linhasDaAba: (string | number | null)[][] = [];
  let formulasSemValor = 0;
  aba.eachRow({ includeEmpty: false }, (row) => {
    const valores = (row.values as unknown[]).slice(1).map((v) => {
      if (v && typeof v === "object" && "formula" in (v as object)) {
        const resultado = (v as { result?: unknown }).result;
        if (typeof resultado === "number" || typeof resultado === "string") return resultado;
        formulasSemValor += 1;
        return null;
      }
      return typeof v === "number" || typeof v === "string" ? v : null;
    });
    linhasDaAba.push(valores);
  });
  if (formulasSemValor > 0) console.warn(`Aviso: ${formulasSemValor} célula(s) de fórmula sem valor calculado (abra e salve a planilha no Excel antes de importar).`);

  const { linhas, avisos } = lerBaseMensal(linhasDaAba);
  avisos.forEach((a) => console.warn(`Aviso: ${a}`));
  console.log(`Linhas lidas da aba: ${linhasDaAba.length} · meses reconhecidos: ${linhas.length}`);
  if (linhas.length === 0) throw new Error("Nenhum mês reconhecido na aba Base mensal: confira o arquivo.");
  const escolhidas = linhas.filter((l) => anos.includes(l.ano));

  // Mesma regra do comparativo: o ERP só vence o histórico se o faturamento diário cobre o mês.
  const noErp = await prisma.$queryRaw<Array<{ ano: number; mes: number; dias: number }>>`
    SELECT "competenceYear" AS "ano", "competenceMonth" AS "mes", COUNT(DISTINCT "date")::int AS "dias"
    FROM "RevenueEntry"
    WHERE "status" <> 'CANCELLED' AND "channel" = ${REVENUE_CHANNEL_SALON} AND "competenceYear" IN (${Prisma.join(anos)})
    GROUP BY 1, 2
  `;
  const jaNoErp = new Set(noErp.filter((m) => erpCobreOMes(m.dias, m.ano, m.mes)).map((m) => `${m.ano}-${m.mes}`));

  let gravados = 0;
  for (const l of escolhidas) {
    const rotulo = `${String(l.mes).padStart(2, "0")}/${l.ano}`;
    if (jaNoErp.has(`${l.ano}-${l.mes}`)) {
      console.log(`${rotulo}  ignorado: o faturamento diário do ERP já cobre este mês.`);
      continue;
    }
    console.log(`${rotulo}  almoço ${reais(l.vendasAlmoco)} (${l.clientesAlmoco} cl.) · jantar ${reais(l.vendasJantar)} (${l.clientesJantar} cl.) · serviço ${reais(l.servico)}`);
    if (aplicar) {
      const dados = { vendasAlmoco: l.vendasAlmoco, vendasJantar: l.vendasJantar, clientesAlmoco: l.clientesAlmoco, clientesJantar: l.clientesJantar, servico: l.servico, fonte: l.fonte };
      await prisma.salaoHistoricoMensal.upsert({ where: { ano_mes: { ano: l.ano, mes: l.mes } }, create: { ano: l.ano, mes: l.mes, ...dados }, update: dados });
      gravados += 1;
    }
  }
  console.log(aplicar ? `Gravado: ${gravados} mês(es).` : "Simulação: nada foi gravado. Para gravar, --aplicar.");
}

main().finally(() => prisma.$disconnect());
