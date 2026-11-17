import { describe, expect, test } from "vitest";
import { mesesSemVariavel, type EntradaMesesFaltando } from "../decimo-terceiro-meses-faltando.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// Jan e fev sem apuração; mar a set fechados; out fechado; nov em andamento.
const status = new Map<number, string>([[3, "CLOSED"], [4, "CLOSED"], [5, "CLOSED"], [6, "CLOSED"], [7, "CLOSED"], [8, "CLOSED"], [9, "CLOSED"], [10, "CLOSED"], [11, "OPEN"]]);
const apurados = new Set([3, 4, 5, 6, 7, 8, 9, 10]);

function entrada(extra: Partial<EntradaMesesFaltando>): EntradaMesesFaltando {
  return { ano: 2026, inicio: d("2026-01-01"), desligamento: null, ate: null, variaveis: new Map(), informados: new Set(), status, apurados, ...extra };
}

describe("mesesSemVariavel", () => {
  test("separa mês sem apuração, mês apurado sem a pessoa e mês em andamento", () => {
    const r = mesesSemVariavel(entrada({ variaveis: new Map([[3, 100], [4, 100]]) }));
    expect(r.filter((m) => m.motivo === "SEM_APURACAO").map((m) => m.mes)).toEqual([1, 2]);
    expect(r.filter((m) => m.motivo === "SEM_LANCAMENTO").map((m) => m.mes)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(r.filter((m) => m.motivo === "EM_ANDAMENTO").map((m) => m.mes)).toEqual([11]);
  });

  test("só olha os meses do período da pessoa (entrou em 10/09; 23/09 não dá avo em setembro)", () => {
    const r = mesesSemVariavel(entrada({ inicio: d("2026-09-10") }));
    expect(r.map((m) => m.mes)).toEqual([9, 10, 11]);
  });

  test("mês informado à mão não falta mais", () => {
    const r = mesesSemVariavel(entrada({ inicio: d("2026-09-01"), variaveis: new Map([[9, 500]]), informados: new Set([9]) }));
    expect(r.map((m) => m.mes)).toEqual([10, 11]);
  });

  test("mês apurado em que a pessoa tem valor não falta", () => {
    const r = mesesSemVariavel(entrada({ inicio: d("2026-09-01"), variaveis: new Map([[9, 300], [10, 0]]) }));
    expect(r.map((m) => m.mes)).toEqual([11]);
  });

  test("respeita o fim do período sem registro", () => {
    const r = mesesSemVariavel(entrada({ inicio: d("2026-05-07"), ate: d("2026-05-31") }));
    expect(r).toEqual([{ mes: 5, motivo: "SEM_LANCAMENTO" }]);
  });

  test("sem início, ou período em ano anterior, não há o que faltar", () => {
    expect(mesesSemVariavel(entrada({ inicio: null }))).toEqual([]);
    expect(mesesSemVariavel(entrada({ ate: d("2025-12-31") }))).toEqual([]);
    expect(mesesSemVariavel(entrada({ desligamento: d("2025-06-30") }))).toEqual([]);
  });
});
