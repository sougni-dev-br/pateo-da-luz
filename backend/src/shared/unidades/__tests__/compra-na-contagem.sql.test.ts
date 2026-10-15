import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { sqlCompraNaUnidadeDeContagem, sqlUnidadeCanonica } from "../compra-na-contagem.sql.js";
import { SINONIMOS_DE_UNIDADE } from "../conversao.js";

describe("sqlUnidadeCanonica", () => {
  it("traduz todos os sinonimos do backend, sem parametro de usuario", () => {
    const sql = sqlUnidadeCanonica(Prisma.sql`x."unit"`);
    for (const [de, para] of Object.entries(SINONIMOS_DE_UNIDADE)) {
      expect(sql.text).toContain(`WHEN '${de}' THEN '${para}'`);
    }
    expect(sql.values).toEqual([]);
  });
});

describe("sqlCompraNaUnidadeDeContagem", () => {
  it("exige linha sem conversionMissing e compara com a unidade de contagem do produto", () => {
    const sql = sqlCompraNaUnidadeDeContagem("item", "produto").text;
    expect(sql).toContain(`"item"."conversionMissing" = false`);
    expect(sql).toContain(`COALESCE("produto"."stockUnit", "produto"."unit")`);
  });

  it("recusa alias que nao e identificador", () => {
    expect(() => sqlCompraNaUnidadeDeContagem(`pi"; DROP TABLE x; --`)).toThrow();
  });
});
