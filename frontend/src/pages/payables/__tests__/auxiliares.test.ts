import { describe, expect, it, vi } from "vitest";
import { avisoDeAuxiliares, carregarAuxiliar } from "../auxiliares";

describe("carregarAuxiliar", () => {
  it("não busca de novo quando já há itens", async () => {
    const buscar = vi.fn(async () => ["novo"]);
    const r = await carregarAuxiliar(["antigo"], buscar);
    expect(r).toEqual({ itens: ["antigo"], falhou: false });
    expect(buscar).not.toHaveBeenCalled();
  });

  it("busca quando a lista está vazia", async () => {
    const r = await carregarAuxiliar<string>([], async () => ["a", "b"]);
    expect(r).toEqual({ itens: ["a", "b"], falhou: false });
  });

  it("falha na busca devolve o que havia e marca falhou, sem lançar erro", async () => {
    const r = await carregarAuxiliar<string>([], async () => { throw new Error("500"); });
    expect(r).toEqual({ itens: [], falhou: true });
  });
});

describe("avisoDeAuxiliares", () => {
  it("sem falhas não há aviso", () => {
    expect(avisoDeAuxiliares([])).toBeNull();
  });

  it("junta os nomes em português", () => {
    expect(avisoDeAuxiliares(["fornecedores"])).toContain("carregar fornecedores.");
    expect(avisoDeAuxiliares(["fornecedores", "empresas"])).toContain("fornecedores e empresas");
    expect(avisoDeAuxiliares(["fornecedores", "formas de pagamento", "empresas"])).toContain("fornecedores, formas de pagamento e empresas");
  });
});
