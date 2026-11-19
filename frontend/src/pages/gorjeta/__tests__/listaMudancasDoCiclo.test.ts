import { describe, expect, test } from "vitest";
import type { TipMudanca } from "../../../api/client";
import { mudancasDoCiclo } from "../listaMudancasDoCiclo";

const INICIO = "2026-10-26T00:00:00.000Z";
const FIM = "2026-11-25T00:00:00.000Z";

// Dados fictícios.
const m = (over: Partial<TipMudanca>): TipMudanca => ({
  id: "m", employeeId: "e", employeeName: "Ana Ficticia", validFrom: "2026-11-01T00:00:00.000Z", tipo: "PROMOCAO",
  funcaoAntes: "Garçom", funcaoDepois: "Garçom", baseAntes: 3.5, baseDepois: 4, diferenca: 0.5, participa: true, motivo: null,
  registradoEm: "2026-11-02T15:00:00.000Z", registradoPor: "Eli", ...over,
});

describe("mudancasDoCiclo", () => {
  test("só entra o que vale dentro do ciclo, bordas incluídas; situação inicial não é mudança", () => {
    const r = mudancasDoCiclo([
      m({ id: "antes", validFrom: "2026-10-25T00:00:00.000Z" }),
      m({ id: "ini", validFrom: "2026-10-26T00:00:00.000Z" }),
      m({ id: "meio", validFrom: "2026-11-10T00:00:00.000Z" }),
      m({ id: "fim", validFrom: "2026-11-25T00:00:00.000Z" }),
      m({ id: "depois", validFrom: "2026-11-26T00:00:00.000Z" }),
      m({ id: "inicial", tipo: "INICIAL", validFrom: "2026-11-05T00:00:00.000Z" }),
    ], INICIO, FIM);
    expect(r.map((x) => x.id).sort()).toEqual(["fim", "ini", "meio"]);
  });

  test("resumo diz o que mudou, em palavras", () => {
    const resumo = (o: Partial<TipMudanca>) => mudancasDoCiclo([m(o)], INICIO, FIM)[0].resumo;
    expect(resumo({})).toBe("Promoção: 3,5 → 4 pts");
    expect(resumo({ tipo: "REDUCAO", baseAntes: 4, baseDepois: 3.5 })).toBe("Redução: 4 → 3,5 pts");
    expect(resumo({ tipo: "TROCA_DE_FUNCAO", funcaoAntes: "Garçom", funcaoDepois: "Cumim", baseAntes: 3.5, baseDepois: 3 })).toBe("Troca de função: Garçom → Cumim (3,5 → 3 pts)");
    expect(resumo({ tipo: "ENTRADA" })).toBe("Entrou na gorjeta");
    expect(resumo({ tipo: "SAIDA" })).toBe("Saiu da gorjeta");
    expect(resumo({ tipo: "OUTRA" })).toBe("Alteração no cadastro da gorjeta");
  });

  test("lançada depois do fim do ciclo (no dia de Brasília) é marcada como retroativa", () => {
    const r = mudancasDoCiclo([
      m({ id: "no-prazo", registradoEm: "2026-11-25T10:00:00.000Z" }),
      // 01:00 UTC de 26/11 ainda é 22:00 de 25/11 em Brasília: dentro do ciclo.
      m({ id: "noite", registradoEm: "2026-11-26T01:00:00.000Z" }),
      m({ id: "depois", registradoEm: "2026-11-27T15:00:00.000Z" }),
    ], INICIO, FIM);
    expect(Object.fromEntries(r.map((x) => [x.id, x.retroativa]))).toEqual({ "no-prazo": false, noite: false, depois: true });
  });

  test("ordena por nome e, na mesma pessoa, por vigência", () => {
    const r = mudancasDoCiclo([
      m({ id: "b2", employeeName: "Bia", validFrom: "2026-11-20T00:00:00.000Z" }),
      m({ id: "a", employeeName: "Ana" }),
      m({ id: "b1", employeeName: "Bia", validFrom: "2026-11-05T00:00:00.000Z" }),
    ], INICIO, FIM);
    expect(r.map((x) => x.id)).toEqual(["a", "b1", "b2"]);
  });
});
