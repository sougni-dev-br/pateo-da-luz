import { describe, expect, test } from "vitest";
import {
  type ParticipanteDoRecibo, baseDoPagoAntes, discriminacaoDoMes, horasDecimais, recebeReciboDoMes, reciboDoMes, reciboPagoAntes, resumirPagosAntes,
} from "../recibo-pagamento.js";
import { round2 } from "../vt-calc.js";

// Recibo de pagamento de quem não tem registro: a discriminação tem de fechar no A pagar da
// lista (mesma conta) e a divergência com o acerto no Contas a Pagar aparece. Dados fictícios.

// A conta da lista (tip-rateio): salário − adiantamento − quinzena + gorjeta − vales + créditos + HE + noturno + DSR.
function contaDaLista(p: Omit<ParticipanteDoRecibo, "totalAPagar" | "netCommission">) {
  const net = round2((p.foraDaGorjeta ? 0 : p.rateioAmount) - p.descontos + p.creditos);
  return round2(p.salarioProporcional - (p.adiantamentoSalarial ?? 0) - (p.primeiraQuinzena ?? 0) + net
    + (p.valorHoraExtra ?? 0) + (p.valorAdicionalNoturno ?? 0) + (p.valorDsr ?? 0));
}

function pessoa(over: Partial<ParticipanteDoRecibo> = {}): ParticipanteDoRecibo {
  const vales = over.vales ?? [];
  const descontos = round2(vales.filter((v) => v.type !== "CREDITO").reduce((a, v) => a + v.amount, 0));
  const creditos = round2(vales.filter((v) => v.type === "CREDITO").reduce((a, v) => a + v.amount, 0));
  const base = {
    employeeId: "e1", employeeName: "Fulana Exemplo", semRegistro: true, tipoCalculo: "MES", pagoNaRescisao: false,
    foraDaGorjeta: false, pagamentoQuinzenal: false,
    salarioProporcional: 2600, diasSalario: 30, adiantamentoSalarial: 0, primeiraQuinzena: 0,
    rateioAmount: 812.4, descontos, creditos, valorHoraExtra: 0, valorAdicionalNoturno: 0, valorDsr: 0,
    horaExtra: null, adicionalNoturno: null, vales,
    ...over,
  };
  const netCommission = round2(base.rateioAmount - descontos + creditos);
  return { ...base, netCommission, totalAPagar: over.totalAPagar ?? contaDaLista(base) } as ParticipanteDoRecibo;
}

const soma = (linhas: Array<{ valor: number }>) => round2(linhas.reduce((a, l) => a + l.valor, 0));

describe("pagamento do mês: total = A pagar da lista", () => {
  test("com adiantamento, vales, crédito, hora extra, noturno e DSR: vales e créditos só dentro da gorjeta", () => {
    const p = pessoa({
      adiantamentoSalarial: 1040,
      vales: [
        { type: "REFEICAO", amount: 35.5, date: "2026-09-12T00:00:00.000Z", notes: "almoço" },
        { type: "ADIANTAMENTO", amount: 200, date: "2026-09-05T00:00:00.000Z", notes: null },
        { type: "CREDITO", amount: 50, date: "2026-09-20T00:00:00.000Z", notes: "troca de turno" },
      ],
      valorHoraExtra: 106.36, valorAdicionalNoturno: 14.18, valorDsr: 27.79, horaExtra: "6:00", adicionalNoturno: "4:30",
    });
    const d = discriminacaoDoMes(p, null);
    expect(d.total).toBe(p.totalAPagar);
    expect(d.totalLista).toBe(p.totalAPagar);
    expect(soma(d.linhas)).toBe(p.totalAPagar);
    expect(d.linhas.map((l) => `${l.codigo} ${l.descricao}`)).toEqual([
      "1 DIAS TRABALHADOS", "203 GORJETA", "201 HORA EXTRA 50%", "202 ADICIONAL NOTURNO", "250 DSR S/ EXTRAS",
      "981 DESC. ADIANTAMENTO",
    ]);
    // 812,40 − 35,50 − 200,00 + 50,00: a gorjeta já sai líquida dos vales e com os créditos.
    expect(d.linhas[1]).toEqual({ codigo: 203, descricao: "GORJETA", referencia: null, valor: 626.9 });
    expect(d.linhas[0]).toEqual({ codigo: 1, descricao: "DIAS TRABALHADOS", referencia: "30,00", valor: 2600 });
    expect(d.linhas[5]).toEqual({ codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "1.040,00", valor: -1040 });
    expect(d.linhas.some((l) => l.codigo === 990 || l.codigo === 300)).toBe(false);
    expect(d.linhas[2]).toMatchObject({ referencia: "6,00", valor: 106.36 });
    expect(d.linhas[3]).toMatchObject({ referencia: "4,50", valor: 14.18 });
    expect(d.linhas.some((l) => l.codigo === 999)).toBe(false);
  });

  test("com 1ª quinzena já paga e dias proporcionais", () => {
    const p = pessoa({ diasSalario: 1, salarioProporcional: 86.67, primeiraQuinzena: 0, rateioAmount: 0 });
    expect(discriminacaoDoMes(p, null).linhas[0].referencia).toBe("1,00");
    const q = pessoa({ primeiraQuinzena: 1300, pagamentoQuinzenal: true });
    const d = discriminacaoDoMes(q, null);
    expect(d.linhas.find((l) => l.codigo === 982)).toEqual({ codigo: 982, descricao: "DESC. 1ª QUINZENA", referencia: "1.300,00", valor: -1300 });
    expect(d.total).toBe(q.totalAPagar);
    expect(soma(d.linhas)).toBe(q.totalAPagar);
  });

  test("fora da gorjeta com vale: uma linha VALES (desconto), sem falar em gorjeta", () => {
    const p = pessoa({ foraDaGorjeta: true, rateioAmount: 0, vales: [{ type: "OUTRO", amount: 20, date: null, notes: null }] });
    const d = discriminacaoDoMes(p, null);
    expect(d.linhas.some((l) => /GORJETA/.test(l.descricao))).toBe(false);
    expect(d.linhas.find((l) => l.valor === -20)).toEqual({ codigo: 990, descricao: "VALES", referencia: null, valor: -20 });
    expect(d.total).toBe(p.totalAPagar);
  });

  test("fora da gorjeta com crédito: uma linha CRÉDITOS (vencimento)", () => {
    const p = pessoa({ foraDaGorjeta: true, rateioAmount: 0, vales: [{ type: "CREDITO", amount: 30, date: null, notes: null }] });
    const d = discriminacaoDoMes(p, null);
    expect(d.linhas.find((l) => l.valor === 30)).toEqual({ codigo: 300, descricao: "CRÉDITOS", referencia: null, valor: 30 });
    expect(d.linhas.some((l) => /GORJETA/.test(l.descricao))).toBe(false);
  });

  test("dentro da gorjeta, vales acima dela: continua a linha de gorjeta negativa", () => {
    const p = pessoa({ rateioAmount: 10, vales: [{ type: "OUTRO", amount: 25, date: null, notes: null }] });
    expect(discriminacaoDoMes(p, null).linhas.find((l) => l.codigo === 203)).toEqual({ codigo: 203, descricao: "VALES ACIMA DA GORJETA", referencia: null, valor: -15 });
  });

  test("lista que não fecha com as linhas (fechamento antigo): a diferença vira linha de ajuste", () => {
    const p = pessoa({ totalAPagar: 3400 });
    const d = discriminacaoDoMes(p, null);
    const ajuste = d.linhas.at(-1)!;
    expect(ajuste).toMatchObject({ codigo: 999, descricao: "AJUSTE DO FECHAMENTO DA APURAÇÃO" });
    expect(ajuste.valor).toBe(round2(3400 - 3412.4));
    expect(soma(d.linhas)).toBe(3400);
  });
});

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const titulo = (over: Record<string, unknown>) => ({
  employeeId: "e1", amount: 1040, paidAmount: null as number | null, paymentDate: null as Date | null, details: { semRegistro: true }, ...over,
});

describe("resumo dos títulos pagos antes (adiantamento e quinzena)", () => {
  test("soma os títulos por pessoa e tipo; data = a da última baixa", () => {
    const m = resumirPagosAntes([
      titulo({ amount: 500, paidAmount: 500, paymentDate: dia("2026-09-20") }),
      titulo({ amount: 540, paidAmount: 540, paymentDate: dia("2026-09-25") }),
      titulo({ amount: 1300, paidAmount: 1300, paymentDate: dia("2026-09-15"), details: { semRegistro: true, primeiraQuinzena: true } }),
      titulo({ employeeId: "e2", amount: 800 }),
    ]);
    expect(m.get("e1")).toEqual({
      adiantamento: { titulo: 1040, pago: 1040, data: dia("2026-09-25"), titulos: 2, algumAberto: false },
      quinzena: { titulo: 1300, pago: 1300, data: dia("2026-09-15"), titulos: 1, algumAberto: false },
    });
    expect(m.get("e2")).toEqual({ adiantamento: { titulo: 800, pago: 0, data: null, titulos: 1, algumAberto: true } });
  });
});

describe("desconto do que já foi pago no recibo do mês", () => {
  test("desconto do adiantamento e da quinzena trazem a data em que foram pagos", () => {
    const p = pessoa({ adiantamentoSalarial: 966.5, primeiraQuinzena: 0 });
    const d = discriminacaoDoMes(p, null, { adiantamento: { titulo: 966.5, pago: 966.5, data: dia("2026-09-20"), titulos: 1, algumAberto: false } });
    expect(d.linhas.find((l) => l.codigo === 981)).toEqual({ codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "20/09/2026", valor: -966.5 });
  });

  test("um título pago a menor e a lista desconta o pago: título inteiro + complemento; líquido igual", () => {
    const p = pessoa({ adiantamentoSalarial: 966.5 });
    const semComplemento = discriminacaoDoMes(p, null);
    const d = discriminacaoDoMes(p, null, { adiantamento: { titulo: 1040, pago: 966.5, data: dia("2026-09-20"), titulos: 1, algumAberto: false } });
    expect(d.linhas.find((l) => l.codigo === 981)).toEqual({ codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "20/09/2026", valor: -1040 });
    expect(d.linhas.find((l) => l.codigo === 983)).toEqual({ codigo: 983, descricao: "COMPLEMENTO DE ADIANTAMENTO", referencia: null, valor: 73.5 });
    expect(d.total).toBe(semComplemento.total);
    expect(soma(d.linhas)).toBe(d.total);
    expect(d.linhas.some((l) => l.codigo === 999)).toBe(false);
  });

  test("quinzena paga a maior: desconta o título e a diferença como desconto", () => {
    const p = pessoa({ primeiraQuinzena: 1100, adiantamentoSalarial: 0 });
    const d = discriminacaoDoMes(p, null, { quinzena: { titulo: 1000, pago: 1100, data: dia("2026-09-15"), titulos: 1, algumAberto: false } });
    expect(d.linhas.find((l) => l.codigo === 982)?.valor).toBe(-1000);
    expect(d.linhas.find((l) => l.codigo === 984)).toEqual({ codigo: 984, descricao: "1ª QUINZENA PAGA A MAIOR", referencia: null, valor: -100 });
    expect(soma(d.linhas)).toBe(d.total);
  });

  test("dois títulos (500 + 540): só o desconto com o valor da lista, sem complemento", () => {
    const p = pessoa({ adiantamentoSalarial: 1040 });
    const d = discriminacaoDoMes(p, null, { adiantamento: { titulo: 1080, pago: 1040, data: dia("2026-09-25"), titulos: 2, algumAberto: false } });
    expect(d.linhas.filter((l) => l.codigo >= 981 && l.codigo <= 984)).toEqual([
      { codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "25/09/2026", valor: -1040 },
    ]);
    expect(soma(d.linhas)).toBe(p.totalAPagar);
  });

  test("título ainda em aberto: só o desconto da lista", () => {
    const p = pessoa({ adiantamentoSalarial: 1040 });
    const d = discriminacaoDoMes(p, null, { adiantamento: { titulo: 1100, pago: 0, data: null, titulos: 1, algumAberto: true } });
    expect(d.linhas.filter((l) => l.codigo >= 981 && l.codigo <= 984)).toEqual([
      { codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "1.040,00", valor: -1040 },
    ]);
  });

  test("limite do mês: proporcional 600, adiantamento 1.040 pago inteiro → desconta só os 600 da lista", () => {
    const p = pessoa({ diasSalario: 7, salarioProporcional: 600, adiantamentoSalarial: 600 });
    const d = discriminacaoDoMes(p, null, { adiantamento: { titulo: 1040, pago: 1040, data: dia("2026-09-20"), titulos: 1, algumAberto: false } });
    expect(d.linhas.filter((l) => l.codigo >= 981 && l.codigo <= 984)).toEqual([
      { codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "20/09/2026", valor: -600 },
    ]);
    expect(d.linhas.some((l) => /COMPLEMENTO/.test(l.descricao))).toBe(false);
    expect(soma(d.linhas)).toBe(p.totalAPagar);
  });

  test("limite do mês com pago a menor (lista < pago): sem complemento", () => {
    const p = pessoa({ diasSalario: 7, salarioProporcional: 600, adiantamentoSalarial: 600 });
    const d = discriminacaoDoMes(p, null, { adiantamento: { titulo: 1040, pago: 900, data: dia("2026-09-20"), titulos: 1, algumAberto: false } });
    expect(d.linhas.filter((l) => l.codigo >= 981 && l.codigo <= 984)).toEqual([
      { codigo: 981, descricao: "DESC. ADIANTAMENTO", referencia: "20/09/2026", valor: -600 },
    ]);
  });

  test("sem título (não baixado): a referência continua o valor", () => {
    const d = discriminacaoDoMes(pessoa({ adiantamentoSalarial: 1040 }), null);
    expect(d.linhas.find((l) => l.codigo === 981)?.referencia).toBe("1.040,00");
  });
});

describe("quem tem recibo do mês", () => {
  test("como o acerto, e fora quem saiu e ainda não tem o valor da rescisão", () => {
    expect(recebeReciboDoMes(pessoa())).toBe(true);
    expect(recebeReciboDoMes(pessoa({ rescisaoPendente: true } as Partial<ParticipanteDoRecibo>))).toBe(false);
    expect(recebeReciboDoMes(pessoa({ pagoNaRescisao: true }))).toBe(false);
    expect(recebeReciboDoMes(pessoa({ totalAPagar: 0 }))).toBe(false);
  });

  test("leva pagamentoQuinzenal (o mês em que a pessoa recebe)", () => {
    expect(reciboDoMes(pessoa({ pagamentoQuinzenal: true }), { nome: "X", cpf: null }, null, 2026, 9).pagamentoQuinzenal).toBe(true);
    expect(reciboDoMes(pessoa(), { nome: "X", cpf: null }, null, 2026, 9).pagamentoQuinzenal).toBe(false);
  });
});

describe("acerto no Contas a Pagar", () => {
  test("mesmo valor da lista: sem ajuste; a data é a do pagamento", () => {
    const p = pessoa();
    const r = reciboDoMes(p, { nome: "Fulana Exemplo", cpf: "11122233344" }, { amount: p.totalAPagar, paidAmount: p.totalAPagar, paymentDate: new Date("2026-10-07T12:00:00Z") }, 2026, 9);
    expect(r.total).toBe(p.totalAPagar);
    expect(r.linhas.some((l) => l.codigo === 999)).toBe(false);
    expect(r.dataPagamento).toBe("2026-10-07");
    expect(r.acerto).toEqual({ valor: p.totalAPagar, pago: true });
    expect(r.referencia).toBe("pagamento do mês de 09/2026");
  });

  test("acerto com outro valor: o recibo usa o acerto e mostra a diferença como ajuste", () => {
    const p = pessoa();
    const r = reciboDoMes(p, { nome: "Fulana Exemplo", cpf: null }, { amount: 3500, paidAmount: null, paymentDate: null }, 2026, 9);
    expect(r.total).toBe(3500);
    expect(r.totalLista).toBe(p.totalAPagar);
    const ajuste = r.linhas.at(-1)!;
    expect(ajuste).toMatchObject({ codigo: 999, descricao: "AJUSTE CONTAS A PAGAR (LISTA 3.412,40)", referencia: "3.500,00" });
    expect(ajuste.valor).toBe(round2(3500 - p.totalAPagar));
    expect(soma(r.linhas)).toBe(3500);
    expect(r.dataPagamento).toBeNull();
  });

  test("baixado com valor pago diferente: vale o pago", () => {
    const p = pessoa();
    const r = reciboDoMes(p, { nome: "X", cpf: "" }, { amount: p.totalAPagar, paidAmount: 3000, paymentDate: new Date("2026-10-07T00:00:00Z") }, 2026, 9);
    expect(r.total).toBe(3000);
    expect(r.cpf).toBeNull();
    expect(soma(r.linhas)).toBe(3000);
  });
});

describe("1ª quinzena e adiantamento", () => {
  const titulo = { id: "t1", employeeId: "e1", competenceYear: 2026, competenceMonth: 9, paidAmount: null, paymentDate: null };

  test("quinzena: referência 50% e o valor mensal", () => {
    const r = reciboPagoAntes({ ...titulo, amount: 1300, details: { base: 2600, semRegistro: true, primeiraQuinzena: true } }, { nome: "Fulana Exemplo", cpf: "1" });
    expect(r.tipo).toBe("QUINZENA");
    expect(r.referencia).toBe("1ª quinzena de 09/2026");
    expect(r.total).toBe(1300);
    expect(r.valorMensal).toBe(2600);
    expect(r.linhas).toEqual([{ codigo: 10, descricao: "1ª QUINZENA", referencia: "50%", valor: 1300 }]);
  });

  test("adiantamento: 40% do valor mensal; pago com a data da baixa", () => {
    const r = reciboPagoAntes({
      ...titulo, amount: 1040, paidAmount: 1040, paymentDate: new Date("2026-09-20T00:00:00Z"), details: { base: 2600, percent: 40, semRegistro: true },
    }, { nome: "Fulana Exemplo", cpf: null });
    expect(r.tipo).toBe("ADIANTAMENTO");
    expect(r.referencia).toBe("adiantamento de 09/2026");
    expect(r.linhas[0]).toEqual({ codigo: 20, descricao: "ADIANTAMENTO", referencia: "40%", valor: 1040 });
    expect(r.dataPagamento).toBe("2026-09-20");
  });

  test("pago a menor: o título com a base e a diferença com o motivo; líquido = o que foi pago", () => {
    const r = reciboPagoAntes({
      ...titulo, amount: 1040, paidAmount: 966.5, paymentDate: new Date("2026-09-20T00:00:00Z"),
      details: { base: 2600, percent: 40, semRegistro: true },
    }, { nome: "Fulana Exemplo", cpf: null });
    expect(r.linhas).toEqual([
      { codigo: 20, descricao: "ADIANTAMENTO", referencia: "40%", valor: 1040 },
      { codigo: 999, descricao: "COMPLEMENTO A PAGAR NO PAGAMENTO DO MÊS", referencia: null, valor: -73.5 },
    ]);
    expect(r.total).toBe(966.5);
    expect(soma(r.linhas)).toBe(966.5);
  });

  test("pago a maior sem motivo: vira vencimento, com o rótulo sem parênteses", () => {
    const r = reciboPagoAntes({ ...titulo, amount: 1040, paidAmount: 1100, paymentDate: new Date("2026-09-20T00:00:00Z"), details: { base: 2600, percent: 40 } }, { nome: "X", cpf: null });
    expect(r.linhas[1]).toEqual({ codigo: 999, descricao: "PAGO A MAIOR (DESCONTADO NO PAGAMENTO DO MÊS)", referencia: null, valor: 60 });
    expect(r.total).toBe(1100);
  });

  test("valor que a base não explica (ajustado, proporcional): sai só o valor", () => {
    expect(baseDoPagoAntes({ base: 2600, percent: 40 }, 900)).toBeNull();
    expect(baseDoPagoAntes({ base: 2600, primeiraQuinzena: true }, 866.67)).toBeNull();
    expect(baseDoPagoAntes(null, 100)).toBeNull();
    expect(baseDoPagoAntes({ percent: 40 }, 100)).toBeNull();
  });
});

describe("texto sem empresa e sem a palavra salário", () => {
  test("nenhuma descrição ou referência fala em salário, holerite ou empregado", () => {
    const p = pessoa({ adiantamentoSalarial: 1040, primeiraQuinzena: 0, valorHoraExtra: 10, valorDsr: 2, vales: [{ type: "VALE_CONSUMO", amount: 5, date: null, notes: null }] });
    const r = reciboDoMes(p, { nome: "Fulana Exemplo", cpf: null }, { amount: 1, paidAmount: null, paymentDate: null }, 2026, 9);
    const q = reciboPagoAntes({ id: "t", employeeId: "e1", competenceYear: 2026, competenceMonth: 9, amount: 1040, paidAmount: null, paymentDate: null, details: { base: 2600, percent: 40 } }, { nome: "X", cpf: null });
    const texto = JSON.stringify([r.linhas, r.referencia, q.linhas, q.referencia]);
    expect(texto).not.toMatch(/sal[áa]rio|holerite|empregado|CNPJ|LTDA/i);
  });
});

describe("cabeçalho da pessoa", () => {
  test("função, admissão, aniversário (só dia/mês), valor mensal do mês; código vazio", () => {
    const r = reciboDoMes(pessoa({ baseSalary: 2600 } as Partial<ParticipanteDoRecibo>), {
      nome: "Fulana Exemplo", cpf: null, funcao: " Atendente ", admissao: new Date("2026-03-21T00:00:00Z"), nascimento: new Date("1990-10-12T00:00:00Z"),
    }, null, 2026, 9);
    expect(r).toMatchObject({ codigo: null, funcao: "Atendente", admissao: "2026-03-21", aniversario: "12/10", valorMensal: 2600 });
    expect(JSON.stringify(r)).not.toContain("1990");
  });
  test("horas decimais da referência", () => {
    expect(horasDecimais("7:30")).toBe("7,50");
    expect(horasDecimais("0:20")).toBe("0,33");
    expect(horasDecimais("0:00")).toBeNull();
    expect(horasDecimais(null)).toBeNull();
  });
});

