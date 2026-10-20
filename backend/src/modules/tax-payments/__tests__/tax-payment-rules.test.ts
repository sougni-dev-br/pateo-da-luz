import path from "node:path";
import { describe, expect, test } from "vitest";
import { diaIso, hojeBrasilia, lerData, parseValorGuia, resolverUploadImportacao, statusDaGuia } from "../tax-payment-rules.js";

describe("statusDaGuia", () => {
  const hoje = new Date("2026-10-20T15:00:00Z");

  test("com pagamento é PAID, mesmo vencida", () => {
    expect(statusDaGuia(new Date("2026-10-25T00:00:00Z"), new Date("2026-09-01T00:00:00Z"), false, hoje)).toBe("PAID");
  });

  test("sem pagamento e vencimento anterior a hoje é OVERDUE", () => {
    expect(statusDaGuia(null, new Date("2026-10-19T00:00:00Z"), false, hoje)).toBe("OVERDUE");
  });

  test("vence hoje ainda é PENDING, em qualquer hora do dia", () => {
    expect(statusDaGuia(null, new Date("2026-10-20T00:00:00Z"), false, new Date("2026-10-20T23:59:00Z"))).toBe("PENDING");
  });

  test("vencimento futuro é PENDING", () => {
    expect(statusDaGuia(null, new Date("2026-11-20T00:00:00Z"), false, hoje)).toBe("PENDING");
  });

  test("cancelada prevalece sobre pagamento e vencimento", () => {
    expect(statusDaGuia(new Date("2026-10-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"), true, hoje)).toBe("CANCELED");
  });
});

describe("parseValorGuia", () => {
  test("aceita número positivo, inclusive em texto com ponto", () => {
    expect(parseValorGuia(1500.5)).toBe(1500.5);
    expect(parseValorGuia("1500.50")).toBe(1500.5);
  });

  test.each([0, -10, "", null, undefined, "abc", "1.234,56", NaN, Infinity])("rejeita %s", (valor) => {
    expect(parseValorGuia(valor)).toBeNull();
  });
});

describe("lerData", () => {
  test("vazio vira null sem erro", () => {
    expect(lerData(undefined)).toEqual({ ok: true, data: null });
    expect(lerData("")).toEqual({ ok: true, data: null });
  });

  test("data válida vira Date; texto inválido sinaliza erro", () => {
    expect(lerData("2026-10-20")).toEqual({ ok: true, data: new Date("2026-10-20T00:00:00Z") });
    expect(lerData("20/10/2026")).toEqual({ ok: false });
  });
});

describe("diaIso", () => {
  test("usa o dia gravado em UTC, sem deslocar pelo fuso", () => {
    expect(diaIso(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-01");
    expect(diaIso("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
  });

  test("ausente ou inválido vira null", () => {
    expect(diaIso(null)).toBeNull();
    expect(diaIso("")).toBeNull();
    expect(diaIso("xx")).toBeNull();
  });
});

describe("resolverUploadImportacao", () => {
  const pasta = path.resolve("uploads");
  const id = "0123456789abcdef0123456789abcdef";

  test("id do multer vira caminho dentro da pasta de uploads", () => {
    expect(resolverUploadImportacao(id, "uploads")).toBe(path.join(pasta, id));
  });

  test.each(["package.json", "../.env", "..\\..\\x", "/etc/passwd", "C:\\Windows\\win.ini", id + "/..", "", undefined, 42])(
    "recusa caminho livre %s",
    (valor) => {
      expect(resolverUploadImportacao(valor, "uploads")).toBeNull();
    }
  );
});

describe("hojeBrasilia", () => {
  test("às 22h de Brasília (01h UTC do dia seguinte) ainda é o mesmo dia", () => {
    expect(hojeBrasilia(new Date("2026-10-21T01:00:00Z"))).toBe("2026-10-20");
  });

  test("a guia que vence hoje não vira vencida à noite", () => {
    expect(statusDaGuia(null, new Date("2026-10-20T00:00:00Z"), false, new Date("2026-10-21T01:00:00Z"))).toBe("PENDING");
    expect(statusDaGuia(null, new Date("2026-10-20T00:00:00Z"), false, new Date("2026-10-21T04:00:00Z"))).toBe("OVERDUE");
  });
});
