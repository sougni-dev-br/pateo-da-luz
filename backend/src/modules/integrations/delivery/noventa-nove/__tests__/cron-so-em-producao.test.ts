import { describe, expect, test } from "vitest";
import { cronHabilitado } from "../noventa-nove-cron.service.js";

// O banco local tem a credencial e as lojas reais da 99. Com o cron ligado por
// padrão, cada backend local de desenvolvimento chamava a API real às 04:00 BRT,
// junto com o de produção — e a 99 aceita 1 chamada a cada 20s.
describe("cronHabilitado", () => {
  test("produção no Render liga o cron", () => {
    expect(cronHabilitado({ NODE_ENV: "production", RENDER: "true" })).toBe(true);
  });

  test("Render liga mesmo se NODE_ENV não vier definido", () => {
    expect(cronHabilitado({ RENDER: "true" })).toBe(true);
  });

  test("NODE_ENV=production liga fora do Render", () => {
    expect(cronHabilitado({ NODE_ENV: "production" })).toBe(true);
  });

  test("ambiente local fica desligado por padrão", () => {
    expect(cronHabilitado({})).toBe(false);
    expect(cronHabilitado({ NODE_ENV: "development" })).toBe(false);
  });

  test("local pode ligar de propósito", () => {
    expect(cronHabilitado({ NOVENTA_NOVE_CRON_ENABLED: "true" })).toBe(true);
  });

  test("false desliga sempre, inclusive em produção", () => {
    expect(cronHabilitado({ NODE_ENV: "production", RENDER: "true", NOVENTA_NOVE_CRON_ENABLED: "false" })).toBe(false);
  });
});
