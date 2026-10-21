import { describe, expect, test } from "vitest";
import { MESES_OPCOES, OPCOES_PADRAO, eixoDaFolha, escalaDaLetra, nomeNaFolhaPx, estiloDePagina, larguraUtilPx, nomeDoArquivo } from "../opcoesDaFolha";

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
  test("começa no mês atual, dura os meses escolhidos e cabe na largura da folha", () => {
    const eixo = eixoDaFolha("2026-10-15", OPCOES_PADRAO);
    expect(eixo.inicio).toBe("2026-10-01");
    expect(eixo.totalDias).toBe(365); // out/2026 a set/2027
    expect(Math.round(eixo.pxPorDia * eixo.totalDias)).toBe(eixo.largura);
    expect(eixo.largura).toBeLessThan(larguraUtilPx(OPCOES_PADRAO));
  });

  test("3, 6 e 18 meses mudam só o tamanho do período (3 = trimestre: este mês e os dois seguintes)", () => {
    expect(MESES_OPCOES).toEqual([3, 6, 12, 18]);
    const tri = eixoDaFolha("2026-10-15", { ...OPCOES_PADRAO, meses: 3 });
    expect(tri.inicio).toBe("2026-10-01");
    expect(tri.totalDias).toBe(92); // out, nov e dez/2026
    expect(tri.pxPorDia).toBeGreaterThan(eixoDaFolha("2026-10-15", OPCOES_PADRAO).pxPorDia * 3); // o trimestre é bem mais largo por dia
    expect(eixoDaFolha("2026-10-15", { ...OPCOES_PADRAO, meses: 6 }).totalDias).toBe(182); // out/2026 a mar/2027
    expect(eixoDaFolha("2026-01-10", { ...OPCOES_PADRAO, meses: 18 }).inicio).toBe("2026-01-01");
  });
});

describe("nome do arquivo", () => {
  test("usa a visão e a data de hoje", () => {
    expect(nomeDoArquivo("linha", { hoje: "2026-10-15" })).toBe("Ferias - Linha do tempo - 2026-10-15");
  });

  test("a letra maior alarga a coluna do nome e estreita a linha do tempo; o padrão é a escala 1", () => {
    expect(escalaDaLetra(undefined)).toBe(1);
    expect(nomeNaFolhaPx({ letra: "extra" })).toBeGreaterThan(nomeNaFolhaPx({ letra: "normal" }));
    expect(eixoDaFolha("2026-10-15", { ...OPCOES_PADRAO, letra: "extra" }).largura).toBeLessThan(eixoDaFolha("2026-10-15", OPCOES_PADRAO).largura);
  });
});
