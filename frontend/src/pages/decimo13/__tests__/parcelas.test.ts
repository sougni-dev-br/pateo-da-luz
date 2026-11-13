import { describe, expect, it } from "vitest";
import type { Decimo13Linha } from "../../../api/client";
import { descreverParcela, parcelaDaLinha, resumirParcela } from "../parcelas";

const calculo = { ano: 2026, avos: 12, desde: "2026-01-01", salario: 2000, mediaVariaveis: 0, base: 2000, total: 2000,
  parcela1: 1000, parcela2: 1000, vencimento1: "2026-11-30", vencimento2: "2026-12-20", memoria: "" };
const linha = (over: Partial<Decimo13Linha>): Decimo13Linha => ({
  employeeId: "e", nome: "Pessoa", setor: null, calculo, motivoSemCalculo: null, parcela1Existe: false, parcela2Existe: false,
  preRegistro: false, semRegistroAte: null, registroEm: null, ...over });

describe("parcelaDaLinha", () => {
  it("devolve valor e vencimento da parcela pedida", () => {
    expect(parcelaDaLinha(linha({}), 2)).toEqual({ valor: 1000, vencimento: "2026-12-20", situacao: "A_LANCAR" });
  });
  it("marca lançada só a parcela que existe", () => {
    const l = linha({ parcela1Existe: true });
    expect(parcelaDaLinha(l, 1).situacao).toBe("LANCADA");
    expect(parcelaDaLinha(l, 2).situacao).toBe("A_LANCAR");
  });
  it("sem cálculo não tem parcela", () => {
    expect(parcelaDaLinha(linha({ calculo: null }), 1).situacao).toBe("SEM_CALCULO");
  });
});

describe("resumirParcela", () => {
  it("separa o que falta lançar do que já foi lançado", () => {
    const r = resumirParcela([
      parcelaDaLinha(linha({}), 1),
      parcelaDaLinha(linha({ parcela1Existe: true }), 1),
      parcelaDaLinha(linha({ calculo: null }), 1),
    ]);
    expect(r).toEqual({ pessoas: 2, semCalculo: 1, aLancar: 1, lancadas: 1, totalALancar: 1000, totalLancado: 1000 });
  });
  it("ignora parcela de valor zero (o backend não a lança)", () => {
    const zero = linha({ calculo: { ...calculo, parcela2: 0 } });
    expect(resumirParcela([parcelaDaLinha(zero, 2)]).aLancar).toBe(0);
  });
});

describe("descreverParcela", () => {
  it("usa a data do vencimento quando existe", () => {
    expect(descreverParcela(1, "30/11/2026")).toContain("30/11/2026");
  });
});

describe("CLT (extrato da contabilidade)", () => {
  const clt = (over: Partial<import("../../../api/client").Decimo13LinhaClt>) => ({ employeeId: "c", nome: "Pessoa CLT", setor: null, parcela1: null, parcela2: null, ...over });
  it("sem lançamento aguarda o extrato", async () => {
    const { parcelaClt } = await import("../parcelas");
    expect(parcelaClt(clt({}), 1)).toEqual({ valor: 0, situacao: "AGUARDANDO_EXTRATO" });
  });
  it("distingue lançada de paga, por parcela", async () => {
    const { parcelaClt } = await import("../parcelas");
    const l = clt({ parcela1: { valor: 900, pago: true }, parcela2: { valor: 700, pago: false } });
    expect(parcelaClt(l, 1)).toEqual({ valor: 900, situacao: "PAGA" });
    expect(parcelaClt(l, 2)).toEqual({ valor: 700, situacao: "LANCADA" });
  });
  it("resume o total importado e quantos aguardam", async () => {
    const { resumirClt } = await import("../parcelas");
    expect(resumirClt([{ valor: 900, situacao: "PAGA" }, { valor: 0, situacao: "AGUARDANDO_EXTRATO" }])).toEqual({ pessoas: 2, aguardando: 1, total: 900 });
  });
});
