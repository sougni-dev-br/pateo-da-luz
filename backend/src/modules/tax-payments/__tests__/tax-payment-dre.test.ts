import { describe, expect, test } from "vitest";
import { taxPaymentDreLinhasSql } from "../tax-payment-dre.js";

// O SQL em si foi conferido contra os dados reais de produção (totais por mês idênticos antes e depois; julho/2026 da
// Pateo da Luz: Pessoal +2.109,57 e Impostos -2.109,57). Aqui ficam as garantias de forma, para que ninguém afrouxe o
// trecho sem perceber.
describe("linhas de DRE das guias (DARF dividido por linha)", () => {
  const texto = taxPaymentDreLinhasSql.sql;

  test("só literais: nada vindo do usuário entra no trecho", () => {
    expect(taxPaymentDreLinhasSql.values).toEqual([]);
  });

  test("três partes: guia inteira, DARF por linha e resíduo", () => {
    expect(texto.match(/UNION ALL/g)).toHaveLength(2);
  });

  test("0561 vai para IRRF / DARF e 1082 e 1099 para INSS", () => {
    expect(texto).toContain("ti.code = '0561'");
    expect(texto).toContain("ti.code IN ('1082', '1099')");
    expect(texto).toMatch(/THEN \(SELECT c\.id FROM "DRECategory" c WHERE c\.name = 'IRRF \/ DARF'/);
    expect(texto).toMatch(/THEN \(SELECT c\.id FROM "DRECategory" c WHERE c\.name = 'INSS'/);
  });

  test("só divide guia cujas categorias são INSS ou IRRF / DARF; o resto entra inteiro como sempre", () => {
    expect(texto).toContain(`NOT IN (SELECT c.id FROM "DRECategory" c WHERE c.name IN ('INSS', 'IRRF / DARF'))`);
    expect(texto).toContain(`WHERE tp."dreCategoryId" IN (SELECT c.id FROM "DRECategory" c WHERE c.name IN ('INSS', 'IRRF / DARF'))`);
  });

  test("a guia sem linhas entra inteira e o que as linhas não somam fica na categoria da guia (o total é preservado)", () => {
    expect(texto).toContain(`NOT EXISTS (SELECT 1 FROM "TaxPaymentItem" x WHERE x."taxPaymentId" = tp.id)`);
    expect(texto).toContain("ABS(tp.amount - s.soma) > 0.005");
  });

  test("expõe as colunas que o DRE e o dashboard filtram", () => {
    for (const coluna of ['"taxPaymentId"', '"competenceDate"', '"deletedAt"', "status", '"dreCategoryId"', "amount"]) {
      expect(texto).toContain(coluna);
    }
  });

  test("a categoria derivada cai de volta na da guia quando o cadastro da categoria não existir", () => {
    expect(texto).toMatch(/COALESCE\(\s*CASE/);
  });
});
