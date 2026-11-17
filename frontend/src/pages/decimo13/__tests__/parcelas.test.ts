import { describe, expect, it } from "vitest";
import { descreverParcela, parcelaClt, parcelaDaLinha, resumirClt, resumirParcela } from "../parcelas";
import { lancada, linhaClt, linhaSr, parcela } from "./fixtures";

describe("parcelaDaLinha", () => {
  it("a lançar: vale o devido e carrega o vencimento da parcela pedida", () => {
    expect(parcelaDaLinha(linhaSr(), 2)).toEqual({ valor: 1200, vencimento: "2026-12-20", situacao: "A_LANCAR", atualizarPara: null, gerar: true });
  });
  it("lançada: vale o que foi lançado e não há o que gerar", () => {
    expect(parcelaDaLinha(linhaSr({ p1: lancada(1000) }), 1)).toMatchObject({ valor: 1000, situacao: "LANCADA", atualizarPara: null, gerar: false });
  });
  it("lançada e não paga com outro valor no cálculo de hoje: avisa para quanto vai", () => {
    const l = linhaSr({ p1: lancada(1000, { devido: 1080, gerar: true }) });
    expect(parcelaDaLinha(l, 1)).toMatchObject({ valor: 1000, situacao: "LANCADA", atualizarPara: 1080, gerar: true });
  });
  it("paga nunca é atualizada, mesmo com valor diferente", () => {
    const l = linhaSr({ p1: lancada(1000, { devido: 1080, paga: true }) });
    expect(parcelaDaLinha(l, 1)).toMatchObject({ situacao: "PAGA", atualizarPara: null });
  });
  it("excluída à mão (existe sem valor lançado) não é recriada", () => {
    const l = linhaSr({ p1: parcela({ existe: true, lancado: null, gerar: false }) });
    expect(parcelaDaLinha(l, 1).situacao).toBe("EXCLUIDA");
  });
  it("sem cálculo não tem parcela", () => {
    expect(parcelaDaLinha(linhaSr({ calculo: null, motivoSemCalculo: "Sem salário" }), 1).situacao).toBe("SEM_CALCULO");
  });
});

describe("resumirParcela", () => {
  it("separa novas, a atualizar, lançadas, excluídas e sem cálculo", () => {
    const linhas = [
      linhaSr(),
      linhaSr({ employeeId: "s2", p1: lancada(1000) }),
      linhaSr({ employeeId: "s3", p1: lancada(900, { devido: 1000, gerar: true }) }),
      linhaSr({ employeeId: "s4", p1: parcela({ existe: true, lancado: null, gerar: false }) }),
      linhaSr({ employeeId: "s5", calculo: null }),
    ].map((l) => parcelaDaLinha(l, 1));
    expect(resumirParcela(linhas)).toEqual({ pessoas: 3, semCalculo: 1, novas: 1, atualizar: 1, lancadas: 2, excluidas: 1, totalNovas: 1000, totalLancado: 1900 });
  });
  it("parcela de valor zero não entra na conta (o gerador a ignora)", () => {
    const l = linhaSr({ p2: { ...parcela({ devido: 0, gerar: false }), excesso: 0 } });
    expect(resumirParcela([parcelaDaLinha(l, 2)]).pessoas).toBe(0);
  });
});

describe("descreverParcela", () => {
  it("usa a data do vencimento quando existe e explica o acerto na 2ª", () => {
    expect(descreverParcela(1, "30/11/2026")).toContain("30/11/2026");
    expect(descreverParcela(2, null)).toContain("acerto");
  });
});

describe("CLT (extrato da contabilidade)", () => {
  it("sem lançamento aguarda o extrato", () => {
    expect(parcelaClt(linhaClt(), 1)).toEqual({ valor: 0, situacao: "AGUARDANDO_EXTRATO" });
  });
  it("distingue lançada de paga, por parcela", () => {
    const l = linhaClt({ parcela1: { valor: 900, pago: true }, parcela2: { valor: 700, pago: false } });
    expect(parcelaClt(l, 1)).toEqual({ valor: 900, situacao: "PAGA" });
    expect(parcelaClt(l, 2)).toEqual({ valor: 700, situacao: "LANCADA" });
  });
  it("resume o total importado e quantos aguardam", () => {
    expect(resumirClt([{ valor: 900, situacao: "PAGA" }, { valor: 0, situacao: "AGUARDANDO_EXTRATO" }])).toEqual({ pessoas: 2, aguardando: 1, total: 900 });
  });
});

describe("quem entrou antes do registro (soma no título do extrato)", () => {
  const calculo = { ano: 2026, avos: 6, avosParcela1: 6, desde: "2026-01-01", salario: 2400, mediaParcela1: 0, mediaFinal: 0, parcela1: 600, total: 1200, parcela2: 600, vencimento1: "2026-11-30", vencimento2: "2026-12-20", memoria: "" };
  const parcela = (over: Record<string, unknown>) => ({ existe: false, paga: false, lancado: null, devido: 600, gerar: true, ...over });
  const linha = (p1: Record<string, unknown>, viaExtrato = false) => ({
    employeeId: "e1", nome: "Bia", setor: null, calculo, motivoSemCalculo: null, p1: parcela(p1), p2: { ...parcela({ devido: 600 }), excesso: 0 }, acerto: null,
    preRegistro: true, semRegistroAte: "2026-06-30", registroEm: "2026-07-01", origem: "SEM_REGISTRO", somaNoExtrato: true, viaExtrato,
  }) as never;

  it("a 2ª aguarda enquanto a 1ª ainda vai ser somada ao título do extrato", () => {
    expect(parcelaDaLinha(linha({ gerar: true }, true), 2).situacao).toBe("AGUARDANDO_EXTRATO");
    expect(parcelaDaLinha(linha({ aguardaExtrato: true, gerar: false }), 2).situacao).toBe("AGUARDANDO_EXTRATO");
  });
  it("com a 1ª somada ao título e em dia, a 2ª já pode ser gerada", () => {
    expect(parcelaDaLinha(linha({ existe: true, lancado: 600, gerar: false, somadaAoExtrato: true }), 2).situacao).not.toBe("AGUARDANDO_EXTRATO");
  });
  it("a 1ª já somada ao título não entra de novo no total", () => {
    const r = parcelaDaLinha(linha({ existe: true, lancado: 600, gerar: false, somadaAoExtrato: true }), 1);
    expect(r.situacao).toBe("SOMADA");
    expect(resumirParcela([r]).novas).toBe(0);
  });
});

describe("2ª parcela com a 1ª lançada à parte (não vai pelo título do extrato)", () => {
  const calculo = { ano: 2026, avos: 6, avosParcela1: 6, desde: "2026-01-01", salario: 2400, mediaParcela1: 0, mediaFinal: 0, parcela1: 600, total: 1200, parcela2: 600, vencimento1: "2026-11-30", vencimento2: "2026-12-20", memoria: "" };
  it("não bloqueia a 2ª só porque a 1ª tem o cálculo mudado (o backend a gera)", () => {
    const l = {
      employeeId: "e1", nome: "Bia", setor: null, calculo, motivoSemCalculo: null,
      p1: { existe: true, paga: false, lancado: 580, devido: 600, gerar: true }, p2: { existe: false, paga: false, lancado: null, devido: 620, gerar: true, excesso: 0 }, acerto: null,
      preRegistro: true, semRegistroAte: "2026-06-30", registroEm: "2026-07-01", origem: "SEM_REGISTRO", somaNoExtrato: true, viaExtrato: false,
    } as never;
    expect(parcelaDaLinha(l, 2).situacao).not.toBe("AGUARDANDO_EXTRATO");
  });
});
