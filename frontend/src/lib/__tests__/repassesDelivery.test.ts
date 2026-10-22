import { describe, expect, it } from "vitest";
import { formatarPeriodoRepasse, ordenarRepasses, rotuloStatusRepasse, tomDoStatusRepasse } from "../repassesDelivery";

describe("rotuloStatusRepasse", () => {
  it("reconhece os status do iFood importado do portal", () => {
    expect(rotuloStatusRepasse("PAGO")).toBe("Pago");
    expect(rotuloStatusRepasse("EM_ABERTO")).toBe("Em aberto");
    expect(rotuloStatusRepasse("SALDO_PENDENTE")).toBe("Saldo pendente");
    expect(rotuloStatusRepasse("SUSPENSO")).toBe("Suspenso");
  });

  it("mantém os status da 99 (PAID e PENDING)", () => {
    expect(rotuloStatusRepasse("PAID")).toBe("Pago");
    expect(rotuloStatusRepasse("PENDING")).toBe("Pendente");
  });

  it("ignora caixa e espaços", () => {
    expect(rotuloStatusRepasse(" pago ")).toBe("Pago");
    expect(rotuloStatusRepasse("em_aberto")).toBe("Em aberto");
  });

  it("status desconhecido mostra o texto legível, não 'Pendente'", () => {
    expect(rotuloStatusRepasse("CANCELADO_PELO_BANCO")).toBe("Cancelado pelo banco");
    expect(rotuloStatusRepasse("")).toBe("—");
  });
});

describe("tomDoStatusRepasse", () => {
  it("só suspenso e saldo pendente chamam atenção; pago é ok", () => {
    expect(tomDoStatusRepasse("SUSPENSO")).toBe("atencao");
    expect(tomDoStatusRepasse("SALDO_PENDENTE")).toBe("atencao");
    expect(tomDoStatusRepasse("PAGO")).toBe("ok");
    expect(tomDoStatusRepasse("PAID")).toBe("ok");
    expect(tomDoStatusRepasse("EM_ABERTO")).toBe("neutro");
    expect(tomDoStatusRepasse("PENDING")).toBe("neutro");
  });
});

describe("ordenarRepasses", () => {
  const l = (periodStart: string, platform: string, storeLabel?: string) => ({ periodStart, platform, storeLabel });

  it("período mais antigo primeiro e, no mesmo período, plataforma e loja em ordem", () => {
    const ordenado = ordenarRepasses([
      l("2026-10-05", "IFOOD", "Pizzaria"),
      l("2026-10-01", "NOVENTA_NOVE", "Peposo"),
      l("2026-10-01", "IFOOD", "Peposo"),
      l("2026-10-01", "IFOOD", "Massas"),
      l("2026-10-01", "IFOOD", "Pateo da Luz")
    ]);
    expect(ordenado.map((x) => `${x.periodStart} ${x.platform} ${x.storeLabel}`)).toEqual([
      "2026-10-01 IFOOD Massas",
      "2026-10-01 IFOOD Pateo da Luz",
      "2026-10-01 IFOOD Peposo",
      "2026-10-01 NOVENTA_NOVE Peposo",
      "2026-10-05 IFOOD Pizzaria"
    ]);
  });

  it("não altera a lista original e aceita repasse sem loja", () => {
    const original = [l("2026-10-05", "IFOOD"), l("2026-10-01", "IFOOD", "A")];
    const copia = [...original];
    const r = ordenarRepasses(original);
    expect(original).toEqual(copia);
    expect(r[0]!.periodStart).toBe("2026-10-01");
  });
});

describe("formatarPeriodoRepasse", () => {
  it("mostra dia/mês/ano sem passar por Date (não escorrega com fuso)", () => {
    expect(formatarPeriodoRepasse("2026-10-01", "2026-10-04")).toBe("01/10/2026 → 04/10/2026");
    expect(formatarPeriodoRepasse("2026-12-28", "2027-01-03")).toBe("28/12/2026 → 03/01/2027");
  });

  it("texto fora do padrão passa como veio", () => {
    expect(formatarPeriodoRepasse("sem data", "2026-10-04")).toBe("sem data → 04/10/2026");
  });
});
