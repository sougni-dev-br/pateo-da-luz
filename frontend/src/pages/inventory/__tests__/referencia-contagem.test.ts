import { describe, expect, test } from "vitest";
import type { ReferenciaDaContagem } from "../../../api/client";
import { lerContagem, totalDaContagem } from "../referencia-contagem";

function ref(parcial: Partial<ReferenciaDaContagem>): ReferenciaDaContagem {
  return { itemId: "i1", anterior: 5, anteriorData: "2026-08-31", anteriorCodigo: "INV-2026-0024", compras: 0, custoUnitario: 52.08, ...parcial };
}

describe("lerContagem — anterior + compras = disponivel", () => {
  test("contar mais do que havia, sem compra, e sobra sem origem com valor", () => {
    // Caso real da conferencia de setembro: vinho com 5 UN e nenhuma compra, contado 11.
    const leitura = lerContagem(ref({}), "11");
    expect(leitura.situacao).toBe("ACIMA_DO_DISPONIVEL");
    expect(leitura.disponivel).toBe(5);
    expect(leitura.sobra).toBe(6);
    expect(leitura.valorSemOrigem).toBe(312.48);
    expect(leitura.valor).toBe(572.88);
  });

  test("compra do periodo entra no disponivel", () => {
    expect(lerContagem(ref({ compras: 10 }), "14").situacao).toBe("OK");
  });

  test("ate 5% acima do disponivel e balanca, nao sobra", () => {
    expect(lerContagem(ref({ anterior: 10, compras: 0 }), "10,4").situacao).toBe("OK");
    expect(lerContagem(ref({ anterior: 10, compras: 0 }), "10,6").situacao).toBe("ACIMA_DO_DISPONIVEL");
  });

  test("zerar com compra no periodo e suspeito; sem compra e consumo", () => {
    expect(lerContagem(ref({ compras: 3 }), "0").situacao).toBe("ZERADO_COM_COMPRA");
    expect(lerContagem(ref({ compras: 0 }), "0").situacao).toBe("OK");
  });

  test("sem contagem aprovada anterior nao ha conta, mas ha valor", () => {
    const leitura = lerContagem(ref({ anterior: null }), "2");
    expect(leitura.situacao).toBe("SEM_REFERENCIA");
    expect(leitura.disponivel).toBeNull();
    expect(leitura.valor).toBe(104.16);
  });

  test("campo vazio fica pendente; sem custo nao inventa valor", () => {
    expect(lerContagem(ref({}), "").situacao).toBe("PENDENTE");
    expect(lerContagem(ref({ custoUnitario: null }), "3").valor).toBeNull();
  });

  test("quantidade com virgula decimal", () => {
    expect(lerContagem(ref({ anterior: 2, compras: 0, custoUnitario: 10 }), "1,5").valor).toBe(15);
  });
});

describe("totalDaContagem", () => {
  test("soma contado x custo e separa os contados sem custo", () => {
    const referencias = {
      a: ref({ itemId: "a", custoUnitario: 10 }),
      b: ref({ itemId: "b", custoUnitario: null }),
      c: ref({ itemId: "c", custoUnitario: 2.5 })
    };
    const total = totalDaContagem(["a", "b", "c", "d"], referencias, { a: "3", b: "4", c: "", d: "1" });
    expect(total).toEqual({ valor: 30, contadosSemCusto: 2, acimaDoDisponivel: 0 });
  });

  test("zero sem custo nao conta como sem custo", () => {
    const total = totalDaContagem(["a"], { a: ref({ itemId: "a", custoUnitario: null }) }, { a: "0" });
    expect(total.contadosSemCusto).toBe(0);
  });

  test("conta os itens acima do disponivel", () => {
    const total = totalDaContagem(["a"], { a: ref({ itemId: "a" }) }, { a: "11" });
    expect(total.acimaDoDisponivel).toBe(1);
  });
});
