import { describe, expect, test } from "vitest";
import type { WasteEntry } from "../../../api/client";
import { SEM_FILTRO, chaveDoLancamento, filtrarLancamentos, temFiltro } from "../filtros";

const e = (parcial: Partial<WasteEntry> & { id: string }): WasteEntry => ({
  kind: "INSUMO", productId: "p1", dishId: null, productName: "Tomate", productCode: "T1", quantity: 1, unit: "KG", enteredQuantity: null, enteredUnit: null,
  reason: "SPOILED", reasonLabel: "Estragado", occurredOn: "2026-10-13", sectorName: "Hortifruti", notes: null, createdAt: "2026-10-13T12:00:00Z",
  cancelledAt: null, cancelReason: null, hasPhoto: false, hasCost: true, registeredById: "u", ...parcial,
});

const lista = [
  e({ id: "1" }),
  e({ id: "2", productId: "p2", productName: "Salmão", productCode: "S2", sectorName: "Câmara fria", reason: "EXPIRED", reasonLabel: "Vencido", notes: "caixa aberta" }),
  e({ id: "3", productId: null, dishId: "d1", kind: "PRATO", productName: "Lasanha", productCode: null, sectorName: null, reason: "PRODUCTION_LEFTOVER", reasonLabel: "Sobra de produção" }),
];

describe("chaveDoLancamento", () => {
  test("insumo usa o id do produto e prato pronto usa dish:<id>, a mesma chave do servidor", () => {
    expect(chaveDoLancamento(lista[0])).toBe("p1");
    expect(chaveDoLancamento(lista[2])).toBe("dish:d1");
  });
});

describe("filtrarLancamentos", () => {
  test("sem recorte devolve tudo", () => {
    expect(filtrarLancamentos(lista, SEM_FILTRO)).toHaveLength(3);
    expect(temFiltro(SEM_FILTRO)).toBe(false);
  });

  test("por motivo, por setor e por item", () => {
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, motivo: "EXPIRED" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, setor: "Câmara fria" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, item: { chave: "dish:d1", rotulo: "Lasanha" } }).map((x) => x.id)).toEqual(["3"]);
  });

  test("'Sem setor' pega os lançamentos sem setor, como o servidor agrupa", () => {
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, setor: "Sem setor" }).map((x) => x.id)).toEqual(["3"]);
  });

  test("busca por texto ignora acento e caixa, e olha nome, código, setor, observação e motivo", () => {
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, busca: "salmao" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, busca: "CAMARA" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, busca: "aberta" }).map((x) => x.id)).toEqual(["2"]);
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, busca: "t1" }).map((x) => x.id)).toEqual(["1"]);
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, busca: "sobra" }).map((x) => x.id)).toEqual(["3"]);
  });

  test("recortes se somam", () => {
    expect(filtrarLancamentos(lista, { ...SEM_FILTRO, motivo: "SPOILED", busca: "salm" })).toEqual([]);
    expect(temFiltro({ ...SEM_FILTRO, busca: "  " })).toBe(false);
  });
});
