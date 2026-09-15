// Auditoria do desconto de falta — os casos de borda que já quebraram uma vez.
// Roda contra o banco LOCAL de demonstração (pateo_vt_demo). Nada de produção.
import { prisma } from "./config/database.js";
import { computePayroll, generatePayroll } from "./modules/payroll/payroll.service.js";
import { round2 } from "./modules/payroll/vt-calc.js";
import { exigeBancoDeDemonstracao } from "./exige-banco-de-demo.js";

const EMP = "demo-3"; // Cláudia Martins — só ônibus, R$ 10,60/dia útil, R$ 0 no domingo
const USER = "user-demo";
const Y = 2026;
const M = 9;

const brl = (n: number) => `R$ ${n.toFixed(2)}`;
let falhas = 0;

function checa(nome: string, condicao: boolean, detalhe: string) {
  console.log(`${condicao ? "  OK  " : " FALHA"} | ${nome} — ${detalhe}`);
  if (!condicao) falhas++;
}

async function vt(quinzena: 1 | 2) {
  const { items } = await computePayroll(Y, M);
  return items.find((i) => i.employeeId === EMP && i.type === "VALE_TRANSPORTE" && i.quinzena === quinzena)!;
}

async function marcaFalta(dia: number) {
  await prisma.employeeScheduleDay.upsert({
    where: { employeeId_date: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, dia)) } },
    update: { type: "FALTA" },
    create: { id: `${EMP}-falta${dia}`, employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, dia)), type: "FALTA", createdById: USER },
  });
}

// Devolve o funcionário de teste ao estado do seed (escala 6×1 com folga nas
// segundas). Sem isso o teste 2, que enche o mês de folgas, deixaria o ambiente
// de demonstração torto para quem abrir a tela depois.
async function limpa() {
  // generatePayroll gera para TODO MUNDO, não só para o funcionário de teste.
  // Limpar só o EMP deixava lançamentos dos demais espalhados pelo ambiente de
  // demonstração — rodar a auditoria bagunçava a tela que o Eli vai abrir.
  await prisma.vtFaltaDeduction.deleteMany({});
  await prisma.payrollItem.deleteMany({ where: { type: "VALE_TRANSPORTE" } });
  await prisma.employeeScheduleDay.deleteMany({ where: { employeeId: EMP } });
  for (const d of [7, 14, 21, 28]) {
    await prisma.employeeScheduleDay.create({
      data: { id: `${EMP}-f${d}`, employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, d)), type: "FOLGA", createdById: USER },
    });
  }
}

async function main() {
  exigeBancoDeDemonstracao("audita-vt");

  await limpa();
  const base = await vt(2);
  console.log(`Base da 2ª quinzena sem faltas: ${brl(base.amount)} (${base.workedDays} dias)\n`);

  // ── 1. Falta em DOMINGO já pago: custo zero, tem que quitar e não voltar ──
  await generatePayroll(Y, M, USER, "VT_Q1"); // paga 01 a 15
  await marcaFalta(6); // 06/09/2026 é domingo — ônibus grátis, custo R$ 0
  const comDomingo = await vt(2);
  checa("falta em domingo não desconta", comDomingo.amount === base.amount,
    `2ª quinzena ${brl(comDomingo.amount)} (esperado ${brl(base.amount)})`);
  checa("falta em domingo é registrada como quitada",
    (comDomingo.faltaDeductions ?? []).some((d) => d.date === "2026-09-06" && d.amount === 0),
    `abatimentos: ${JSON.stringify(comDomingo.faltaDeductions ?? [])}`);

  await generatePayroll(Y, M, USER, "VT_Q2");
  const carimbos = await prisma.vtFaltaDeduction.findMany({ where: { employeeId: EMP } });
  checa("o carimbo de zero foi gravado", carimbos.some((c) => Number(c.amount) === 0),
    `${carimbos.length} carimbo(s) na base`);
  const outubro = await computePayroll(Y, M + 1);
  const out = outubro.items.find((i) => i.employeeId === EMP && i.quinzena === 1 && i.type === "VALE_TRANSPORTE")!;
  checa("falta de domingo não volta na fila do mês seguinte",
    (out.faltaDeductions ?? []).length === 0, `outubro: ${(out.faltaDeductions ?? []).length} pendência(s)`);

  // ── 2. Faltas demais: o que não cabe fica pendente, NÃO evapora ──
  await limpa();
  // Deixa a 2ª quinzena valendo pouco: folga em quase tudo, sobrando 2 dias úteis.
  for (let d = 16; d <= 30; d++) {
    if (d === 17 || d === 18) continue;
    await prisma.employeeScheduleDay.upsert({
      where: { employeeId_date: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, d)) } },
      update: { type: "FOLGA" },
      create: { id: `${EMP}-folga${d}`, employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, d)), type: "FOLGA", createdById: USER },
    });
  }
  await generatePayroll(Y, M, USER, "VT_Q1");
  for (const d of [1, 2, 3, 4, 8]) await marcaFalta(d); // 5 faltas = R$ 53,00 a devolver
  const q2 = await vt(2);
  const abatido = (q2.faltaDeductions ?? []).reduce((s, d) => s + d.amount, 0);
  const bruto = 2 * 10.6;
  checa("vale nunca fica negativo", q2.amount >= 0, `2ª quinzena ${brl(q2.amount)}`);
  checa("só desconta dia INTEIRO que cabe no vale",
    (q2.faltaDeductions ?? []).every((d) => d.amount === 0 || d.amount === 10.6),
    `abatimentos: ${(q2.faltaDeductions ?? []).map((d) => brl(d.amount)).join(", ")}`);
  checa("abatimento não passa do valor do vale", abatido <= bruto,
    `abatido ${brl(abatido)} de um bruto de ${brl(bruto)}`);

  await generatePayroll(Y, M, USER, "VT_Q2");
  const quitadas = await prisma.vtFaltaDeduction.count({ where: { employeeId: EMP } });
  const marcadas = await prisma.employeeScheduleDay.count({ where: { employeeId: EMP, type: "FALTA" } });
  checa("faltas que não couberam continuam pendentes", quitadas < marcadas,
    `${quitadas} quitada(s) de ${marcadas} falta(s) — o resto espera o próximo vale`);

  const out2 = (await computePayroll(Y, M + 1)).items
    .find((i) => i.employeeId === EMP && i.quinzena === 1 && i.type === "VALE_TRANSPORTE")!;
  const pendentesOut = (out2.faltaDeductions ?? []).length;
  checa("o que sobrou aparece no vale seguinte", pendentesOut === marcadas - quitadas,
    `outubro traz ${pendentesOut} pendência(s)`);

  // ── 3. Excluir e RESTAURAR não pode descontar a mesma falta duas vezes ──
  await limpa();
  await generatePayroll(Y, M, USER, "VT_Q1");
  await marcaFalta(8); // terça-feira já paga: R$ 10,60 a devolver
  await generatePayroll(Y, M, USER, "VT_Q2");
  const item = (await prisma.payrollItem.findFirst({
    where: { employeeId: EMP, type: "VALE_TRANSPORTE", periodLabel: "VT 2ª quinzena", deletedAt: null },
    select: { id: true, amount: true, details: true },
  }))!;
  checa("2ª quinzena saiu com o abatimento", Number(item.amount) === round2(base.amount - 10.6),
    `gravado ${brl(Number(item.amount))}`);

  // Exclusão: solta as faltas de volta para a fila (o que a rota DELETE faz).
  await prisma.vtFaltaDeduction.deleteMany({ where: { payrollItemId: item.id } });
  await prisma.payrollItem.update({ where: { id: item.id }, data: { deletedAt: new Date(), deletedById: USER } });
  checa("excluir solta a falta de volta",
    (await prisma.vtFaltaDeduction.count({ where: { employeeId: EMP } })) === 0, "fila limpa");

  // Restauração: recarimba a partir de details.faltasDescontadas (o que a rota PATCH faz).
  await prisma.payrollItem.update({ where: { id: item.id }, data: { deletedAt: null, deletedById: null } });
  const lista = (item.details as { faltasDescontadas?: Array<{ date: string; amount: number }> } | null)?.faltasDescontadas ?? [];
  checa("details guarda as faltas para a restauração", lista.length > 0, `${lista.length} registrada(s)`);
  await prisma.vtFaltaDeduction.createMany({
    data: lista.map((f) => ({ employeeId: EMP, date: new Date(`${f.date}T00:00:00.000Z`), amount: f.amount, payrollItemId: item.id })),
    skipDuplicates: true,
  });
  const depois = (await computePayroll(Y, M + 1)).items
    .find((i) => i.employeeId === EMP && i.quinzena === 1 && i.type === "VALE_TRANSPORTE")!;
  checa("restaurar NÃO desconta a mesma falta de novo", (depois.faltaDeductions ?? []).length === 0,
    `mês seguinte traz ${(depois.faltaDeductions ?? []).length} pendência(s)`);

  // ── 4. Gerar a 2ª quinzena SEM a 1ª não pode fazer a falta evaporar ──
  // A 1ª quinzena, que nem vira lançamento, não pode "reservar" a falta e deixar
  // a 2ª sair sem o desconto.
  await limpa();
  await prisma.employeeScheduleDay.deleteMany({ where: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, 8)) } });
  // Simula um vale do mês ANTERIOR já pago, cobrindo 25/08.
  const ago = await prisma.payrollItem.create({
    data: {
      id: "audita-ago", employeeId: EMP, type: "VALE_TRANSPORTE",
      competenceYear: Y, competenceMonth: M - 1, periodLabel: "VT 2ª quinzena",
      periodStart: new Date(Date.UTC(Y, M - 2, 16)), periodEnd: new Date(Date.UTC(Y, M - 2, 31)),
      dueDate: new Date(Date.UTC(Y, M - 2, 15)), amount: 106,
      details: { diasPagos: [25], trajeto: "Ida: Ônibus SP (SPTrans) · Volta: Ônibus SP (SPTrans)" },
      status: "PAID", source: "GENERATED", createdById: USER,
    },
    select: { id: true },
  });
  await prisma.employeeScheduleDay.create({
    data: { id: `${EMP}-falta-ago`, employeeId: EMP, date: new Date(Date.UTC(Y, M - 2, 25)), type: "FALTA", createdById: USER },
  });

  await generatePayroll(Y, M, USER, "VT_Q2"); // gera SÓ a 2ª, com a 1ª inexistente
  const q2Sozinha = await prisma.payrollItem.findFirst({
    where: { employeeId: EMP, type: "VALE_TRANSPORTE", periodLabel: "VT 2ª quinzena", competenceMonth: M, deletedAt: null },
    select: { amount: true },
  });
  checa("gerar só a 2ª quinzena aplica o desconto da falta antiga",
    q2Sozinha != null && Number(q2Sozinha.amount) === round2(base.amount - 10.6),
    `2ª quinzena gravada em ${brl(Number(q2Sozinha?.amount ?? 0))} (esperado ${brl(round2(base.amount - 10.6))})`);

  await prisma.payrollItem.deleteMany({ where: { id: ago.id } });
  await prisma.employeeScheduleDay.deleteMany({ where: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 2, 25)) } });

  // ── 5. ATESTADO recupera o vale igual à falta, e fica identificado ──
  await limpa();
  await generatePayroll(Y, M, USER, "VT_Q1");
  await prisma.employeeScheduleDay.upsert({
    where: { employeeId_date: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, 9)) } },
    update: { type: "ATESTADO" },
    create: { id: `${EMP}-at9`, employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, 9)), type: "ATESTADO", createdById: USER },
  });
  const comAtestado = await vt(2);
  checa("atestado em dia já pago abate o vale seguinte",
    comAtestado.amount === round2(base.amount - 10.6),
    `2ª quinzena ${brl(comAtestado.amount)} (esperado ${brl(round2(base.amount - 10.6))})`);
  checa("o abatimento vem marcado como ATESTADO",
    (comAtestado.faltaDeductions ?? []).some((d) => d.date === "2026-09-09" && d.tipo === "ATESTADO"),
    `${JSON.stringify(comAtestado.faltaDeductions ?? [])}`);

  await generatePayroll(Y, M, USER, "VT_Q2");
  const carimboAt = await prisma.vtFaltaDeduction.findFirst({
    where: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, 9)) },
    select: { dayType: true },
  });
  checa("o tipo ATESTADO é gravado na base", carimboAt?.dayType === "ATESTADO", `dayType = ${carimboAt?.dayType}`);

  // ── 6. Atestado DENTRO do período não é dia pago ──
  await limpa();
  await prisma.employeeScheduleDay.upsert({
    where: { employeeId_date: { employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, 22)) } },
    update: { type: "ATESTADO" },
    create: { id: `${EMP}-at22`, employeeId: EMP, date: new Date(Date.UTC(Y, M - 1, 22)), type: "ATESTADO", createdById: USER },
  });
  const q2ComAt = await vt(2);
  checa("atestado dentro do período apenas não paga o dia",
    q2ComAt.amount === round2(base.amount - 10.6) && q2ComAt.workedDays === (base.workedDays ?? 0) - 1,
    `${brl(q2ComAt.amount)} em ${q2ComAt.workedDays} dias · ${(q2ComAt.faltaDeductions ?? []).length} abatimento(s) retroativo(s)`);

  await limpa();
  console.log(`\n${falhas === 0 ? "TODAS AS VERIFICAÇÕES PASSARAM" : `${falhas} VERIFICAÇÃO(ÕES) FALHARAM`}`);
  await prisma.$disconnect();
  if (falhas > 0) process.exitCode = 1;
}

void main();
