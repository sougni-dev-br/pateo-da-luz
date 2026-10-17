import { describe, expect, test } from "vitest";
import { OPCOES_PADRAO, eixoDaFolha, estiloDePagina, larguraUtilPx, nomeDoArquivo } from "../opcoesDaFolha";

describe("papel e largura útil", () => {
  test("A4 deitado com margem de 10 mm dá ~1046 px; em pé ~718 px; A3 deitado ~1511 px", () => {
    expect(larguraUtilPx({ papel: "A4", orientacao: "landscape" })).toBe(1046);
    expect(larguraUtilPx({ papel: "A4", orientacao: "portrait" })).toBe(718);
    expect(larguraUtilPx({ papel: "A3", orientacao: "landscape" })).toBe(1511);
  });

  test("o @page leva o papel, a orientação e a margem", () => {
    expect(estiloDePagina({ papel: "A3", orientacao: "portrait" })).toBe("@page { size: A3 portrait; margin: 10mm; }");
  });
});

describe("período da folha", () => {
  test("começa no mês passado, dura os meses escolhidos e cabe na largura da folha", () => {
    const eixo = eixoDaFolha("2026-10-15", OPCOES_PADRAO);
    expect(eixo.inicio).toBe("2026-09-01");
    expect(eixo.totalDias).toBe(365); // set/2026 a ago/2027
    expect(Math.round(eixo.pxPorDia * eixo.totalDias)).toBe(eixo.largura);
    expect(eixo.largura).toBeLessThan(larguraUtilPx(OPCOES_PADRAO));
  });

  test("6 e 18 meses mudam só o tamanho do período", () => {
    expect(eixoDaFolha("2026-10-15", { ...OPCOES_PADRAO, meses: 6 }).totalDias).toBe(181); // set/2026 a fev/2027
    expect(eixoDaFolha("2026-01-10", { ...OPCOES_PADRAO, meses: 18 }).inicio).toBe("2025-12-01");
  });
});

describe("nome do arquivo", () => {
  test("usa a visão e a data de hoje", () => {
    expect(nomeDoArquivo("linha", { hoje: "2026-10-15" })).toBe("Ferias - Linha do tempo - 2026-10-15");
  });
});
