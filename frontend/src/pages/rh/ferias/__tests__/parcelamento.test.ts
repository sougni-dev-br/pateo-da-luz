import { describe, expect, test } from "vitest";
import { MIN_DIAS_PARA_PARCELAR, partesIniciais, validarPartes } from "../parcelamento";

const livre = () => null;
const FIM_AQUISITIVO = "2026-01-31";

describe("partesIniciais", () => {
  test("30 dias viram 14 + 16", () => {
    expect(partesIniciais(30)).toEqual([{ inicio: "", dias: "14" }, { inicio: "", dias: "16" }]);
  });
  test("20 dias (com abono) viram 14 + 6", () => {
    expect(partesIniciais(20)).toEqual([{ inicio: "", dias: "14" }, { inicio: "", dias: "6" }]);
  });
  test("o menor total parcelável é 19 (14 + 5)", () => {
    expect(MIN_DIAS_PARA_PARCELAR).toBe(19);
  });
});

describe("validarPartes", () => {
  test("aceita 14 + 16 em datas livres que fecham o saldo", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2027-01-12", dias: "16" }], 30, FIM_AQUISITIVO, livre);
    expect(r.valido).toBe(true);
    expect(r.geral).toEqual([]);
  });
  test("a soma precisa fechar o saldo", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2027-01-12", dias: "10" }], 30, FIM_AQUISITIVO, livre);
    expect(r.valido).toBe(false);
    expect(r.geral[0]).toMatch(/somam 24 dias; precisam fechar 30/);
  });
  test("uma das partes precisa ter 14 dias", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "10" }, { inicio: "2027-01-12", dias: "10" }, { inicio: "2027-03-02", dias: "10" }], 30, FIM_AQUISITIVO, livre);
    expect(r.geral[0]).toMatch(/pelo menos 14 dias/);
  });
  test("cada parte tem no mínimo 5 dias", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "26" }, { inicio: "2027-01-12", dias: "4" }], 30, FIM_AQUISITIVO, livre);
    expect(r.porParte[1].dias).toMatch(/mínimo 5/);
    expect(r.valido).toBe(false);
  });
  test("recusa início vazio, antes do fim do aquisitivo e em dia vedado", () => {
    const r = validarPartes(
      [{ inicio: "", dias: "14" }, { inicio: "2026-01-10", dias: "8" }, { inicio: "2027-01-12", dias: "8" }],
      30, FIM_AQUISITIVO, (i) => (i === "2027-01-12" ? "é feriado" : null),
    );
    expect(r.porParte[0].inicio).toMatch(/Informe/);
    expect(r.porParte[1].inicio).toMatch(/depois do fim/);
    expect(r.porParte[2].inicio).toBe("é feriado");
  });
  test("partes que se sobrepõem são recusadas", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2026-12-10", dias: "16" }], 30, FIM_AQUISITIVO, livre);
    expect(r.geral).toContain("As partes 1 e 2 se sobrepõem.");
    expect(r.valido).toBe(false);
  });
  test("partes em sequência, sem tocar uma na outra, são aceitas", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2026-12-15", dias: "16" }], 30, FIM_AQUISITIVO, livre);
    expect(r.valido).toBe(true);
  });
  test("3 partes: sobreposição entre a 1ª e a 3ª", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2027-02-02", dias: "8" }, { inicio: "2026-12-10", dias: "8" }], 30, FIM_AQUISITIVO, livre);
    expect(r.geral).toContain("As partes 1 e 3 se sobrepõem.");
  });
  test("dias vazios ou fracionados são recusados", () => {
    const r = validarPartes([{ inicio: "2026-12-01", dias: "" }, { inicio: "2027-01-12", dias: "14.5" }], 30, FIM_AQUISITIVO, livre);
    expect(r.porParte[0].dias).toMatch(/mínimo 5/);
    expect(r.porParte[1].dias).toMatch(/mínimo 5/);
    expect(r.valido).toBe(false);
  });
  test("com abono o total a dividir é 20", () => {
    expect(validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2027-01-12", dias: "6" }], 20, FIM_AQUISITIVO, livre).valido).toBe(true);
    expect(validarPartes([{ inicio: "2026-12-01", dias: "14" }, { inicio: "2027-01-12", dias: "16" }], 20, FIM_AQUISITIVO, livre).valido).toBe(false);
  });
  test("mais de 3 partes é recusado", () => {
    const quatro = ["2026-12-01", "2027-01-12", "2027-02-16", "2027-03-16"].map((inicio) => ({ inicio, dias: "5" }));
    expect(validarPartes(quatro, 20, FIM_AQUISITIVO, livre).geral).toContain("No máximo 3 partes.");
  });
});
