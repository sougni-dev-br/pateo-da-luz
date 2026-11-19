// Auditoria SOMENTE LEITURA do salário combinado (férias, 13º e salário do mês): acha pagamento em duplicidade,
// complemento desatualizado, título mexido à mão e meses de gorjeta que divergem entre férias e 13º.
//
//   cd backend
//   $env:TZ = "UTC"; $env:DATABASE_URL = "<url do banco>"; npx tsx scripts/auditar-combinado.ts [--ano=2026]
//
// Sai com código 1 se houver ERRO (ATENÇÃO sozinha não derruba). Não grava nada: a conexão é aberta com
// default_transaction_read_only=on (o próprio Postgres recusa qualquer escrita) e o script só chama leituras.
// Regras puras: src/modules/payroll/auditoria-combinado.ts.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Defina DATABASE_URL (banco a auditar).");
if (process.env.TZ !== "UTC") console.warn("Aviso: rode com TZ=UTC (as datas de produção são em UTC).");
const SO_LEITURA = "options=-c%20default_transaction_read_only%3Don";
process.env.DATABASE_URL = url.includes("default_transaction_read_only") ? url : `${url}${url.includes("?") ? "&" : "?"}${SO_LEITURA}`;
let host = "?";
try { host = new URL(url).hostname; } catch { /* mostra só "?" */ }

const [{ prisma }, aud, dec, ferias, sal, tit, fc, dg, infSvc] = await Promise.all([
  import("../src/config/database.js"),
  import("../src/modules/payroll/auditoria-combinado.js"),
  import("../src/modules/payroll/decimo-terceiro.service.js"),
  import("../src/modules/payroll/ferias-combinado.service.js"),
  import("../src/modules/payroll/salario-combinado.service.js"),
  import("../src/modules/payroll/salario-combinado-folha.js"),
  import("../src/modules/payroll/ferias-combinado.js"),
  import("../src/modules/payroll/decimo-terceiro-gorjeta-combinado.js"),
  import("../src/modules/payroll/gorjeta-integral-informada.service.js"),
]);
type Achado = import("../src/modules/payroll/auditoria-combinado.js").Achado;
type Titulo = import("../src/modules/payroll/auditoria-combinado.js").TituloAuditado;

const argAno = process.argv.find((a) => a.startsWith("--ano="))?.slice(6);
const hoje = new Date();
const ano = argAno ? Number(argAno) : hoje.getUTCFullYear();
const mesAtual = hoje.getUTCMonth() + 1;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

const achados: Achado[] = [];
const empregados = await sal.combinadosVigentes(ano, mesAtual, null);
console.log(`Banco: ${host} (somente leitura) · ano-base ${ano} · ${empregados.length} pessoa(s) com salário combinado.`);

const titulosDe = async (employeeId: string): Promise<Titulo[]> => (await prisma.payrollItem.findMany({
  where: { employeeId, type: { in: ["FERIAS", "DECIMO_TERCEIRO", "SALARIO"] }, competenceYear: { gte: ano - 1 }, deletedAt: null, status: { not: "CANCELED" } },
  select: { id: true, type: true, periodLabel: true, competenceYear: true, competenceMonth: true, periodStart: true, periodEnd: true, amount: true, paidAmount: true, paymentDate: true, status: true, differenceReason: true, details: true },
  orderBy: [{ competenceYear: "asc" }, { competenceMonth: "asc" }],
})).map((i) => ({
  id: i.id, tipo: i.type as Titulo["tipo"], rotulo: i.periodLabel, ano: i.competenceYear, mes: i.competenceMonth,
  periodStart: iso(i.periodStart), periodEnd: iso(i.periodEnd), amount: Number(i.amount), paidAmount: i.paidAmount == null ? null : Number(i.paidAmount),
  pago: i.paymentDate != null || i.status === "PAID", differenceReason: i.differenceReason, details: i.details,
}));

// Competências da janela cuja apuração de gorjeta não está FECHADA (inclui mês sem apuração criada).
async function mesesAbertosDe(chaves: ReadonlyArray<string>): Promise<string[]> {
  const periodos = await prisma.tipPeriod.findMany({ select: { competenceYear: true, competenceMonth: true, status: true } });
  const estado = new Map(periodos.map((p) => [fc.chaveDoMes(p.competenceYear, p.competenceMonth), String(p.status)]));
  return chaves.filter((c) => estado.has(c) && estado.get(c) !== "CLOSED");
}

const previa13 = await dec.listarDecimoTerceiroSR(ano);
const variaveis = await dec.variaveisDoAno(ano);
const declaradas = await dec.mediaDeclaradaDoExtrato(ano, empregados.map((e) => e.id));
const informadas13 = await infSvc.informadasDoAno(empregados.map((e) => e.id), ano);

for (const e of empregados) {
  const pessoa = e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();
  const titulos = await titulosDe(e.id);
  // Meses cuja gorjeta veio da planilha: valor informado (GorjetaIntegralInformada) ou digitado no 13º (DecimoTerceiroVariavel).
  const planilha = new Set<string>([
    ...(await prisma.gorjetaIntegralInformada.findMany({ where: { employeeId: e.id }, select: { competencia: true } })).map((x) => x.competencia),
    ...(await prisma.decimoTerceiroVariavel.findMany({ where: { employeeId: e.id }, select: { ano: true, mes: true } })).map((x) => fc.chaveDoMes(x.ano, x.mes)),
  ]);
  const consumo = new Map<string, import("../src/modules/payroll/auditoria-combinado.js").ConsumoDoMes>();
  const usar = (chave: string, campo: "salario" | "ferias" | "decimo", valor: number | null) => consumo.set(chave, { ...(consumo.get(chave) ?? { chave }), [campo]: valor, planilha: planilha.has(chave) });
  achados.push(...aud.auditarDuplicidade(pessoa, titulos));
  for (const t of titulos) achados.push(...aud.auditarTituloSomado(pessoa, t));

  // Férias: o cálculo de hoje vem da própria prévia do serviço (aplicar:false não grava).
  let mesesFerias: ReadonlyArray<import("../src/modules/payroll/ferias-combinado.js").MesDaGorjeta> = [];
  for (const t of titulos.filter((x) => x.tipo === "FERIAS")) {
    const abertoDe = (chaves: string[]) => mesesAbertosDe(chaves);
    try {
      if (t.pago) continue; // título pago não é recalculado pelo serviço (nunca muda); a integridade dele já foi conferida acima
      const r = await ferias.somarCombinadoAFerias({ payrollItemId: t.id, aplicar: false, usuario: { id: "auditoria", name: "auditoria" } });
      mesesFerias = r.previa.meses;
      for (const m of r.previa.meses) usar(m.chave, "ferias", m.valor);
      achados.push(...aud.auditarFerias(pessoa, t, {
        combinado: r.previa.combinado, meses: r.previa.meses, liquidoRecibo: r.previa.liquidoRecibo, mesesAbertos: await abertoDe(r.previa.meses.map((m) => m.chave)), daPlanilha: planilha,
      }));
    } catch (err) {
      achados.push({ severidade: "ATENCAO", regra: "ferias-nao-recalculada", pessoa, titulo: `Férias ${t.rotulo}`, mensagem: `Não foi possível recalcular o complemento: ${(err as Error).message}` });
    }
  }

  // 13º: diferença somada ao extrato × cálculo de hoje; declarada × integral; gorjeta de cada mês nas férias × 13º.
  const linha = previa13.linhas.find((l) => l.employeeId === e.id && l.origem === "COMBINADO");
  const declarada = declaradas.get(e.id);
  const declaradaMensal = declarada ? dg.mediaDeclaradaMensal(declarada) : null;
  for (const t of titulos.filter((x) => x.tipo === "DECIMO_TERCEIRO" && /1ª\s*parcela\s*\(extrato\)/i.test(x.rotulo) && x.ano === ano)) {
    achados.push(...aud.auditarDecimo(pessoa, t, { parcela1: linha?.calculo?.parcela1 ?? null, mediaDeclaradaMensal: declaradaMensal }));
  }
  const doDecimo = new Map((variaveis.informadas.get(e.id) ?? []).map((i) => [i.mes, i.valor] as const));
  const dasTabela = dg.informadasDaTabela(informadas13.get(e.id) ?? [], ano);
  const g = dg.gorjetaIntegralDoCombinado({ apuracao: variaveis.gorjetaIntegral.get(e.id) ?? new Map(), apurados: variaveis.apurados, doDecimo, dasFerias: dasTabela });
  if (declaradaMensal != null) achados.push(...aud.auditarGorjetaDeclarada(pessoa, { declaradaMensal, integralPorMes: g.integralPorMes, mesesApurados: g.mesesApurados }));
  for (const [mes, v] of g.integralPorMes) if (mes <= 11) usar(fc.chaveDoMes(ano, mes), "decimo", v);

  // Salário do mês: só o que já foi calculado como combinado (ou está pendente de gorjeta), dos últimos 4 meses em diante.
  for (const t of titulos.filter((x) => x.tipo === "SALARIO" && objeto(x.details).origemValor === "SALARIO_COMBINADO")) {
    const gi = num(objeto(t.details).gorjetaIntegral);
    if (gi != null) usar(fc.chaveDoMes(t.ano, t.mes), "salario", gi);
  }
  const recentes = titulos.filter((t) => t.tipo === "SALARIO" && (t.ano * 12 + t.mes) >= (ano * 12 + mesAtual - 4));
  for (const t of recentes) {
    const d = objeto(t.details);
    if (d.origemValor !== "SALARIO_COMBINADO" && d.pendenteGorjeta !== true) continue;
    const liquido = num(d.liquidoExtrato) ?? num(d.liquido);
    if (liquido == null) continue;
    const combinado = (await sal.mapaCombinados(t.ano, t.mes, [e.id])).get(e.id) ?? null;
    const gorjeta = tit.gorjetaDaPessoa(await sal.gorjetasDaCompetencia(t.ano, t.mes), e.id);
    const f = (await sal.feriasNoMes(t.ano, t.mes, [e.id])).get(e.id) ?? null;
    const calc = tit.salarioDaFolha({ liquidoExtrato: liquido, adiantamento: num(d.adiantamento), combinado, gorjeta, ferias: f });
    achados.push(...aud.auditarSalario(pessoa, t, { valor: calc.valor, diasDeFerias: calc.detalhes.diasDeFerias ?? 0, pendenteGorjeta: calc.pendenteGorjeta, daPlanilha: planilha.has(fc.chaveDoMes(t.ano, t.mes)) }));
  }
  achados.push(...aud.auditarConsumidores(pessoa, [...consumo.values()]));
}

console.log("");
console.log(aud.formatarRelatorio(achados, `AUDITORIA DO SALÁRIO COMBINADO — ${hoje.toISOString().slice(0, 10)}`));
await prisma.$disconnect();
process.exit(aud.codigoDeSaida(achados));
