import { describe, expect, test } from "vitest";
import { escolherCusto, temCustoDoSistema, validarCustoInformado, type CandidatosDoCusto } from "../custo-inventario";

const vazio: CandidatosDoCusto = { periodo: null, ultimaCompra: null, base: null, informado: null };

describe("escolherCusto", () => {
  test("compras do periodo vem primeiro", () => {
    const custo = escolherCusto({ ...vazio, periodo: 7.5, ultimaCompra: { valor: 9, data: new Date("2026-09-20T00:00:00Z") }, base: { valor: 6, ano: 2026, mes: 8 } });
    expect(custo).toEqual({ valor: 7.5, fonte: "COMPRAS_DO_PERIODO", detalhe: null });
  });

  test("sem compra no periodo usa a ultima compra de qualquer data", () => {
    const custo = escolherCusto({ ...vazio, ultimaCompra: { valor: 38.59, data: new Date("2026-08-14T00:00:00Z") }, base: { valor: 30, ano: 2026, mes: 8 } });
    expect(custo).toEqual({ valor: 38.59, fonte: "ULTIMA_COMPRA", detalhe: "compra de 14/08/2026" });
  });

  test("produto que nunca teve compra no sistema usa a base anterior", () => {
    const custo = escolherCusto({ ...vazio, base: { valor: 66.25, ano: 2026, mes: 8 } });
    expect(custo).toEqual({ valor: 66.25, fonte: "BASE_ANTERIOR", detalhe: "base de 08/2026" });
  });

  test("informado so quando o sistema nao tem nenhum", () => {
    const informado = { valor: 120, por: "Pessoa Teste", em: null };
    expect(escolherCusto({ ...vazio, informado })).toEqual({ valor: 120, fonte: "INFORMADO", detalhe: "informado por Pessoa Teste" });
    expect(escolherCusto({ ...vazio, base: { valor: 50, ano: 2026, mes: 8 }, informado })?.fonte).toBe("BASE_ANTERIOR");
  });

  test("zero e negativo nao contam como custo", () => {
    expect(escolherCusto({ ...vazio, periodo: 0, ultimaCompra: { valor: -1, data: null }, base: { valor: 0, ano: 2026, mes: 8 } })).toBeNull();
  });
});

describe("temCustoDoSistema", () => {
  test("ignora o informado", () => {
    expect(temCustoDoSistema({ ...vazio, informado: { valor: 10, por: null, em: null } })).toBe(false);
    expect(temCustoDoSistema({ ...vazio, base: { valor: 10, ano: 2026, mes: 8 } })).toBe(true);
  });
});

describe("validarCustoInformado", () => {
  test("aceita virgula e milhar", () => {
    expect(validarCustoInformado("1.234,56")).toEqual({ ok: true, valor: 1234.56 });
    expect(validarCustoInformado("89,9")).toEqual({ ok: true, valor: 89.9 });
    expect(validarCustoInformado(12.5)).toEqual({ ok: true, valor: 12.5 });
  });

  test("vazio limpa", () => {
    expect(validarCustoInformado("")).toEqual({ ok: true, valor: null });
    expect(validarCustoInformado(null)).toEqual({ ok: true, valor: null });
  });

  test("recusa zero, texto e valor absurdo", () => {
    expect(validarCustoInformado("0").ok).toBe(false);
    expect(validarCustoInformado("abc").ok).toBe(false);
    expect(validarCustoInformado("200000").ok).toBe(false);
  });
});
