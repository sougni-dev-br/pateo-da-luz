import { describe, expect, it } from "vitest";
import { lerSalarioCombinado } from "../employee.routes.js";

describe("lerSalarioCombinado", () => {
  it("não mexe quando o corpo não traz o campo", () => {
    expect(lerSalarioCombinado({ firstName: "Ana" })).toEqual({ dados: {} });
  });
  it("vazio tira o salário combinado e o motivo", () => {
    expect(lerSalarioCombinado({ salarioCombinado: "" })).toEqual({ dados: { salarioCombinado: null, salarioCombinadoMotivo: null } });
    expect(lerSalarioCombinado({ salarioCombinado: null })).toEqual({ dados: { salarioCombinado: null, salarioCombinadoMotivo: null } });
  });
  it("grava valor com motivo", () => {
    expect(lerSalarioCombinado({ salarioCombinado: "5200.00", salarioCombinadoMotivo: "  acima do registrado " }))
      .toEqual({ dados: { salarioCombinado: 5200, salarioCombinadoMotivo: "acima do registrado" } });
  });
  it("exige motivo com pelo menos 5 letras", () => {
    expect(lerSalarioCombinado({ salarioCombinado: 5200 })).toEqual({ erro: "Explique o salário combinado (pelo menos 5 letras)." });
    expect(lerSalarioCombinado({ salarioCombinado: 5200, salarioCombinadoMotivo: "abc" })).toHaveProperty("erro");
  });
  it("recusa valor zero, negativo, absurdo ou texto", () => {
    for (const v of [0, -10, 100001, "abc"]) {
      expect(lerSalarioCombinado({ salarioCombinado: v, salarioCombinadoMotivo: "motivo ok" })).toHaveProperty("erro");
    }
  });
});
