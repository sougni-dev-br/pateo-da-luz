import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), carregarReferencia: vi.fn(), pratos: vi.fn() }));
vi.mock("../../../config/database.js", () => ({ prisma: { product: { findMany: mocks.findMany } } }));
vi.mock("../../inventory/custo-de-referencia.js", () => ({ carregarCustosDeReferencia: mocks.carregarReferencia }));
vi.mock("../dish-custo-salao.js", () => ({ carregarPratosDoSalaoComCusto: mocks.pratos }));

import { simularCustoDeReferencia } from "../dish-custo-referencia.simulacao.js";

const produto = (id: string, atual: number) => ({ id, externalCode: id, name: `P ${id}`, unit: "UN", stockUnit: null, inventoryStock: { averageCost: atual } });
const prato = (id: string, custoPorcao: number | null) => ({ id, nome: `Prato ${id}`, precoFicha: 30, custoPorcao, itensNaFicha: 1, custoCompleto: true });

describe("simularCustoDeReferencia", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista so o que muda mais de 5% ou precisa de revisao e mede o prato antes e depois", async () => {
    mocks.findMany.mockResolvedValue([produto("guardanapo", 490.72), produto("igual", 10), produto("chopp", 19.7)]);
    mocks.carregarReferencia.mockResolvedValue(new Map([
      ["guardanapo", { valor: 8.18, fonte: "COMPRAS_DO_PERIODO", detalhe: null, revisar: null }],
      ["igual", { valor: 10.2, fonte: "ULTIMA_COMPRA", detalhe: null, revisar: null }],
      ["chopp", { valor: 19.7, fonte: "ESTOQUE", detalhe: null, revisar: "base suspeita" }]
    ]));
    mocks.pratos.mockImplementation(async (_c: unknown, referencia: boolean) => [prato("a", referencia ? 5 : 12), prato("b", 7)]);

    const r = await simularCustoDeReferencia();

    expect(r.produtos.map((p) => p.codigo)).toEqual(["guardanapo", "chopp"]);
    expect(r.resumo).toMatchObject({ produtos: 3, mudamMaisDe5: 1, paraRevisar: 1, pratos: 2, pratosComDiferenca: 1, somaDasDiferencas: -7 });
    expect(r.pratos).toEqual([expect.objectContaining({ id: "a", antes: 12, depois: 5, diferenca: -7 })]);
    expect(mocks.pratos).toHaveBeenCalledWith(expect.anything(), false);
    expect(mocks.pratos).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("prato sem custo antes ou depois nao entra na soma", async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.carregarReferencia.mockResolvedValue(new Map());
    mocks.pratos.mockImplementation(async (_c: unknown, referencia: boolean) => [prato("x", referencia ? 3 : null)]);
    const r = await simularCustoDeReferencia();
    expect(r.pratos).toEqual([]);
    expect(r.resumo.somaDasDiferencas).toBe(0);
  });
});
