import { describe, expect, test } from "vitest";
import type { FichaItemImportacao, FichaPessoaPrevista } from "../../../api/client";
import { alternar, itensPorTipo, marcarTodos, selecaoInicial, selecoesParaEnvio, temSalario, totais } from "../fichaImportacao";

const item = (o: Partial<FichaItemImportacao> & Pick<FichaItemImportacao, "id" | "tipo">): FichaItemImportacao => ({
  rotulo: o.id, atual: null, ficha: null, detalhes: [], padrao: false, bloqueio: null, ...o,
});
const pessoa = (o: Partial<FichaPessoaPrevista> = {}): FichaPessoaPrevista => ({
  chave: "e1", employeeId: "e1", nome: "FULANA DE TAL", registro: "000020", situacao: "COM_ITENS", cadastro: null,
  itens: [], suspeitos: [], observacoes: [], ...o,
});

describe("selecaoInicial", () => {
  test("marca só o que vem como padrão e não está bloqueado", () => {
    const p = pessoa({
      itens: [
        item({ id: "preenche:cbo", tipo: "PREENCHE", padrao: true }),
        item({ id: "preenche:pis", tipo: "PREENCHE", padrao: true, bloqueio: "x" }),
        item({ id: "diverge:racaCor", tipo: "DIVERGE" }),
        item({ id: "salario", tipo: "SALARIO" }),
      ],
    });
    expect(selecaoInicial([p])).toEqual({ e1: ["preenche:cbo"] });
  });

  test("pessoa sem nada marcado não entra na seleção", () => {
    expect(selecaoInicial([pessoa({ itens: [item({ id: "cargo", tipo: "CARGO" })] })])).toEqual({});
  });
});

describe("alternar e marcarTodos", () => {
  test("alternar marca e desmarca sem alterar o objeto original", () => {
    const antes = { e1: ["a"] };
    const marcado = alternar(antes, "e1", "b");
    expect(marcado).toEqual({ e1: ["a", "b"] });
    expect(antes).toEqual({ e1: ["a"] });
    expect(alternar(marcado, "e1", "a")).toEqual({ e1: ["b"] });
  });

  test("marcar tudo ignora os bloqueados e as trocas de dados pessoais; desmarcar limpa a pessoa", () => {
    const p = pessoa({ itens: [item({ id: "a", tipo: "PREENCHE" }), item({ id: "b", tipo: "SALARIO", bloqueio: "desligado" }), item({ id: "diverge:rg", tipo: "DIVERGE" })] });
    expect(marcarTodos({}, p, true)).toEqual({ e1: ["a"] });
    expect(marcarTodos({ e1: ["a"] }, p, false)).toEqual({ e1: [] });
  });
});

describe("totais, envio e salário", () => {
  test("totais contam itens e pessoas com algo marcado", () => {
    expect(totais({ e1: ["a", "b"], e2: [], e3: ["c"] })).toEqual({ itens: 3, pessoas: 2 });
  });

  test("o envio é por funcionário e deixa de fora quem não tem cadastro ou nada marcado", () => {
    const pessoas = [pessoa(), pessoa({ chave: "sem:1", employeeId: null }), pessoa({ chave: "e3", employeeId: "e3" })];
    expect(selecoesParaEnvio({ e1: ["a"], "sem:1": ["x"], e3: [] }, pessoas)).toEqual({ e1: ["a"] });
  });

  test("temSalario enxerga o item de salário em qualquer pessoa", () => {
    expect(temSalario({ e1: ["a"], e2: ["salario"] })).toBe(true);
    expect(temSalario({ e1: ["a"] })).toBe(false);
  });
});

describe("itensPorTipo", () => {
  test("agrupa na ordem de apresentação e omite grupo vazio", () => {
    const grupos = itensPorTipo([item({ id: "s", tipo: "SALARIO" }), item({ id: "p", tipo: "PREENCHE" }), item({ id: "d", tipo: "DIVERGE" })]);
    expect(grupos.map((g) => g.tipo)).toEqual(["PREENCHE", "SALARIO", "DIVERGE"]);
  });
});
