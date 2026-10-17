import { describe, expect, test } from "vitest";
import { alternarPendencia, ariaSort, comContagem, contagemPorNatureza, contagemPorNome, pendenciasMarcadas, proximaOrdem } from "../filtros";

describe("comContagem", () => {
  test("mostra o número da opção, e zero quando ela não aparece nas contagens", () => {
    const mapa = contagemPorNome([{ nome: "SECOS E GRAOS", count: 104 }]);
    expect(comContagem("SECOS E GRAOS", mapa)).toBe("SECOS E GRAOS (104)");
    expect(comContagem("DOCES", mapa)).toBe("DOCES (0)");
  });

  test("sem contagens ainda (carregando ou falhou), só o nome", () => {
    expect(comContagem("DOCES", undefined)).toBe("DOCES");
  });

  test("natureza usa o valor como chave", () => {
    expect(contagemPorNatureza([{ valor: "INSUMO", count: 800 }])?.get("INSUMO")).toBe(800);
  });
});

describe("pendências combináveis", () => {
  test("liga, desliga e mantém a ordem fixa", () => {
    let csv = "";
    csv = alternarPendencia(csv, "sem-setor");
    csv = alternarPendencia(csv, "sem-subcategoria");
    expect(csv).toBe("sem-subcategoria,sem-setor");
    csv = alternarPendencia(csv, "sem-subcategoria");
    expect(csv).toBe("sem-setor");
    expect(pendenciasMarcadas(csv).has("sem-setor")).toBe(true);
    expect(pendenciasMarcadas("")).toEqual(new Set());
  });
});

describe("ordem da lista", () => {
  test("clicar percorre crescente, decrescente e padrão", () => {
    let ordem = proximaOrdem({ campo: null, dir: "asc" }, "category");
    expect(ordem).toEqual({ campo: "category", dir: "asc" });
    ordem = proximaOrdem(ordem, "category");
    expect(ordem).toEqual({ campo: "category", dir: "desc" });
    ordem = proximaOrdem(ordem, "category");
    expect(ordem).toEqual({ campo: null, dir: "asc" });
  });

  test("trocar de coluna começa crescente", () => {
    expect(proximaOrdem({ campo: "category", dir: "desc" }, "sector")).toEqual({ campo: "sector", dir: "asc" });
  });

  test("aria-sort", () => {
    expect(ariaSort({ campo: "sector", dir: "desc" }, "sector")).toBe("descending");
    expect(ariaSort({ campo: "sector", dir: "asc" }, "sector")).toBe("ascending");
    expect(ariaSort({ campo: null, dir: "asc" }, "sector")).toBe("none");
    expect(ariaSort({ campo: null, dir: "asc" }, "name")).toBe("ascending");
    expect(ariaSort({ campo: "category", dir: "asc" }, "name")).toBe("none");
  });
});
