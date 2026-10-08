import { describe, expect, test } from "vitest";
import { avisosSoDaImportacao, confirmacaoImportar, resumoImportacao, textoBotaoImportar } from "../extratoRhTextos";

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

  test("resumo conta os excluídos à mão que a reimportação não recriou", () => {
    expect(resumoImportacao({ calculo: "MENSAL", titulosNovos: 0, titulosAtualizados: 2, titulosPulados: 1 }))
      .toBe("2 já lançado(s) e atualizado(s), sem duplicar; 1 excluído(s) à mão, não recriado(s).");
    expect(resumoImportacao({ calculo: "ADIANTAMENTO", titulosNovos: 0, titulosAtualizados: 0, titulosPulados: 3 }))
      .toBe("3 excluído(s) à mão, não recriado(s).");
  });

  test("backend antigo (sem titulosPulados) ou zero: nada muda no resumo", () => {
    expect(resumoImportacao({ calculo: "MENSAL", titulosNovos: 1, titulosAtualizados: 0 })).not.toMatch(/excluído/);
    expect(resumoImportacao({ calculo: "MENSAL", titulosNovos: 1, titulosAtualizados: 0, titulosPulados: 0 })).not.toMatch(/excluído/);
  });

  test("avisos da importação: só os que a prévia não mostrou", () => {
    const excluido = "Lançamento de FULANO foi excluído à mão no Contas a Pagar e não foi recriado.";
    expect(avisosSoDaImportacao({ avisos: ["Holerite X não conferido", excluido] }, { avisos: ["Holerite X não conferido"] })).toEqual([excluido]);
    expect(avisosSoDaImportacao({ avisos: [excluido] }, null)).toEqual([excluido]);
  });
});

describe("com a previsão do backend: conta só quem gera lançamento", () => {
  const prev = (over: Record<string, unknown>) => ({ novos: 0, atualizar: 0, zerados: 0, desligados: 0, excluidosAMao: 0, jaPagos: 0, comOutroRotulo: 0, ...over });
  const itens14 = Array.from({ length: 14 }, () => item);

  test("caso real: 8 a atualizar e 6 com líquido zero não viram '6 novos'", () => {
    const p = previa({ calculo: "MENSAL", competenceMonth: 9, items: itens14, matchedCount: 14, totalLiquido: 8000, lancamentosExistentes: 8, previsao: prev({ atualizar: 8, zerados: 6 }) });
    const texto = confirmacaoImportar(p);
    expect(texto).toMatch(/^Lançar 0 salários novo\(s\) de 09\/2026 e atualizar 8 que já estão no Contas a Pagar, sem duplicar; 6 com líquido zero não geram lançamento \(total R\$\s?8\.000,00\)\?$/);
    expect(texto).not.toMatch(/Lançar 6/);
    expect(textoBotaoImportar(p, false)).toBe("Atualizar e guardar o extrato");
  });

  test("desligados, excluídos à mão e já pagos têm o seu texto", () => {
    const p = previa({ calculo: "MENSAL", competenceMonth: 9, items: itens14, matchedCount: 14, previsao: prev({ novos: 2, atualizar: 9, desligados: 1, excluidosAMao: 1, jaPagos: 1 }) });
    expect(confirmacaoImportar(p)).toMatch(/^Lançar 2 salários novo\(s\) de 09\/2026 com vencimento no dia 5 do mês seguinte e atualizar 9 .*; 1 desligado\(s\) antes de 09\/2026 não geram lançamento; 1 excluído\(s\) à mão não volta\(m\); 1 já pago\(s\) não muda\(m\) /);
  });

  test("só atualizar, sem mais nada: o texto da reimportação", () => {
    const p = previa({ calculo: "MENSAL", lancamentosExistentes: 3, previsao: prev({ atualizar: 3 }) });
    expect(confirmacaoImportar(p)).toContain("Os 3 salários de 08/2026 já estão no Contas a Pagar.");
  });
});

describe("resumo depois de lançar, motivo por motivo", () => {
  test("líquido zero não aparece como 'excluído à mão'", () => {
    const texto = resumoImportacao({ calculo: "MENSAL", titulosNovos: 0, titulosAtualizados: 8, titulosPulados: 6, excluidosAMao: 0, zerados: 6, desligados: 0, jaPagos: 0, comOutroRotulo: 0 });
    expect(texto).toBe("8 já lançado(s) e atualizado(s), sem duplicar; 6 com líquido zero, sem lançamento (só o holerite guardado).");
    expect(texto).not.toMatch(/excluído/);
  });

  test("cada motivo com a sua contagem", () => {
    expect(resumoImportacao({ calculo: "MENSAL", titulosNovos: 1, titulosAtualizados: 0, titulosPulados: 5, excluidosAMao: 1, zerados: 1, desligados: 1, jaPagos: 1, comOutroRotulo: 1 }))
      .toBe("1 salário lançado(s) no Contas a Pagar; 1 excluído(s) à mão, não recriado(s); 1 com líquido zero, sem lançamento (só o holerite guardado); "
        + "1 desligado(s) antes da competência, sem lançamento; 1 já pago(s), não atualizado(s); 1 já lançado(s) com outro rótulo, não duplicado(s).");
  });
});

test("resumo mostra os adiantamentos tirados da folha do mês", () => {
  expect(resumoImportacao({ calculo: "MENSAL", titulosNovos: 18, titulosAtualizados: 0, adiantamentosDaFolha: 17 }))
    .toBe("18 salários lançado(s) no Contas a Pagar; 17 adiantamento(s) lançado(s) a partir da folha (valor bruto).");
});
