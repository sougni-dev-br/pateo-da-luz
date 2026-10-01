import { describe, expect, test } from "vitest";
import { agruparEnvioPorEmpresa, celulaOuTraco, nomeNoEnvio, textoPdf, type LinhaEnvio } from "../envioContabilidade";

const linha = (nome: string, empresa: string, gorjeta: number, companyId = empresa): LinhaEnvio =>
  ({ pessoa: { employeeName: nome, companyId } as LinhaEnvio["pessoa"], empresa, gorjeta, peloTeto: false });

describe("PDF do envio à contabilidade", () => {
  test("agrupa por empresa mantendo a ordem e soma o subtotal", () => {
    const g = agruparEnvioPorEmpresa([linha("A", "Pateo da Luz", 1111.77), linha("B", "Pateo da Luz", 0.1), linha("C", "Pateo Frei", 0.2)]);
    expect(g.map((x) => [x.empresa, x.linhas.length, x.subtotal])).toEqual([["Pateo da Luz", 2, 1111.87], ["Pateo Frei", 1, 0.2]]);
  });

  test("texto do PDF não leva o sinal de menos que a fonte não tem", () => {
    expect(textoPdf("rateio − vales – créditos")).toBe("rateio - vales - créditos");
  });

  test("nomes saem em maiúsculas e células vazias viram traço", () => {
    expect(nomeNoEnvio(" Elioenai Ferreira da Silva ")).toBe("ELIOENAI FERREIRA DA SILVA");
    expect([celulaOuTraco(""), celulaOuTraco(null), celulaOuTraco(0), celulaOuTraco("15:13"), celulaOuTraco(2)]).toEqual(["-", "-", "-", "15:13", "2"]);
  });
});
