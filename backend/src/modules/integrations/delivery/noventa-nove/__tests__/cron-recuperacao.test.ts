import { describe, expect, test } from "vitest";
import { inicioDaUltimaRodadaEsperada, rodadaPerdida } from "../noventa-nove-cron.service.js";

// Datas em UTC; BRT = UTC-3, então a rodada das 04:00 BRT é 07:00Z.
const utc = (iso: string) => new Date(iso);

describe("inicioDaUltimaRodadaEsperada", () => {
  test("depois das 04:00 BRT, é o 04:00 de hoje", () => {
    expect(inicioDaUltimaRodadaEsperada(utc("2026-10-22T15:00:00Z")).toISOString()).toBe("2026-10-22T07:00:00.000Z");
  });

  test("antes das 04:00 BRT, é o 04:00 de ontem", () => {
    expect(inicioDaUltimaRodadaEsperada(utc("2026-10-22T05:00:00Z")).toISOString()).toBe("2026-10-21T07:00:00.000Z");
  });
});

describe("rodadaPerdida", () => {
  const agora = utc("2026-10-22T15:00:00Z");

  test("nunca rodou: recupera", () => {
    expect(rodadaPerdida(null, agora)).toBe(true);
  });

  test("última rodada terminou antes do 04:00 de hoje: recupera (deploy/restart engoliu a rodada)", () => {
    expect(rodadaPerdida(utc("2026-10-21T07:05:00Z"), agora)).toBe(true);
  });

  test("a rodada de hoje já aconteceu: não repete a cada restart", () => {
    expect(rodadaPerdida(utc("2026-10-22T07:04:00Z"), agora)).toBe(false);
  });

  test("rodada concluída depois do 04:00 (ainda hoje) também vale", () => {
    expect(rodadaPerdida(utc("2026-10-22T12:30:00Z"), agora)).toBe(false);
  });

  test("restart às 03:59 BRT com a rodada de ontem feita: não recupera", () => {
    expect(rodadaPerdida(utc("2026-10-21T07:04:00Z"), utc("2026-10-22T06:59:00Z"))).toBe(false);
  });
});
