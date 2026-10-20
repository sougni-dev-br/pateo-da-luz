import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({ prisma: {} }));

import { parseAmount, parseFlexibleDate, previewTaxImport } from "../tax-payment-import.service.js";

describe("competência e datas da planilha", () => {
  test("mês/ano vira o primeiro dia do mês (antes virava vazio e a guia sumia do DRE)", () => {
    expect(parseFlexibleDate("05/2026", true)).toEqual(new Date(2026, 4, 1));
    expect(parseFlexibleDate("5/26", true)).toEqual(new Date(2026, 4, 1));
  });

  test("mês/ano só vale como competência: no vencimento e no pagamento continua inválido", () => {
    expect(parseFlexibleDate("10/2026")).toBeNull();
    expect(parseFlexibleDate("10/2026", true)).toEqual(new Date(2026, 9, 1));
  });

  test("dd/mm/aaaa e ISO continuam valendo", () => {
    expect(parseFlexibleDate("20/10/2026")).toEqual(new Date(2026, 9, 20));
    expect(parseFlexibleDate("2026-10-20")).toEqual(new Date(2026, 9, 20));
  });

  test.each(["13/2026", "00/2026", "05/202", "sem data", "abc"])("texto inválido (%s) vira null", (texto) => {
    expect(parseFlexibleDate(texto, true)).toBeNull();
  });
});

describe("valor da planilha", () => {
  test.each([
    ["1.234,56", 1234.56],
    ["R$ 1.234,56", 1234.56],
    ["12.50", 12.5],
    ["1.234", 1234],
    ["350", 350],
    [99.9, 99.9],
  ])("%s vira %s", (entrada, esperado) => {
    expect(parseAmount(entrada)).toBe(esperado);
  });
});

describe("prévia", () => {
  const arquivos: string[] = [];
  afterEach(() => arquivos.splice(0).forEach((a) => fs.rmSync(a, { force: true })));

  async function planilha(aba: string, linhas: unknown[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(aba);
    ws.addRow(["CNPJ", "RAZÃO SOCIAL", "ÓRGÃO / DOCUMENTO", "DESCRIÇÃO", "COMPETENCIA", "VENCIMENTO", "VALOR", "DATA PAGAMENTO"]);
    linhas.forEach((l) => ws.addRow(l));
    const arquivo = path.join(os.tmpdir(), `impostos-import-${Date.now()}-${arquivos.length}.xlsx`);
    await wb.xlsx.writeFile(arquivo);
    arquivos.push(arquivo);
    return arquivo;
  }

  test("linha sem competência é inválida com motivo claro; com mês/ano é aceita", async () => {
    const arquivo = await planilha("Impostos", [
      ["00000000000100", "Empresa Exemplo Ltda", "FGTS", null, null, "20/10/2026", 100, null],
      ["00000000000100", "Empresa Exemplo Ltda", "FGTS", null, "09/2026", "20/10/2026", 100, null],
    ]);

    const prev = await previewTaxImport(arquivo, new Set());

    expect(prev.rows[0].valid).toBe(false);
    expect(prev.rows[0].errors.join()).toMatch(/Competência/);
    expect(prev.rows[1].valid).toBe(true);
    expect(prev.rows[1].competenceDate).toEqual(new Date(2026, 8, 1));
  });

  test("vencimento escrito como mês/ano é erro, não uma data inventada", async () => {
    const arquivo = await planilha("Impostos", [["00000000000100", "Empresa Exemplo Ltda", "FGTS", null, "09/2026", "10/2026", 100, null]]);
    const prev = await previewTaxImport(arquivo, new Set());
    expect(prev.rows[0].valid).toBe(false);
    expect(prev.rows[0].errors.join()).toMatch(/Vencimento/);
  });

  test("valor zero é inválido", async () => {
    const arquivo = await planilha("Impostos", [["00000000000100", "Empresa Exemplo Ltda", "FGTS", null, "09/2026", "20/10/2026", 0, null]]);
    const prev = await previewTaxImport(arquivo, new Set());
    expect(prev.rows[0].valid).toBe(false);
  });

  test("planilha sem a aba de impostos avisa em vez de importar 0 linhas em silêncio", async () => {
    const arquivo = await planilha("Outra aba", [["00000000000100", "Empresa Exemplo Ltda", "FGTS", null, "09/2026", "20/10/2026", 100, null]]);
    await expect(previewTaxImport(arquivo, new Set())).rejects.toThrow(/aba "Impostos"/);
  });
});
