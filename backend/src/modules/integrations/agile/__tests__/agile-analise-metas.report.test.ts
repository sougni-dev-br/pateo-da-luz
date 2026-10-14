import { describe, expect, test } from "vitest";
import { montarMetas, limitesDoMes, MIN_DIAS_PARA_PROJETAR, type MesDoHistorico } from "../agile-analise-metas.report.js";
import type { VendaVisao } from "../agile-analise-visao.report.js";

const HOJE = "2026-10-15"; // quinta-feira
const dia = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const UM_DIA = 24 * 60 * 60 * 1000;

const venda = (iso: string, totalAmount: number, people: number, over: Partial<VendaVisao> = {}): VendaVisao => ({
  saleId: `${iso}-${totalAmount}-${people}-${over.saleStatus ?? "R"}`, movementDate: dia(iso), shift: "Almoço", saleStatus: "RECEBIDA", saleHour: "12:30",
  people, totalAmount, subtotalAmount: null, discountAmount: null, cancelledBy: null, cancelReason: null, ...over
});

// Segunda a sábado abrem (R$ 1.000, 10 pessoas); domingo fecha.
function semana(de: string, ate: string, valor = 1000, pessoas = 10): VendaVisao[] {
  const out: VendaVisao[] = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += UM_DIA) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (new Date(t).getUTCDay() !== 0) out.push(venda(iso, valor, pessoas));
  }
  return out;
}

const RITMO = semana("2026-08-20", "2026-10-14");
const MES = semana("2026-10-01", "2026-10-14"); // 12 dias abertos: 12.000 e 120 pessoas
const base = { ano: 2026, mes: 10, hoje: HOJE, vendasMes: MES, vendasRitmo: RITMO, itensCanceladosMes: 0, historico: [] as MesDoHistorico[], metas: {} };
const achar = (r: ReturnType<typeof montarMetas>, i: string) => r.indicadores.find((x) => x.indicador === i)!;

describe("limites do mes", () => {
  test("outubro tem 31 dias e fevereiro bissexto 29", () => {
    expect(limitesDoMes(2026, 10)).toEqual({ inicio: "2026-10-01", fim: "2026-10-31", diasNoMes: 31 });
    expect(limitesDoMes(2028, 2).diasNoMes).toBe(29);
  });
});

describe("faturamento e pessoas: realizado, projecao e situacao", () => {
  test("o realizado e o dos dias FECHADOS; hoje fica de fora", () => {
    const r = montarMetas({ ...base, vendasMes: [...MES, venda(HOJE, 5000, 50)] });
    expect(achar(r, "faturamento").realizado).toBe(12000);
    expect(achar(r, "pessoas").realizado).toBe(120);
  });

  test("projecao = realizado + media do dia da semana nos dias que ainda abrem (domingo fechado)", () => {
    const r = montarMetas({ ...base, metas: { faturamento: 30000 } });
    expect(r.cobertura.diasRestantes).toBe(15); // 15 a 31/10 tem 17 dias, 2 domingos
    expect(achar(r, "faturamento").projecao).toBe(27000);
    expect(achar(r, "pessoas").projecao).toBe(270);
  });

  test("situacao: meta abaixo da projecao no ritmo, acima abaixo, ja batida atingida", () => {
    expect(achar(montarMetas({ ...base, metas: { faturamento: 25000 } }), "faturamento").situacao).toBe("no-ritmo");
    expect(achar(montarMetas({ ...base, metas: { faturamento: 30000 } }), "faturamento").situacao).toBe("abaixo");
    expect(achar(montarMetas({ ...base, metas: { faturamento: 12000 } }), "faturamento").situacao).toBe("atingida");
  });

  test("quanto falta e quanto por dia e preciso vender", () => {
    const f = achar(montarMetas({ ...base, metas: { faturamento: 30000 } }), "faturamento");
    expect(f.faltam).toBe(18000);
    expect(f.porDiaNecessario).toBe(1200); // 18.000 / 15 dias
    expect(f.porDiaAtual).toBe(1000);
    expect(f.progresso).toBe(0.4);
  });

  test("sem meta: situacao sem-meta e nada a cobrar", () => {
    const f = achar(montarMetas(base), "faturamento");
    expect(f.situacao).toBe("sem-meta");
    expect(f.meta).toBeNull();
    expect(f.faltam).toBeNull();
    expect(f.porDiaNecessario).toBeNull();
  });

  test("ritmo com poucos dias de movimento nao projeta", () => {
    const poucos = semana("2026-10-05", "2026-10-10").slice(0, MIN_DIAS_PARA_PROJETAR - 1);
    const r = montarMetas({ ...base, vendasRitmo: poucos, metas: { faturamento: 30000 } });
    expect(r.cobertura.podeProjetar).toBe(false);
    expect(achar(r, "faturamento").projecao).toBeNull();
    expect(achar(r, "faturamento").situacao).toBe("sem-dado");
  });

  test("dia da semana que abriu em menos da metade das vezes e tratado como fechado", () => {
    // Sabados: so 3 das 8 ocorrencias da janela tiveram venda.
    const semSabados = RITMO.filter((v) => v.movementDate.getUTCDay() !== 6);
    const tres = RITMO.filter((v) => v.movementDate.getUTCDay() === 6).slice(0, 3);
    const r = montarMetas({ ...base, vendasRitmo: [...semSabados, ...tres] });
    // Dos 17 dias restantes saem 3 sabados e 2 domingos: sobram 12 dias abertos.
    expect(r.cobertura.diasRestantes).toBe(12);
  });
});

describe("meses encerrados e futuros", () => {
  test("mes encerrado: projecao e o proprio realizado e a situacao e fechada", () => {
    const fechado = semana("2026-10-01", "2026-10-31");
    const r = montarMetas({ ...base, hoje: "2026-11-02", vendasMes: fechado, metas: { faturamento: 30000 } });
    const f = achar(r, "faturamento");
    expect(r.mes.encerrado).toBe(true);
    expect(r.cobertura.diasRestantes).toBe(0);
    expect(f.projecao).toBe(f.realizado);
    expect(f.situacao).toBe("abaixo"); // 27 dias abertos = 27.000
    expect(f.porDiaNecessario).toBeNull();
  });

  test("mes futuro: sem realizado, com projecao pelo ritmo e todos os dias a vender", () => {
    const r = montarMetas({ ...base, ano: 2026, mes: 11, vendasMes: [], metas: { faturamento: 20000 } });
    const f = achar(r, "faturamento");
    expect(r.mes.futuro).toBe(true);
    expect(f.realizado).toBe(0);
    expect(r.cobertura.diasRestantes).toBe(25); // novembro de 2026 tem 5 domingos
    expect(f.projecao).toBe(25000);
    expect(f.situacao).toBe("no-ritmo");
  });
});

describe("ticket por pessoa e perda (taxas)", () => {
  test("ticket: realizado ao ticket do mes; meta menor no ritmo, maior abaixo", () => {
    expect(achar(montarMetas({ ...base, metas: { ticketPessoa: 90 } }), "ticketPessoa")).toMatchObject({ realizado: 100, situacao: "no-ritmo", projecao: null });
    expect(achar(montarMetas({ ...base, metas: { ticketPessoa: 120 } }), "ticketPessoa").situacao).toBe("abaixo");
  });

  test("com menos de 3 dias de movimento a taxa e sem-dado", () => {
    const r = montarMetas({ ...base, vendasMes: semana("2026-10-01", "2026-10-02"), metas: { ticketPessoa: 90 } });
    expect(achar(r, "ticketPessoa")).toMatchObject({ realizado: null, situacao: "sem-dado" });
  });

  test("perda: menor e melhor", () => {
    const cancelada = venda("2026-10-06", 123, 3, { saleStatus: "CANCELADA", saleHour: "19:40" });
    const com = { ...base, vendasMes: [...MES, cancelada] };
    const p = achar(montarMetas({ ...com, metas: { perdaPct: 0.02 } }), "perdaPct");
    expect(p.menorEMelhor).toBe(true);
    expect(p.realizado).toBeCloseTo(0.01, 2);
    expect(p.situacao).toBe("no-ritmo");
    expect(achar(montarMetas({ ...com, metas: { perdaPct: 0.005 } }), "perdaPct").situacao).toBe("abaixo");
  });

  test("perda de mes encerrado dentro da meta vira atingida", () => {
    const fechado = semana("2026-10-01", "2026-10-31");
    const r = montarMetas({ ...base, hoje: "2026-11-02", vendasMes: fechado, metas: { perdaPct: 0.02 } });
    expect(achar(r, "perdaPct").situacao).toBe("atingida");
  });
});

describe("referencias do historico", () => {
  const mesH = (mes: number, faturamento: number, dias = 25): MesDoHistorico => ({
    ano: 2026, mes, indicadores: { diasComMovimento: dias, faturamento, pessoas: faturamento / 100, ticketPessoa: 100 }
  });

  test("media dos 3 meses mais recentes e melhor mes; mes com poucos dias fica de fora", () => {
    const r = montarMetas({ ...base, historico: [mesH(6, 100000), mesH(7, 200000), mesH(8, 400000), mesH(9, 300000), mesH(5, 900000, 4)] });
    expect(achar(r, "faturamento").referencia).toEqual({ media3: 300000, mesesNaMedia: 3, melhor: 400000 });
    expect(achar(r, "pessoas").referencia?.melhor).toBe(4000);
  });

  test("sem historico: sem referencia; perda nunca tem referencia", () => {
    const r = montarMetas(base);
    expect(achar(r, "faturamento").referencia).toBeNull();
    expect(achar(r, "perdaPct").referencia).toBeNull();
  });
});

describe("limites exatos", () => {
  test("14 dias de movimento no ritmo ja permitem projetar; 13 nao", () => {
    const dias = (n: number) => semana("2026-09-01", "2026-10-14").slice(0, n);
    expect(montarMetas({ ...base, vendasRitmo: dias(MIN_DIAS_PARA_PROJETAR) }).cobertura.podeProjetar).toBe(true);
    expect(montarMetas({ ...base, vendasRitmo: dias(MIN_DIAS_PARA_PROJETAR - 1) }).cobertura.podeProjetar).toBe(false);
  });

  test("dia da semana que abriu em exatamente metade das vezes ainda conta como aberto", () => {
    const semSabados = RITMO.filter((v) => v.movementDate.getUTCDay() !== 6);
    const quatro = RITMO.filter((v) => v.movementDate.getUTCDay() === 6).slice(0, 4); // 4 de 8
    // Dos 17 dias restantes saem so os 2 domingos: sobram 15 abertos, sabados incluidos.
    expect(montarMetas({ ...base, vendasRitmo: [...semSabados, ...quatro] }).cobertura.diasRestantes).toBe(15);
  });

  test("exatamente 3 dias de movimento ja bastam para ticket e perda; 2 nao", () => {
    const tres = montarMetas({ ...base, vendasMes: semana("2026-10-01", "2026-10-03"), metas: { ticketPessoa: 90 } });
    expect(achar(tres, "ticketPessoa").realizado).toBe(100);
    const dois = montarMetas({ ...base, vendasMes: semana("2026-10-01", "2026-10-02"), metas: { ticketPessoa: 90 } });
    expect(achar(dois, "ticketPessoa").realizado).toBeNull();
  });

  test("mes do historico com exatamente 10 dias entra na referencia; com 9 nao", () => {
    const h = (dias: number): MesDoHistorico[] => [{ ano: 2026, mes: 9, indicadores: { diasComMovimento: dias, faturamento: 1000, pessoas: 10, ticketPessoa: 100 } }];
    expect(achar(montarMetas({ ...base, historico: h(10) }), "faturamento").referencia).not.toBeNull();
    expect(achar(montarMetas({ ...base, historico: h(9) }), "faturamento").referencia).toBeNull();
  });

  test("meta igual ao realizado esta atingida; igual a projecao esta no ritmo", () => {
    expect(achar(montarMetas({ ...base, metas: { faturamento: 12000 } }), "faturamento").situacao).toBe("atingida");
    expect(achar(montarMetas({ ...base, metas: { faturamento: 27000 } }), "faturamento").situacao).toBe("no-ritmo");
    expect(achar(montarMetas({ ...base, metas: { faturamento: 27001 } }), "faturamento").situacao).toBe("abaixo");
  });

  test("ticket e perda iguais a meta estao dentro dela", () => {
    expect(achar(montarMetas({ ...base, metas: { ticketPessoa: 100 } }), "ticketPessoa").situacao).toBe("no-ritmo");
    const cancelada = venda("2026-10-06", 120, 3, { saleStatus: "CANCELADA", saleHour: "19:40" });
    const r = montarMetas({ ...base, vendasMes: [...MES, cancelada] });
    const perda = achar(r, "perdaPct").realizado as number;
    expect(achar(montarMetas({ ...base, vendasMes: [...MES, cancelada], metas: { perdaPct: perda } }), "perdaPct").situacao).toBe("no-ritmo");
  });

  test("hoje e o ultimo dia do mes: ainda nao encerrou e resta 1 dia; no dia seguinte encerrou", () => {
    const ultimo = montarMetas({ ...base, hoje: "2026-10-31", vendasMes: semana("2026-10-01", "2026-10-30"), metas: { faturamento: 99999 } });
    expect(ultimo.mes.encerrado).toBe(false);
    expect(ultimo.cobertura.diasRestantes).toBe(1); // sabado
    const seguinte = montarMetas({ ...base, hoje: "2026-11-01", vendasMes: semana("2026-10-01", "2026-10-31") });
    expect(seguinte.mes.encerrado).toBe(true);
    expect(seguinte.cobertura.diasRestantes).toBe(0);
  });

  test("hoje e o primeiro dia do mes: o mes ja comecou (nao e futuro), nada realizado e o mes inteiro por abrir", () => {
    const r = montarMetas({ ...base, hoje: "2026-11-01", ano: 2026, mes: 11, vendasMes: [], vendasRitmo: semana("2026-09-06", "2026-10-31") });
    expect(achar(r, "faturamento").realizado).toBe(0);
    expect(r.mes.futuro).toBe(false);
    expect(r.cobertura.diasRestantes).toBe(25);
  });

  test("mes que so comeca amanha e futuro", () => {
    expect(montarMetas({ ...base, hoje: "2026-10-31", ano: 2026, mes: 11, vendasMes: [] }).mes.futuro).toBe(true);
  });

  test("perda nao depende de pessoas informadas: vendas sem pessoas ainda dao a taxa", () => {
    const semPessoas = semana("2026-10-01", "2026-10-14", 1000, 0);
    const cancelada = venda("2026-10-06", 100, 0, { saleStatus: "CANCELADA", saleHour: "19:40" });
    const r = montarMetas({ ...base, vendasMes: [...semPessoas, cancelada], metas: { perdaPct: 0.05, ticketPessoa: 90 } });
    expect(achar(r, "perdaPct").realizado).toBeCloseTo(100 / 12000, 4);
    expect(achar(r, "perdaPct").situacao).toBe("no-ritmo");
    expect(achar(r, "ticketPessoa").realizado).toBeNull();
  });

  test("venda fora da janela de 56 dias nao entra no ritmo", () => {
    const velha = semana("2026-06-01", "2026-06-30", 90000, 900); // bem antes da janela
    const r = montarMetas({ ...base, vendasRitmo: [...RITMO, ...velha], metas: { faturamento: 30000 } });
    expect(achar(r, "faturamento").projecao).toBe(27000);
  });

  test("venda de hoje ou de depois nao entra no ritmo", () => {
    const hojeEDepois = [venda(HOJE, 90000, 900), venda("2026-10-16", 90000, 900)];
    const r = montarMetas({ ...base, vendasRitmo: [...RITMO, ...hojeEDepois], metas: { faturamento: 30000 } });
    expect(achar(r, "faturamento").projecao).toBe(27000);
  });

  test("mes encerrado nao conta venda de depois do fim do mes", () => {
    const fechado = [...semana("2026-10-01", "2026-10-31"), ...semana("2026-11-02", "2026-11-05")];
    const r = montarMetas({ ...base, hoje: "2026-11-10", vendasMes: fechado, metas: { faturamento: 99999 } });
    expect(achar(r, "faturamento").realizado).toBe(27000);
  });

  test("mes encerrado sem ritmo confiavel ainda mostra a projecao igual ao realizado", () => {
    const r = montarMetas({ ...base, hoje: "2026-11-02", vendasMes: semana("2026-10-01", "2026-10-31"), vendasRitmo: [], metas: { faturamento: 99999 } });
    expect(r.cobertura.podeProjetar).toBe(false);
    expect(achar(r, "faturamento").projecao).toBe(27000);
    expect(achar(r, "faturamento").situacao).toBe("abaixo");
  });
});
