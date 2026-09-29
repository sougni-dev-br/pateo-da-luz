import { describe, expect, test } from "vitest";
import { problemaDoItem, resumirDistribuicao } from "../reservaDistribuicao";

const item = (employeeId: string, valor: string) => ({ employeeId, valor, descricao: "" });

describe("problemaDoItem", () => {
  test("linha completa com valor positivo é enviada", () => {
    expect(problemaDoItem(item("e1", "10,50"))).toBeNull();
  });

  test("diz o que falta em cada linha que fica de fora", () => {
    expect(problemaDoItem(item("", ""))).toBe("linha vazia: fica de fora");
    expect(problemaDoItem(item("", "50"))).toBe("falta escolher o funcionário");
    expect(problemaDoItem(item("e1", ""))).toBe("falta o valor");
    expect(problemaDoItem(item("e1", "0"))).toBe("o valor precisa ser maior que zero");
    expect(problemaDoItem(item("e1", "-5"))).toBe("o valor precisa ser maior que zero");
    expect(problemaDoItem(item("e1", "abc"))).toBe("o valor precisa ser maior que zero");
  });
});

describe("resumirDistribuicao", () => {
  test("o total soma só as linhas enviadas", () => {
    const r = resumirDistribuicao([item("e1", "100"), item("", "50"), item("e2", "0,1"), item("e3", "0,2")]);
    expect(r.validos.map((i) => i.employeeId)).toEqual(["e1", "e2", "e3"]);
    expect(r.total).toBe(100.3);
    expect(r.foraDaConta).toBe(1);
  });

  test("nada válido dá total zero", () => {
    expect(resumirDistribuicao([item("", "")])).toEqual({ validos: [], total: 0, foraDaConta: 1 });
  });
});
