import { describe, expect, test } from "vitest";
import { conferirDestino, ehHostLocal, hostDoBanco } from "../destino-banco.js";

const url = (host: string) => `postgresql://u:p@${host}:5432/cmv_loja`;

describe("hostDoBanco", () => {
  test("lê o host do DATABASE_URL", () => {
    expect(hostDoBanco(url("localhost"))).toBe("localhost");
    expect(hostDoBanco(url("[::1]"))).toBe("[::1]");
    expect(hostDoBanco(url("DPG-ABC-A.oregon-postgres.render.com"))).toBe("dpg-abc-a.oregon-postgres.render.com");
  });

  test("vazio ou inválido vira '?'", () => {
    expect(hostDoBanco(undefined)).toBe("?");
    expect(hostDoBanco("")).toBe("?");
    expect(hostDoBanco("isto não é url")).toBe("?");
  });
});

describe("conferirDestino (trava de produção dos scripts)", () => {
  test.each(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"])("%s: grava sem --producao", (host) => {
    expect(conferirDestino(["--aplicar"], url(host))).toMatchObject({ aplicar: true, producao: false });
    expect(ehHostLocal(hostDoBanco(url(host)))).toBe(true);
  });

  test.each([
    ["Render externo", url("dpg-abc123-a.oregon-postgres.render.com")],
    ["Render interno (sem domínio)", url("dpg-abc123-a")],
    ["IP qualquer", url("10.0.0.5")],
    ["DATABASE_URL vazio", ""],
    ["DATABASE_URL inválido", "lixo"],
  ])("%s: --aplicar sem --producao é recusado", (_nome, u) => {
    expect(() => conferirDestino(["--aplicar"], u)).toThrow(/--producao/);
  });

  test("com --producao, qualquer host é aceito", () => {
    expect(conferirDestino(["--aplicar", "--producao"], url("dpg-abc123-a"))).toMatchObject({ host: "dpg-abc123-a", aplicar: true, producao: true });
  });

  test("simulação (sem --aplicar) nunca é barrada", () => {
    expect(conferirDestino([], url("dpg-abc123-a"))).toMatchObject({ aplicar: false });
    expect(conferirDestino([], undefined)).toMatchObject({ host: "?", aplicar: false });
  });
});
