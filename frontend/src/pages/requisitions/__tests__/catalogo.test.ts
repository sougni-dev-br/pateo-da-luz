import { describe, expect, test } from "vitest";
import type { RequisitionCatalogItem } from "../../../api/client";
import { SEM_LOCAL, combinaComBusca, contarPorLocal, filtrarCatalogo, normalizarBusca, passoDaUnidade, somarPasso, turnoPelaHora, type Filtro } from "../catalogo";

const item = (id: string, name: string, balance: number, extra: Partial<RequisitionCatalogItem> = {}): RequisitionCatalogItem => ({
  id, name, code: id.toUpperCase(), unit: "KG", conversions: [], embalagemInferida: null, sectorId: "camara", balance, ...extra
});

const itens = [
  item("a1", "ALFACE AMERICANA", 44),
  item("a2", "AÇAFRÃO", 3, { sectorId: "seco" }),
  item("a3", "AMENDOIM", 0),
  item("a4", "BACON PEÇA", 3.6, { sectorId: null })
];
const filtro = (extra: Partial<Filtro> = {}): Filtro => ({ texto: "", setorId: null, visao: "TODOS", mostrarSemSaldo: false, ...extra });
const ids = (lista: RequisitionCatalogItem[]) => lista.map((i) => i.id);

describe("busca", () => {
  test("ignora acento, caixa e espaço sobrando", () => {
    expect(normalizarBusca("  AÇAFRÃO  Peça ")).toBe("acafrao peca");
    expect(combinaComBusca(itens[1], "acafrao")).toBe(true);
  });

  test("todas as palavras precisam aparecer: 'alf am' acha ALFACE AMERICANA", () => {
    expect(combinaComBusca(itens[0], "alf am")).toBe(true);
    expect(combinaComBusca(itens[0], "alf xyz")).toBe(false);
  });

  test("acha pelo código", () => {
    expect(combinaComBusca(itens[3], "a4")).toBe(true);
  });
});

describe("filtrarCatalogo", () => {
  test("esconde o que não tem saldo por padrão", () => {
    expect(ids(filtrarCatalogo(itens, {}, new Set(), filtro()))).toEqual(["a1", "a2", "a4"]);
  });

  test("mostra sem saldo quando a pessoa pede ou procura pelo produto", () => {
    expect(ids(filtrarCatalogo(itens, {}, new Set(), filtro({ mostrarSemSaldo: true })))).toContain("a3");
    expect(ids(filtrarCatalogo(itens, {}, new Set(), filtro({ texto: "amend" })))).toEqual(["a3"]);
  });

  test("filtra por local, inclusive o 'sem local'", () => {
    expect(ids(filtrarCatalogo(itens, {}, new Set(), filtro({ setorId: "seco" })))).toEqual(["a2"]);
    expect(ids(filtrarCatalogo(itens, {}, new Set(), filtro({ setorId: SEM_LOCAL })))).toEqual(["a4"]);
  });

  test("escolhido sem saldo continua visível para a pessoa ver o problema", () => {
    const escolhas = { a3: { unit: "KG", quantity: "1" } };
    expect(ids(filtrarCatalogo(itens, escolhas, new Set(["a3"]), filtro()))).toContain("a3");
  });

  test("visões 'escolhidos' e 'com problema'", () => {
    const escolhas = { a1: { unit: "KG", quantity: "1" }, a3: { unit: "KG", quantity: "2" } };
    expect(ids(filtrarCatalogo(itens, escolhas, new Set(["a3"]), filtro({ visao: "ESCOLHIDOS" })))).toEqual(["a1", "a3"]);
    expect(ids(filtrarCatalogo(itens, escolhas, new Set(["a3"]), filtro({ visao: "PROBLEMA" })))).toEqual(["a3"]);
  });

  test("conta produtos por local respeitando 'mostrar sem saldo'", () => {
    expect(contarPorLocal(itens, false).get("camara")).toBe(1);
    expect(contarPorLocal(itens, true).get("camara")).toBe(2);
    expect(contarPorLocal(itens, false).get(SEM_LOCAL)).toBe(1);
  });
});

describe("passo e turno", () => {
  test("passo cabe na unidade: 100 g, meio quilo, uma unidade", () => {
    expect(passoDaUnidade("G")).toBe(100);
    expect(passoDaUnidade("kg")).toBe(0.5);
    expect(passoDaUnidade("CX")).toBe(1);
  });

  test("somar e subtrair passo, com vírgula decimal e sem passar de zero", () => {
    expect(somarPasso("", 0.5, 1)).toBe("0,5");
    expect(somarPasso("2,5", 0.5, 1)).toBe("3");
    expect(somarPasso("0,5", 0.5, -1)).toBe("");
    expect(somarPasso("", 1, -1)).toBe("");
    expect(somarPasso("0,1", 0.2, 1)).toBe("0,3");
  });

  test("turno pelo horário", () => {
    expect(turnoPelaHora(new Date(2026, 9, 15, 9))).toBe("MORNING");
    expect(turnoPelaHora(new Date(2026, 9, 15, 14))).toBe("AFTERNOON");
    expect(turnoPelaHora(new Date(2026, 9, 15, 20))).toBe("NIGHT");
  });
});
