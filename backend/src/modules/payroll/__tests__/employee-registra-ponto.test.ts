import { describe, expect, it } from "vitest";
import { lerRegistraPonto } from "../employee.routes.js";

describe("lerRegistraPonto", () => {
  it("não mexe quando o corpo não traz o campo", () => {
    expect(lerRegistraPonto({ firstName: "Ana" })).toEqual({ dados: {} });
  });
  it("grava sim e não", () => {
    expect(lerRegistraPonto({ registraPonto: true })).toEqual({ dados: { registraPonto: true } });
    expect(lerRegistraPonto({ registraPonto: false })).toEqual({ dados: { registraPonto: false } });
  });
  it("recusa o que não é booleano (\"false\" em texto não vira true)", () => {
    for (const v of ["false", "true", 1, 0, null, ""]) {
      expect(lerRegistraPonto({ registraPonto: v })).toHaveProperty("erro");
    }
  });
});
