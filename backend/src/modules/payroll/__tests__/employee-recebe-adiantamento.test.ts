import { describe, expect, it } from "vitest";
import { lerRecebeAdiantamento } from "../employee.routes.js";

describe("lerRecebeAdiantamento", () => {
  it("não mexe quando o corpo não traz o campo", () => {
    expect(lerRecebeAdiantamento({ firstName: "Ana" })).toEqual({ dados: {} });
  });
  it("grava sim e não", () => {
    expect(lerRecebeAdiantamento({ recebeAdiantamento: true })).toEqual({ dados: { recebeAdiantamento: true } });
    expect(lerRecebeAdiantamento({ recebeAdiantamento: false })).toEqual({ dados: { recebeAdiantamento: false } });
  });
  it("recusa o que não é booleano (\"false\" em texto não vira true)", () => {
    for (const v of ["false", "true", 1, 0, null, ""]) {
      expect(lerRecebeAdiantamento({ recebeAdiantamento: v })).toHaveProperty("erro");
    }
  });
});
