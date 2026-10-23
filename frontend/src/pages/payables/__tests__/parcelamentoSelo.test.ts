import { describe, expect, it } from "vitest";
import type { Payable } from "../../../api/client";
import { seloDoTitulo } from "../regras";

// Dados fictícios.
const base = { id: "i1", sourceType: "DIRECT" } as Payable;

describe("seloDoTitulo de parcelamento em lote", () => {
  it("mostra 'Parcelamento n/total' com a descrição como dica", () => {
    const selo = seloDoTitulo({ ...base, planDescription: "Acordo fictício", planInstallmentNumber: 2, planInstallmentCount: 12 });
    expect(selo).toEqual({ rotulo: "Parcelamento 2/12", tom: "parcelamento", dica: "Acordo fictício" });
  });
  it("título comum de compra continua sem selo", () => {
    expect(seloDoTitulo(base)).toBeNull();
  });
});
