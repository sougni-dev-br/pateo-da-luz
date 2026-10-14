import { describe, expect, test } from "vitest";
import { descontarHoje, hojeEmSaoPaulo } from "../agile-analise-hoje.js";

describe("hojeEmSaoPaulo", () => {
  test("usa o dia de Sao Paulo, nao o do servidor em UTC", () => {
    // 02:30 UTC de 14/10 ainda e 23:30 de 13/10 em Sao Paulo
    expect(hojeEmSaoPaulo(new Date("2026-10-14T02:30:00Z"))).toBe("2026-10-13");
    expect(hojeEmSaoPaulo(new Date("2026-10-14T03:00:00Z"))).toBe("2026-10-14");
    expect(hojeEmSaoPaulo(new Date("2026-10-13T15:00:00Z"))).toBe("2026-10-13");
  });
  test("formato AAAA-MM-DD", () => {
    expect(hojeEmSaoPaulo(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

describe("descontarHoje", () => {
  const hoje = "2026-10-13";

  test("periodo todo no passado: nada muda", () => {
    expect(descontarHoje({ inicio: "2026-09-01", fim: "2026-09-30" }, hoje)).toEqual({
      periodo: { inicio: "2026-09-01", fim: "2026-09-30" }, hojeFicouDeFora: false, vazio: false
    });
  });

  test("periodo que termina ontem: nada muda (ontem ja fechou)", () => {
    expect(descontarHoje({ inicio: "2026-10-01", fim: "2026-10-12" }, hoje).hojeFicouDeFora).toBe(false);
  });

  test("periodo que termina hoje: corta no dia anterior e avisa", () => {
    expect(descontarHoje({ inicio: "2026-09-14", fim: "2026-10-13" }, hoje)).toEqual({
      periodo: { inicio: "2026-09-14", fim: "2026-10-12" }, hojeFicouDeFora: true, vazio: false
    });
  });

  test("periodo que avanca pelo futuro: tambem corta em ontem", () => {
    expect(descontarHoje({ inicio: "2026-10-01", fim: "2026-10-31" }, hoje).periodo).toEqual({ inicio: "2026-10-01", fim: "2026-10-12" });
  });

  test("so hoje: nao sobra dia fechado, fica vazio", () => {
    const r = descontarHoje({ inicio: "2026-10-13", fim: "2026-10-13" }, hoje);
    expect(r).toMatchObject({ hojeFicouDeFora: true, vazio: true });
    expect(r.periodo).toEqual({ inicio: "2026-10-13", fim: "2026-10-13" });
  });

  test("periodo inteiro no futuro: vazio, e devolve o periodo PEDIDO (nao um dia solto)", () => {
    const r = descontarHoje({ inicio: "2026-11-01", fim: "2026-11-30" }, hoje);
    expect(r.vazio).toBe(true);
    expect(r.periodo).toEqual({ inicio: "2026-11-01", fim: "2026-11-30" });
  });

  test("atravessa a virada de mes e de ano ao recuar um dia", () => {
    expect(descontarHoje({ inicio: "2026-12-20", fim: "2027-01-01" }, "2027-01-01").periodo.fim).toBe("2026-12-31");
    expect(descontarHoje({ inicio: "2026-02-20", fim: "2026-03-01" }, "2026-03-01").periodo.fim).toBe("2026-02-28");
  });
});
