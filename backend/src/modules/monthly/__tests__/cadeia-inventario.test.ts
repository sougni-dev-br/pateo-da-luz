import { describe, expect, test } from "vitest";
import { cadeiaIntegra, resolverInicial, verificarCadeia, type EloDaCadeia } from "../cadeia-inventario.js";

// A serie real de 2026 no momento em que o problema foi descoberto: julho e
// agosto sem INVENTARIO_INICIAL, apurando com zero de abertura.
const SERIE_QUEBRADA: EloDaCadeia[] = [
  { competenceYear: 2026, competenceMonth: 4, inicial: 130462.37, final: 73682.14 },
  { competenceYear: 2026, competenceMonth: 5, inicial: 73682.14, final: 81137.68 },
  { competenceYear: 2026, competenceMonth: 6, inicial: 81137.68, final: 115291.14 },
  { competenceYear: 2026, competenceMonth: 7, inicial: null, final: 49888.87 },
  { competenceYear: 2026, competenceMonth: 8, inicial: null, final: 63301.6 },
  { competenceYear: 2026, competenceMonth: 9, inicial: 63301.6, final: null }
];

describe("resolverInicial", () => {
  test("usa o snapshot proprio quando ele existe", () => {
    expect(resolverInicial(81137.68, 81137.68)).toEqual({ valor: 81137.68, origem: "PROPRIO" });
  });

  test("sem snapshot proprio, herda o final do mes anterior", () => {
    // Era aqui que a conta devolvia 0 e o CMV de julho saia R$ 115 mil menor.
    expect(resolverInicial(null, 115291.14)).toEqual({ valor: 115291.14, origem: "HERDADO_DO_ANTERIOR" });
  });

  test("o proprio vence mesmo divergindo do anterior — divergir e assunto da verificacao", () => {
    // Herdar por conta propria apagaria a divergencia em vez de expo-la.
    expect(resolverInicial(50000, 81137.68).valor).toBe(50000);
  });

  test("zero proprio e um valor legitimo, nao ausencia", () => {
    expect(resolverInicial(0, 81137.68)).toEqual({ valor: 0, origem: "PROPRIO" });
  });

  test("primeiro mes da serie fica em zero, declarado", () => {
    expect(resolverInicial(null, null)).toEqual({ valor: 0, origem: "INEXISTENTE" });
  });

  test("valor invalido nao passa por valido", () => {
    expect(resolverInicial(Number.NaN, 200).origem).toBe("HERDADO_DO_ANTERIOR");
    expect(resolverInicial(null, Number.NaN).origem).toBe("INEXISTENTE");
  });
});

describe("verificarCadeia", () => {
  test("aponta os dois meses sem inicial da serie real", () => {
    const quebras = verificarCadeia(SERIE_QUEBRADA);
    const ausentes = quebras.filter((q) => q.tipo === "INICIAL_AUSENTE");
    expect(ausentes.map((q) => q.competenceMonth)).toEqual([7, 8]);
    expect(ausentes[0].valorEsperado).toBe(115291.14);
  });

  test("a serie corrigida nao tem quebra nenhuma", () => {
    const corrigida = SERIE_QUEBRADA.map((e) =>
      e.competenceMonth === 7 ? { ...e, inicial: 115291.14 }
      : e.competenceMonth === 8 ? { ...e, inicial: 49888.87 }
      : e);
    expect(verificarCadeia(corrigida)).toEqual([]);
    expect(cadeiaIntegra(corrigida)).toBe(true);
  });

  test("inicial que nao bate com o final anterior e apontado com a diferenca", () => {
    const [quebra] = verificarCadeia([
      { competenceYear: 2026, competenceMonth: 6, inicial: 100, final: 500 },
      { competenceYear: 2026, competenceMonth: 7, inicial: 450, final: 300 }
    ]);
    expect(quebra.tipo).toBe("INICIAL_DIVERGENTE");
    expect(quebra.diferenca).toBe(-50);
    expect(quebra.valorEsperado).toBe(500);
  });

  test("diferenca de centavo nao vira alerta", () => {
    // Os valores vem de Decimal(14,2): exigir igualdade exata geraria ruido.
    expect(verificarCadeia([
      { competenceYear: 2026, competenceMonth: 6, inicial: 100, final: 500.0 },
      { competenceYear: 2026, competenceMonth: 7, inicial: 500.009, final: 300 }
    ])).toEqual([]);
  });

  test("o primeiro mes da serie nunca e cobrado por inicial", () => {
    // Nao ha de onde herdar. Cobrar geraria um alerta permanente, e alerta
    // permanente treina quem fecha a ignorar a tela.
    expect(verificarCadeia([
      { competenceYear: 2026, competenceMonth: 4, inicial: null, final: 73682.14 },
      { competenceYear: 2026, competenceMonth: 5, inicial: 73682.14, final: 81137.68 }
    ])).toEqual([]);
  });

  test("o ultimo mes nao e cobrado por final — ainda esta aberto", () => {
    const quebras = verificarCadeia(SERIE_QUEBRADA);
    expect(quebras.some((q) => q.tipo === "FINAL_AUSENTE" && q.competenceMonth === 9)).toBe(false);
  });

  test("mes do meio sem final e cobrado: o seguinte precisa dele", () => {
    const quebras = verificarCadeia([
      { competenceYear: 2026, competenceMonth: 6, inicial: 100, final: null },
      { competenceYear: 2026, competenceMonth: 7, inicial: 200, final: 300 },
      { competenceYear: 2026, competenceMonth: 8, inicial: 300, final: 400 }
    ]);
    expect(quebras.some((q) => q.tipo === "FINAL_AUSENTE" && q.competenceMonth === 6)).toBe(true);
  });

  test("sem final anterior nao ha o que cobrar do inicial seguinte", () => {
    const quebras = verificarCadeia([
      { competenceYear: 2026, competenceMonth: 6, inicial: 100, final: null },
      { competenceYear: 2026, competenceMonth: 7, inicial: null, final: 300 }
    ]);
    expect(quebras.some((q) => q.tipo === "INICIAL_AUSENTE")).toBe(false);
  });

  test("serie vazia ou de um mes nao quebra", () => {
    expect(verificarCadeia([])).toEqual([]);
    expect(verificarCadeia([{ competenceYear: 2026, competenceMonth: 4, inicial: null, final: null }])).toEqual([]);
  });

  test("toda quebra tem mensagem legivel com o mes", () => {
    for (const q of verificarCadeia(SERIE_QUEBRADA)) {
      expect(q.mensagem).toMatch(/\d{2}\/\d{4}/);
      expect(q.mensagem.length).toBeGreaterThan(20);
    }
  });
});
