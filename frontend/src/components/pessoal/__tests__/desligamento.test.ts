import { describe, expect, test } from "vitest";
import { lerMotivoDoDesligamento, motivoDoDesligamento } from "../desligamento";

describe("motivo do desligamento", () => {
  test("junta tipo e observação", () => {
    expect(motivoDoDesligamento("Pedido de demissão", "  vai mudar de cidade ")).toBe("Pedido de demissão — vai mudar de cidade");
    expect(motivoDoDesligamento("Pedido de demissão", "  ")).toBe("Pedido de demissão");
  });

  test("lê de volta o que foi gravado", () => {
    expect(lerMotivoDoDesligamento("Acordo (art. 484-A) — combinado em 3 parcelas")).toEqual({ tipo: "Acordo (art. 484-A)", observacao: "combinado em 3 parcelas" });
    expect(lerMotivoDoDesligamento("Dispensa sem justa causa")).toEqual({ tipo: "Dispensa sem justa causa", observacao: "" });
  });

  test("texto livre antigo vira observação", () => {
    expect(lerMotivoDoDesligamento("saiu sem avisar")).toEqual({ tipo: "", observacao: "saiu sem avisar" });
    expect(lerMotivoDoDesligamento(null)).toEqual({ tipo: "", observacao: "" });
  });
});
