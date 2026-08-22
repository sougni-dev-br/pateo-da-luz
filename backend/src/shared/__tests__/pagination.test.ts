import { describe, expect, it } from "vitest";
import { resolvePagination } from "../pagination.js";

describe("resolvePagination", () => {
  it("sem parametros devolve tudo, para nao quebrar quem precisa da lista inteira", () => {
    // Compras monta autocomplete offline e Estoque precisa dos produtos do
    // setor: as duas chamam sem paginar e esperam todos os registros.
    expect(resolvePagination({})).toEqual({ page: 1, pageSize: null, skip: 0, take: undefined });
  });

  it("pagina quando page e informado", () => {
    expect(resolvePagination({ page: "1" })).toMatchObject({ page: 1, pageSize: 50, skip: 0, take: 50 });
    expect(resolvePagination({ page: "3" })).toMatchObject({ page: 3, skip: 100, take: 50 });
  });

  it("respeita pageSize dentro do limite", () => {
    expect(resolvePagination({ page: "1", pageSize: "20" })).toMatchObject({ pageSize: 20, take: 20 });
    expect(resolvePagination({ page: "2", pageSize: "20" })).toMatchObject({ skip: 20, take: 20 });
  });

  it("limita pageSize para nao virar um jeito de baixar tudo", () => {
    expect(resolvePagination({ page: "1", pageSize: "5000" })).toMatchObject({ pageSize: 200, take: 200 });
  });

  it("pageSize sozinho ja liga a paginacao", () => {
    expect(resolvePagination({ pageSize: "10" })).toMatchObject({ page: 1, pageSize: 10, take: 10 });
  });

  it("valor invalido cai no padrao em vez de quebrar", () => {
    expect(resolvePagination({ page: "abc" })).toMatchObject({ page: 1, take: 50 });
    expect(resolvePagination({ page: "0" })).toMatchObject({ page: 1, skip: 0 });
    expect(resolvePagination({ page: "-5" })).toMatchObject({ page: 1, skip: 0 });
    expect(resolvePagination({ page: "1", pageSize: "0" })).toMatchObject({ pageSize: 50 });
    expect(resolvePagination({ page: "1", pageSize: "-3" })).toMatchObject({ pageSize: 50 });
  });

  it("aceita numero alem de string", () => {
    expect(resolvePagination({ page: 2, pageSize: 25 })).toMatchObject({ page: 2, pageSize: 25, skip: 25 });
  });
});
