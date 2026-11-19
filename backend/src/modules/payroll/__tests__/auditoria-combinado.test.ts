import { describe, expect, it } from "vitest";
import {
  auditarCruzado, auditarDecimo, auditarDuplicidade, auditarFerias, auditarGorjetaDeclarada, auditarSalario, auditarTituloSomado,
  codigoDeSaida, formatarRelatorio, resumir, type Achado, type FeriasAtual, type TituloAuditado,
} from "../auditoria-combinado.js";
import type { MesDaGorjeta } from "../ferias-combinado.js";

const PESSOA = "Elioenai";
const informada = (chave: string, valor: number): MesDaGorjeta => ({ chave, valor, origem: "INFORMADA" });
const apuracao = (chave: string, valor: number): MesDaGorjeta => ({ chave, valor, origem: "APURACAO" });
// Janela real das férias do Elioenai (dez/2025 a nov/2026), gravada em 13/11/2026.
const MESES_REAIS: MesDaGorjeta[] = [
  informada("2025-12", 700), informada("2026-01", 900), informada("2026-02", 900), informada("2026-03", 1503.71),
  informada("2026-04", 2371.04), informada("2026-05", 1377.39), informada("2026-06", 1723.86), apuracao("2026-07", 0),
  apuracao("2026-08", 2016.17), apuracao("2026-09", 2223.54), apuracao("2026-10", 1978.47), apuracao("2026-11", 1478.22),
];

const feriasTitulo = (over: Partial<TituloAuditado> = {}, detalhes: Record<string, unknown> = {}): TituloAuditado => ({
  id: "f1", tipo: "FERIAS", rotulo: "Férias", ano: 2026, mes: 12, periodStart: "2026-12-28", periodEnd: "2027-01-26",
  amount: 9061.2, paidAmount: null, pago: false,
  details: {
    recibo: { dias: 30, liquido: 5304.84 }, liquidoExtrato: 5304.84, complemento: 3756.36, origemValor: "FERIAS_COMBINADO",
    feriasCombinado: { combinado: 5364.87, mediaGorjeta: 1431.03, mesesContados: 12, mesesAusentes: [], remuneracao: 9061.2, meses: MESES_REAIS },
    ...detalhes,
  },
  ...over,
});
const feriasAtual = (over: Partial<FeriasAtual> = {}): FeriasAtual => ({ combinado: 5364.87, meses: MESES_REAIS, liquidoRecibo: 5304.84, mesesAbertos: [], ...over });
const regras = (a: Achado[], sev?: string) => a.filter((x) => !sev || x.severidade === sev).map((x) => x.regra);

describe("auditarDuplicidade", () => {
  it("aceita um título de férias e um de 13º", () => {
    const r = auditarDuplicidade(PESSOA, [feriasTitulo(), { ...feriasTitulo(), id: "d1", tipo: "DECIMO_TERCEIRO", rotulo: "13º Salário - 1ª parcela (extrato)", periodStart: null, periodEnd: null }]);
    expect(regras(r, "ERRO")).toEqual([]);
    expect(r[0].severidade).toBe("OK");
  });
  it("acusa dois títulos de férias com gozo sobreposto", () => {
    const r = auditarDuplicidade(PESSOA, [feriasTitulo(), feriasTitulo({ id: "f2", periodStart: "2027-01-10", periodEnd: "2027-02-08" })]);
    expect(regras(r, "ERRO")).toEqual(["duplicidade-ferias"]);
  });
  it("não confunde férias de períodos diferentes", () => {
    const r = auditarDuplicidade(PESSOA, [feriasTitulo(), feriasTitulo({ id: "f2", periodStart: "2028-01-10", periodEnd: "2028-02-08", ano: 2028, mes: 1 })]);
    expect(regras(r, "ERRO")).toEqual([]);
  });
  it("acusa a diferença da 1ª parcela do 13º somada ao extrato E lançada à parte", () => {
    const base = { tipo: "DECIMO_TERCEIRO" as const, ano: 2026, mes: 11, periodStart: null, periodEnd: null, paidAmount: null, pago: false };
    const r = auditarDuplicidade(PESSOA, [
      { ...base, id: "e", rotulo: "13º Salário - 1ª parcela (extrato)", amount: 3310.77, details: { origemValor: "DECIMO_COMBINADO" } },
      { ...base, id: "c", rotulo: "13º Salário - 1ª parcela (combinado)", amount: 783.13, details: {} },
    ]);
    expect(regras(r, "ERRO")).toEqual(["duplicidade-13"]);
  });
  it("acusa o mesmo rótulo de 13º duas vezes", () => {
    const t: TituloAuditado = { id: "a", tipo: "DECIMO_TERCEIRO", rotulo: "13º Salário - 2ª parcela", ano: 2026, mes: 12, periodStart: null, periodEnd: null, amount: 1, paidAmount: null, pago: false, details: {} };
    expect(regras(auditarDuplicidade(PESSOA, [t, { ...t, id: "b" }]), "ERRO")).toEqual(["duplicidade-13"]);
  });
});

describe("auditarTituloSomado", () => {
  it("o título do Elioenai (5.304,84 + 3.756,36 = 9.061,20) está íntegro", () => {
    expect(auditarTituloSomado(PESSOA, feriasTitulo())).toEqual([]);
  });
  it("acusa valor mexido à mão em título somado", () => {
    expect(regras(auditarTituloSomado(PESSOA, feriasTitulo({ amount: 9000 })), "ERRO")).toEqual(["titulo-mexido-a-mao"]);
  });
  it("acusa soma sem o líquido do contador", () => {
    const t = feriasTitulo({}, { liquidoExtrato: undefined, recibo: {} });
    expect(regras(auditarTituloSomado(PESSOA, t), "ERRO")).toEqual(["titulo-somado"]);
  });
  it("título sem soma com valor diferente do líquido vira atenção", () => {
    const t: TituloAuditado = { ...feriasTitulo({ amount: 5000 }), details: { recibo: { liquido: 5304.84 } } };
    expect(regras(auditarTituloSomado(PESSOA, t), "ATENCAO")).toEqual(["titulo-mexido-a-mao"]);
  });
  it("pago com valor diferente: ERRO sem motivo, atenção com motivo", () => {
    const pago = feriasTitulo({ pago: true, paidAmount: 9000 });
    expect(regras(auditarTituloSomado(PESSOA, pago), "ERRO")).toEqual(["pago-diferente"]);
    expect(regras(auditarTituloSomado(PESSOA, { ...pago, differenceReason: "desconto combinado" }), "ATENCAO")).toEqual(["pago-diferente"]);
  });
});

describe("auditarFerias", () => {
  it("o complemento gravado recalcula igual: sem ERRO nem atenção, só o OK com a conta", () => {
    const r = auditarFerias(PESSOA, feriasTitulo(), feriasAtual());
    // julho com apuração zero e sem informada é sinalizado (média leva R$ 0,00 de julho)
    expect(regras(r, "ERRO")).toEqual([]);
    expect(regras(r, "ATENCAO")).toEqual(["mes-apuracao-zero"]);
  });
  it("sem mês zerado, tudo confere", () => {
    const meses = MESES_REAIS.map((m) => (m.chave === "2026-07" ? informada("2026-07", 1392.45) : m));
    // gravado com os meses antigos: a base mudou (média 1.431,03 → 1.547,07)
    const r = auditarFerias(PESSOA, feriasTitulo(), feriasAtual({ meses }));
    expect(regras(r, "ATENCAO")).toEqual(["ferias-base-mudou"]);
    expect(r.find((x) => x.regra === "ferias-base-mudou")?.mensagem).toContain("2026-07 R$ 0,00 → R$ 1.392,45");
    expect(r.find((x) => x.regra === "ferias-base-mudou")?.mensagem).toContain("R$ 3.911,08");
  });
  it("acusa quando o recibo lido agora tem outro líquido", () => {
    expect(regras(auditarFerias(PESSOA, feriasTitulo(), feriasAtual({ liquidoRecibo: 5000 })), "ERRO")).toContain("ferias-recibo");
  });
  it("acusa soma dupla: líquido + complemento não fecha com a remuneração devida", () => {
    const t = feriasTitulo({}, { complemento: 4000 });
    expect(regras(auditarFerias(PESSOA, t, feriasAtual()), "ERRO")).toContain("soma-dupla");
  });
  it("acusa média gravada que não bate com os meses gravados", () => {
    const t = feriasTitulo({}, { feriasCombinado: { combinado: 5364.87, mediaGorjeta: 2000, remuneracao: 9061.2, meses: MESES_REAIS } });
    expect(regras(auditarFerias(PESSOA, t, feriasAtual()), "ERRO")).toContain("ferias-media");
  });
  it("avisa mês com apuração aberta e mês ausente", () => {
    const meses = MESES_REAIS.map((m) => (m.chave === "2026-02" ? { chave: "2026-02", valor: null, origem: "AUSENTE" as const } : m));
    const r = auditarFerias(PESSOA, feriasTitulo(), feriasAtual({ meses, mesesAbertos: ["2026-08", "2026-11"] }));
    expect(regras(r, "ATENCAO")).toEqual(expect.arrayContaining(["ferias-mes-aberto", "ferias-mes-ausente"]));
  });
  it("título pago com base que mudou diz que já foi pago", () => {
    const meses = MESES_REAIS.map((m) => (m.chave === "2026-11" ? apuracao("2026-11", 2000) : m));
    const r = auditarFerias(PESSOA, feriasTitulo({ pago: true, paidAmount: 9061.2 }), feriasAtual({ meses }));
    expect(r.find((x) => x.regra === "ferias-base-mudou")?.mensagem).toContain("JÁ FOI PAGO");
  });
  it("apuração zero com valor informado é OK (regra do #261)", () => {
    const meses = MESES_REAIS.map((m) => (m.chave === "2026-07" ? { chave: "2026-07", valor: 0, origem: "INFORMADA" as const, apuracaoZero: true } : m));
    const r = auditarFerias(PESSOA, feriasTitulo(), feriasAtual({ meses }));
    expect(r.some((x) => x.severidade === "OK" && x.regra === "mes-apuracao-zero")).toBe(true);
  });
  it("título sem complemento aplicado mas com fórmula positiva pede para aplicar", () => {
    const t: TituloAuditado = { ...feriasTitulo({ amount: 5304.84 }), details: { recibo: { dias: 30, liquido: 5304.84 } } };
    expect(regras(auditarFerias(PESSOA, t, feriasAtual()), "ATENCAO")).toEqual(["ferias-sem-complemento"]);
  });
  it("complemento sem combinado vigente pede para desfazer", () => {
    expect(regras(auditarFerias(PESSOA, feriasTitulo(), feriasAtual({ combinado: null })), "ATENCAO")).toEqual(["ferias-sem-combinado"]);
  });
  it("férias de 15 dias conferem proporcionais", () => {
    const meses: MesDaGorjeta[] = [informada("2026-01", 1000)];
    const liquido = 2000;
    const remuneracao = ((5000 + 1000) * 4 / 3) * 0.5; // 4.000
    const t = feriasTitulo({ amount: 4000 }, {
      recibo: { dias: 15, liquido }, liquidoExtrato: liquido, complemento: remuneracao - liquido,
      feriasCombinado: { combinado: 5000, mediaGorjeta: 1000, remuneracao, meses },
    });
    const r = auditarFerias(PESSOA, t, feriasAtual({ combinado: 5000, meses, liquidoRecibo: liquido }));
    expect(regras(r, "ERRO")).toEqual([]);
    expect(regras(r, "ATENCAO")).toEqual([]);
  });
});

describe("auditarDecimo", () => {
  const t = (complemento: number, over: Partial<TituloAuditado> = {}): TituloAuditado => ({
    id: "d", tipo: "DECIMO_TERCEIRO", rotulo: "13º Salário - 1ª parcela (extrato)", ano: 2026, mes: 11, periodStart: null, periodEnd: null,
    amount: 2527.64 + complemento, paidAmount: null, pago: false,
    details: { liquidoExtrato: 2527.64, complemento, origemValor: "DECIMO_COMBINADO" }, ...over,
  });
  it("783,13 gravado = 783,13 calculado hoje: OK", () => {
    expect(auditarDecimo(PESSOA, t(783.13), { parcela1: 783.13, mediaDeclaradaMensal: 1218.4 }).map((x) => x.severidade)).toEqual(["OK"]);
  });
  it("acusa base mudada", () => {
    expect(regras(auditarDecimo(PESSOA, t(783.13), { parcela1: 800, mediaDeclaradaMensal: 1218.4 }), "ATENCAO")).toEqual(["decimo-base-mudou"]);
  });
  it("sem a média declarada do extrato, avisa", () => {
    expect(regras(auditarDecimo(PESSOA, t(783.13), { parcela1: 783.13, mediaDeclaradaMensal: null }), "ATENCAO")).toEqual(["decimo-sem-declarada"]);
  });
  it("título sem soma mas com diferença calculada pede para gerar", () => {
    const sem: TituloAuditado = { ...t(0), details: { liquido: 2527.64 }, amount: 2527.64 };
    expect(regras(auditarDecimo(PESSOA, sem, { parcela1: 783.13, mediaDeclaradaMensal: 1218.4 }), "ATENCAO")).toEqual(["decimo-sem-complemento"]);
  });
});

describe("auditarGorjetaDeclarada", () => {
  const integral = new Map([[1, 900], [2, 900], [3, 1503.71], [4, 2371.04], [5, 1377.39], [6, 1723.86], [7, 1392.45], [8, 2016.17], [9, 2223.54], [10, 1978.47]]);
  const apurados = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  it("integral média 1.638,66 ≥ declarada 1.218,40: só a diferença 420,26 é somada", () => {
    const r = auditarGorjetaDeclarada(PESSOA, { declaradaMensal: 1218.4, integralPorMes: integral, mesesApurados: apurados });
    expect(r).toHaveLength(1);
    expect(r[0].severidade).toBe("OK");
    expect(r[0].mensagem).toContain("R$ 420,26");
  });
  it("integral média abaixo da declarada: atenção (o extrato pagou mais que o ERP apura)", () => {
    const r = auditarGorjetaDeclarada(PESSOA, { declaradaMensal: 2000, integralPorMes: integral, mesesApurados: apurados });
    expect(regras(r, "ATENCAO")).toEqual(["declarada-maior"]);
  });
  it("sem meses apurados não diz nada", () => {
    expect(auditarGorjetaDeclarada(PESSOA, { declaradaMensal: 1, integralPorMes: new Map(), mesesApurados: new Set() })).toEqual([]);
  });
});

describe("auditarCruzado (férias × 13º)", () => {
  it("julho: férias com 0,00 e 13º com 1.392,45 é divergência, e diz o efeito nas férias", () => {
    const r = auditarCruzado(PESSOA, { ano: 2026, mesesFerias: MESES_REAIS, decimoIntegralPorMes: new Map([[7, 1392.45], [8, 2016.17]]) });
    expect(r).toHaveLength(1);
    expect(r[0].mensagem).toContain("2026-07");
    expect(r[0].mensagem).toContain("R$ 154,72");
  });
  it("meses iguais nos dois não geram achado", () => {
    expect(auditarCruzado(PESSOA, { ano: 2026, mesesFerias: MESES_REAIS, decimoIntegralPorMes: new Map([[8, 2016.17], [9, 2223.54]]) })).toEqual([]);
  });
});

describe("auditarSalario", () => {
  const sal = (over: Partial<TituloAuditado> = {}, detalhes: Record<string, unknown> = {}): TituloAuditado => ({
    id: "s", tipo: "SALARIO", rotulo: "Extrato 08/2026", ano: 2026, mes: 8, periodStart: null, periodEnd: null, amount: 6325.17, paidAmount: 6325.17, pago: true,
    details: { origemValor: "SALARIO_COMBINADO", ...detalhes }, ...over,
  });
  it("agosto/2026: pago 6.325,17, hoje 5.747,37 → pago a mais 577,80", () => {
    const r = auditarSalario(PESSOA, sal(), { valor: 5747.37, diasDeFerias: 0, pendenteGorjeta: false });
    expect(regras(r, "ATENCAO")).toEqual(["salario-diferente"]);
    expect(r[0].mensagem).toContain("pago a MAIS R$ 577,80");
  });
  it("setembro/2026 confere", () => {
    const r = auditarSalario(PESSOA, sal({ amount: 5954.74 }), { valor: 5954.74, diasDeFerias: 0, pendenteGorjeta: false });
    expect(r.map((x) => x.severidade)).toEqual(["OK"]);
  });
  it("dias de férias no mês sem desconto no salário: ERRO (dias pagos duas vezes)", () => {
    const r = auditarSalario(PESSOA, sal({ amount: 5000, pago: false, paidAmount: null }, { diasDeFerias: undefined }), { valor: 5000, diasDeFerias: 4, pendenteGorjeta: false });
    expect(regras(r, "ERRO")).toEqual(["salario-ferias"]);
    expect(r[0].mensagem).toContain("duas vezes");
  });
  it("dias de férias descontados que batem: sem erro", () => {
    const r = auditarSalario(PESSOA, sal({ amount: 4000, pago: false, paidAmount: null }, { diasDeFerias: 26 }), { valor: 4000, diasDeFerias: 26, pendenteGorjeta: false });
    expect(regras(r, "ERRO")).toEqual([]);
  });
  it("gorjeta pendente é só atenção", () => {
    expect(regras(auditarSalario(PESSOA, sal({ pago: false }), { valor: 3030, diasDeFerias: 0, pendenteGorjeta: true }), "ATENCAO")).toEqual(["salario-pendente"]);
  });
});

describe("resumo e relatório", () => {
  const lista: Achado[] = [
    { severidade: "OK", regra: "a", pessoa: "Ana", titulo: null, mensagem: "ok" },
    { severidade: "ERRO", regra: "b", pessoa: "Ana", titulo: "Férias", mensagem: "ruim" },
    { severidade: "ATENCAO", regra: "c", pessoa: "Bia", titulo: null, mensagem: "olhe" },
  ];
  it("conta e define o código de saída só por ERRO", () => {
    expect(resumir(lista)).toEqual({ erros: 1, atencoes: 1, oks: 1 });
    expect(codigoDeSaida(lista)).toBe(1);
    expect(codigoDeSaida(lista.filter((x) => x.severidade !== "ERRO"))).toBe(0);
  });
  it("imprime em português, ERRO antes de OK", () => {
    const txt = formatarRelatorio(lista, "Auditoria");
    expect(txt.indexOf("[ERRO]")).toBeLessThan(txt.indexOf("[OK]"));
    expect(txt).toContain("[ATENÇÃO]");
    expect(txt).toContain("REPROVADA");
  });
});
