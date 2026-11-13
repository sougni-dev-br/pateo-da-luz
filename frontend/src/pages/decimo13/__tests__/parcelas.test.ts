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
