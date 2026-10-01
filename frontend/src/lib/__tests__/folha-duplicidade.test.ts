import { describe, expect, test } from "vitest";
import { ApiError } from "../../api/client";
import { descreverExistente, descreverSuspeito, fraseJaPago, recusaDaFolha, type ResumoItemFolha } from "../folha-duplicidade";

const resumo = (over: Partial<ResumoItemFolha> = {}): ResumoItemFolha => ({
  id: "x", tipo: "SALARIO", tipoRotulo: "Salário", rotulo: "Extrato 09/2026", competencia: "09/2026", inicioPeriodo: null,
  valor: 1873.4, valorPago: null, status: "PENDING", vencimento: "2026-10-05", pagoEm: null, ...over,
});

describe("recusaDaFolha", () => {
  test("lê o 409 com o código pedido", () => {
    const err = new ApiError("Já existe", 409, { code: "DUPLICIDADE", message: "Já existe", existentes: [resumo()] });
    expect(recusaDaFolha(err, "DUPLICIDADE")?.existentes).toHaveLength(1);
  });

  test("outro código, outro status ou erro comum: null", () => {
    expect(recusaDaFolha(new ApiError("x", 409, { code: "APOS_SAIDA" }), "DUPLICIDADE")).toBeNull();
    expect(recusaDaFolha(new ApiError("x", 400, { code: "DUPLICIDADE" }), "DUPLICIDADE")).toBeNull();
    expect(recusaDaFolha(new Error("x"), "DUPLICIDADE")).toBeNull();
  });
});

describe("textos", () => {
  test("o que já existe: rótulo, valor, situação e vencimento", () => {
    expect(descreverExistente(resumo())).toBe("Extrato 09/2026 · R$ 1.873,40 · em aberto · vence 05/10/2026");
    expect(descreverExistente(resumo({ status: "PAID", pagoEm: "2026-10-05", valorPago: 1870 }))).toBe("Extrato 09/2026 · R$ 1.873,40 · pago em 05/10/2026 (R$ 1.870,00)");
  });

  test("frase da baixa duplicada", () => {
    const pago = resumo({ status: "PAID", pagoEm: "2026-09-28", valorPago: 1990 });
    expect(fraseJaPago("Ana Silva", pago)).toBe("Já foi pago salário 09/2026 de Ana Silva em 28/09/2026 (R$ 1.990,00). Baixar mesmo assim?");
  });

  test("suspeito do lote: já pago e repetido no lote", () => {
    const s = {
      item: resumo({ id: "a" }), pessoa: "Ana Silva",
      jaPagos: [resumo({ id: "p", status: "PAID", pagoEm: "2026-09-28", valor: 1990 })],
      noLote: [resumo({ id: "b", rotulo: "Salário" })],
    };
    expect(descreverSuspeito(s)).toBe("Ana Silva — salário 09/2026: já pago em 28/09/2026 (R$ 1.990,00); repetido neste lote (Salário)");
  });
});
