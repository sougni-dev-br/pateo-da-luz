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

// O frontend precisa de uma copia (previa da ficha e da nota enquanto se digita).
// Correcao que chega so num lado faz a tela dizer "sem conversao" para o que o
// backend converte — foi o que aconteceu com GR, LT e KG<->G na nota de compra.
describe("paridade dos sinonimos com o frontend", () => {
  it("lib/fichaTecnica.ts tem todos os sinonimos do backend", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const caminho = fileURLToPath(new URL("../../../../../frontend/src/lib/fichaTecnica.ts", import.meta.url));
    const texto = await readFile(caminho, "utf8").catch(() => null);
    if (texto == null) return; // backend publicado sem o frontend ao lado
    for (const [de, para] of Object.entries(SINONIMOS_DE_UNIDADE)) {
      expect(texto, `${de} -> ${para}`).toMatch(new RegExp(`\\b${de}: "${para}"`));
    }
  });
});
