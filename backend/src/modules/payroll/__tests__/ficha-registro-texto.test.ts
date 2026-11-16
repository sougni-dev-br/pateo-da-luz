import { describe, expect, test } from "vitest";
import { type Trecho, linhasDaPagina } from "../ficha-registro-texto.js";

// Trechos como o pdfjs entrega: x/y em pontos, y cresce para cima. Fonte de 8 pt.
const t = (texto: string, x: number, y: number, largura = texto.length * 4): Trecho => ({ texto, x, y, largura, altura: 8 });

describe("linhasDaPagina", () => {
  test("trechos na mesma altura formam uma linha, de cima para baixo", () => {
    expect(linhasDaPagina([t("segunda", 10, 700), t("primeira", 10, 720)])).toEqual(["primeira", "segunda"]);
  });

  test("altura quase igual (até 2,5 pt) é a mesma linha, em ordem de coluna", () => {
    const linhas = linhasDaPagina([t("B", 200, 699), t("A", 10, 700)]);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatch(/^A\s+B$/);
  });

  test("vão curto é um espaço; vão de coluna são dois ou mais", () => {
    const [linha] = linhasDaPagina([t("De", 10, 700), t("01/10/2025", 22, 700), t("De", 100, 700)]);
    expect(linha).toMatch(/^De 01\/10\/2025 {2,}De$/);
  });

  test("sem vão entre trechos colados, nenhum espaço é inventado", () => {
    expect(linhasDaPagina([t("01/10", 10, 700, 20), t("/2025", 30, 700, 20)])).toEqual(["01/10/2025"]);
  });

  test("margem esquerda não aparece: rótulos ancoram no início da linha", () => {
    expect(linhasDaPagina([t("Empregado", 60, 700)])[0]).toBe("Empregado");
  });

  test("trecho vazio ou só espaço é ignorado", () => {
    expect(linhasDaPagina([t(" ", 10, 700), t("", 20, 700), t("ok", 30, 700)])).toEqual(["ok"]);
  });

  test("página sem texto não gera linhas", () => {
    expect(linhasDaPagina([])).toEqual([]);
  });
});
