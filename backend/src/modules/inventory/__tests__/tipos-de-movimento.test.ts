import { describe, expect, test } from "vitest";
import { mensagemDeTipoMigrado } from "../tipos-de-movimento.js";

describe("mensagemDeTipoMigrado", () => {
  test.each(["BREAKAGE", "LOSS"])("%s manda o usuário para o Desperdício", (tipo) => {
    expect(mensagemDeTipoMigrado(tipo)).toMatch(/Desperdicio/);
  });

  test.each(["MANUAL_OUT", "INTERNAL_CONSUMPTION", "EMPLOYEE_PURCHASE", "NEGATIVE_ADJUSTMENT", "PURCHASE_IN", "ADJUSTMENT"])(
    "%s continua sendo movimentação",
    (tipo) => expect(mensagemDeTipoMigrado(tipo)).toBeNull()
  );
});
