import { describe, expect, test } from "vitest";
import { confirmacaoImportar, resumoImportacao, textoBotaoImportar } from "../extratoRhTextos";

const item = { nome: "FULANO", cpf: "•••.•••.•••-44", liquido: 1000, gorjeta: null, matched: true, employeeId: "e", employeeName: "Fulano", isActive: true };
const previa = (over: Record<string, unknown> = {}) => ({
  calculo: "ADIANTAMENTO" as const, competenceMonth: 8, competenceYear: 2026, items: [item, item, item], matchedCount: 3,
  totalLiquido: 3000, lancamentosExistentes: 0, ...over,
});

describe("textos do Retorno do RH", () => {
  test("extrato novo: lança, dizendo se é adiantamento ou salário", () => {
    expect(textoBotaoImportar(previa(), false)).toBe("Lançar adiantamentos no Contas a Pagar");
    expect(textoBotaoImportar(previa({ calculo: "MENSAL" }), false)).toBe("Lançar salários no Contas a Pagar");
    expect(confirmacaoImportar(previa())).toMatch(/^Lançar 3 adiantamentos de 08\/2026 com vencimento no dia 20 no Contas a Pagar \(total R\$\s?3\.000,00\)\?$/);
  });

  test("reimportação: diz que atualiza sem duplicar, não 'gerar'", () => {
    const p = previa({ calculo: "MENSAL", lancamentosExistentes: 3 });
    expect(textoBotaoImportar(p, false)).toBe("Atualizar e guardar o extrato");
    expect(textoBotaoImportar(p, true)).toBe("Atualizando…");
    expect(confirmacaoImportar(p)).toContain("Os 3 salários de 08/2026 já estão no Contas a Pagar. Reimportar atualiza os mesmos lançamentos");
    expect(confirmacaoImportar(p)).not.toMatch(/Gerar/);
  });

  test("parte nova, parte existente: conta as duas", () => {
    expect(confirmacaoImportar(previa({ lancamentosExistentes: 1, matchedCount: 2 })))
      .toMatch(/^Lançar 2 adiantamentos novo\(s\) de 08\/2026 com vencimento no dia 20 e atualizar 1 que já estão no Contas a Pagar, sem duplicar .* 1 pessoa\(s\) fora do cadastro serão cadastradas automaticamente\.$/);
  });

  test("resumo depois de importar separa lançados de atualizados", () => {
    expect(resumoImportacao({ calculo: "ADIANTAMENTO", titulosNovos: 0, titulosAtualizados: 14 })).toBe("14 já lançado(s) e atualizado(s), sem duplicar.");
    expect(resumoImportacao({ calculo: "MENSAL", titulosNovos: 2, titulosAtualizados: 1 })).toBe("2 salários lançado(s) no Contas a Pagar; 1 já lançado(s) e atualizado(s), sem duplicar.");
  });
});
