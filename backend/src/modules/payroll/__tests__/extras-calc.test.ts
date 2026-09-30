import { describe, expect, it } from "vitest";
import { lerHorario, lerValoresDiaria, resumirDiarias } from "../extras-calc.js";

const PADRAO = { inteira: 100, meia: 50 };

describe("lerValoresDiaria", () => {
  it("usa o valor padrão da diária inteira quando nada é informado", () => {
    expect(lerValoresDiaria({ duration: "INTEIRA" }, PADRAO)).toEqual({
      ok: true,
      valores: { baseAmount: 100, baseAdjustReason: null, transportAmount: 0, bonusAmount: 0, discountAmount: 0, totalAmount: 100 },
    });
  });

  it("meia diária usa o valor da meia", () => {
    const r = lerValoresDiaria({ duration: "MEIA" }, PADRAO);
    expect(r.ok && r.valores.baseAmount).toBe(50);
  });

  it("soma transporte e acréscimo e tira o desconto", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", transportAmount: "10,60", bonusAmount: 20, discountAmount: "5" }, PADRAO);
    expect(r.ok && r.valores.totalAmount).toBe(125.6);
  });

  it("valor diferente do padrão exige motivo", () => {
    expect(lerValoresDiaria({ duration: "INTEIRA", baseAmount: 120 }, PADRAO)).toEqual({
      ok: false, erro: "Valor da diária diferente do padrão (R$ 100,00): informe o motivo.",
    });
  });

  it("valor diferente do padrão com motivo é aceito e guarda o motivo", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", baseAmount: "120.00", baseAdjustReason: "  fechou a casa " }, PADRAO);
    expect(r.ok && r.valores).toMatchObject({ baseAmount: 120, baseAdjustReason: "fechou a casa", totalAmount: 120 });
  });

  it("valor igual ao padrão descarta o motivo", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", baseAmount: 100, baseAdjustReason: "qualquer" }, PADRAO);
    expect(r.ok && r.valores.baseAdjustReason).toBeNull();
  });

  it("recusa valor negativo", () => {
    expect(lerValoresDiaria({ duration: "INTEIRA", transportAmount: -1 }, PADRAO).ok).toBe(false);
  });

  it("recusa desconto maior que o total", () => {
    expect(lerValoresDiaria({ duration: "MEIA", discountAmount: 60 }, PADRAO)).toEqual({
      ok: false, erro: "O desconto não pode ser maior que a diária somada aos acréscimos.",
    });
  });

  it("arredonda para centavos", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", transportAmount: 10.555 }, PADRAO);
    expect(r.ok && r.valores.totalAmount).toBe(110.56);
  });
});

describe("lerHorario", () => {
  it("aceita HH:MM", () => expect(lerHorario("08:30")).toBe("08:30"));
  it("completa a hora com zero", () => expect(lerHorario("8:05")).toBe("08:05"));
  it("vazio vira nulo", () => expect(lerHorario("")).toBeNull());
  it("hora inválida é recusada", () => expect(lerHorario("25:00")).toBe(false));
  it("texto é recusado", () => expect(lerHorario("manhã")).toBe(false));
});

describe("resumirDiarias", () => {
  const base = { sector: "Salão", reason: "EVENTO", pessoaId: "a", pessoaNome: "Ana", origem: "CASA" as const };
  it("soma só as realizadas no custo e separa as previstas", () => {
    const r = resumirDiarias([
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA" },
      { ...base, status: "REALIZADA", totalAmount: 50, duration: "MEIA", sector: "Cozinha", reason: "COBERTURA_FALTA" },
      { ...base, status: "PREVISTA", totalAmount: 100, duration: "INTEIRA" },
      { ...base, status: "NAO_COMPARECEU", totalAmount: 100, duration: "INTEIRA" },
      { ...base, status: "CANCELADA", totalAmount: 100, duration: "INTEIRA" },
    ]);
    expect(r.custoRealizado).toBe(150);
    expect(r.custoPrevisto).toBe(100);
    expect(r.diariasRealizadas).toBe(1.5);
    expect(r.naoCompareceu).toBe(1);
    expect(r.porSetor).toEqual([{ chave: "Salão", total: 100, diarias: 1 }, { chave: "Cozinha", total: 50, diarias: 0.5 }]);
    expect(r.porMotivo).toEqual([{ chave: "EVENTO", total: 100, diarias: 1 }, { chave: "COBERTURA_FALTA", total: 50, diarias: 0.5 }]);
  });

  it("agrupa por pessoa e separa casa de fora", () => {
    const r = resumirDiarias([
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA" },
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA" },
      { ...base, pessoaId: "b", pessoaNome: "Bia", origem: "FORA", status: "REALIZADA", totalAmount: 50, duration: "MEIA" },
    ]);
    expect(r.porPessoa).toEqual([
      { pessoaId: "a", nome: "Ana", origem: "CASA", total: 200, diarias: 2 },
      { pessoaId: "b", nome: "Bia", origem: "FORA", total: 50, diarias: 0.5 },
    ]);
    expect(r.custoCasa).toBe(200);
    expect(r.custoFora).toBe(50);
  });

  it("agrupa por evento só as realizadas que têm o nome do evento", () => {
    const r = resumirDiarias([
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA", eventName: "Apraxia" },
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA", eventName: "Apraxia" },
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA", eventName: "Nutrologia" },
      { ...base, status: "PREVISTA", totalAmount: 100, duration: "INTEIRA", eventName: "Nutrologia" },
      { ...base, status: "REALIZADA", totalAmount: 100, duration: "INTEIRA", eventName: null },
    ]);
    expect(r.porEvento).toEqual([{ chave: "Apraxia", total: 200, diarias: 2 }, { chave: "Nutrologia", total: 100, diarias: 1 }]);
  });
});

describe("lerValoresDiaria — edição e limites", () => {
  const anterior = { duration: "INTEIRA" as const, baseAmount: 100, baseAdjustReason: null };

  it("editar diária antiga com o mesmo valor não exige motivo mesmo se o padrão mudou", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", baseAmount: 100 }, { inteira: 120, meia: 60 }, anterior);
    expect(r.ok && r.valores).toMatchObject({ baseAmount: 100, baseAdjustReason: null });
  });

  it("mantém o motivo já gravado quando o valor ajustado não muda", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", baseAmount: 130 }, PADRAO, { ...anterior, baseAmount: 130, baseAdjustReason: "fechou a casa" });
    expect(r.ok && r.valores.baseAdjustReason).toBe("fechou a casa");
  });

  it("mudar o valor na edição volta a exigir motivo", () => {
    expect(lerValoresDiaria({ duration: "INTEIRA", baseAmount: 140 }, PADRAO, anterior).ok).toBe(false);
  });

  it("recusa valor acima do teto", () => {
    expect(lerValoresDiaria({ duration: "INTEIRA", transportAmount: 200000 }, PADRAO)).toEqual({ ok: false, erro: "Valor acima do permitido (R$ 100.000,00)." });
  });

  it("recusa notação científica e hexadecimal", () => {
    expect(lerValoresDiaria({ duration: "INTEIRA", transportAmount: "1e3" }, PADRAO).ok).toBe(false);
    expect(lerValoresDiaria({ duration: "INTEIRA", transportAmount: "0x10" }, PADRAO).ok).toBe(false);
  });
});

describe("lerValoresDiaria — auditoria de 29/09", () => {
  it("'1.000' com ponto de milhar é mil, não um real", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", transportAmount: "1.000" }, { inteira: 100, meia: 50 });
    expect(r.ok && r.valores.transportAmount).toBe(1000);
  });

  it("'10.60' com ponto decimal continua 10,60", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA", transportAmount: "10.60" }, { inteira: 100, meia: 50 });
    expect(r.ok && r.valores.transportAmount).toBe(10.6);
  });

  it("na edição, valor ausente herda o gravado em vez de assumir o padrão novo", () => {
    const r = lerValoresDiaria({ duration: "INTEIRA" }, { inteira: 120, meia: 60 }, { duration: "INTEIRA", baseAmount: 100, baseAdjustReason: null });
    expect(r.ok && r.valores).toMatchObject({ baseAmount: 100, baseAdjustReason: null });
  });
});
