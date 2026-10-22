import { describe, expect, test } from "vitest";
import { destinoDaPendencia } from "../fechamento-destinos";

describe("destinoDaPendencia", () => {
  test("cada pendência conhecida leva ao lugar onde se resolve", () => {
    expect(destinoDaPendencia("card:c1")).toEqual({ rotulo: "Abrir Cartões", rota: "/financeiro/cartoes" });
    expect(destinoDaPendencia("block:eventRevenue")).toEqual({ rotulo: "Lançar evento", rota: "/financeiro/faturamento" });
    expect(destinoDaPendencia("delivery:KEETA")).toEqual({ rotulo: "Abrir Delivery", rota: "/financeiro/delivery" });
    expect(destinoDaPendencia("block:payrollNotLaunched")?.rota).toBe("/rh/folha");
    expect(destinoDaPendencia("block:tipsNotClosed")?.rota).toBe("/rh/gorjeta");
    expect(destinoDaPendencia("block:taxes")?.rota).toBe("/financeiro/impostos");
    expect(destinoDaPendencia("block:finalInventory")?.rota).toBe("/estoque/contagens");
    expect(destinoDaPendencia("block:inventoryItemsWithoutCost")?.rota).toBe("/estoque/inventario");
    expect(destinoDaPendencia("supplier:s1")?.rota).toBe("/compras");
  });

  test("chave desconhecida não inventa link", () => {
    expect(destinoDaPendencia("block:novaCoisa")).toBeNull();
  });

  test("toda rota é interna e absoluta (navega sem recarregar)", () => {
    const chaves = [
      "card:x", "delivery:IFOOD", "supplier:y", "block:revenue", "block:eventRevenue",
      "block:purchasesWithoutItems", "block:purchaseDateFarFromCompetence",
      "block:payrollNotLaunched", "block:payrollWithoutDreCategory", "block:tipsNotClosed",
      "block:taxes", "block:taxesWithoutCompetence", "block:finalInventory", "block:inventoryItemsWithoutCost"
    ];
    for (const k of chaves) {
      const d = destinoDaPendencia(k);
      expect(d, k).not.toBeNull();
      expect(d!.rota.startsWith("/")).toBe(true);
      expect(d!.rota.startsWith("//")).toBe(false);
    }
  });
});
