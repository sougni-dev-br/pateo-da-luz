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

  test("nomes saem como nome próprio e células vazias viram traço", () => {
    expect(nomeNoEnvio(" ELIOENAI FERREIRA DA SILVA ")).toBe("Elioenai Ferreira da Silva");
    expect(nomeNoEnvio("maria  jose silva de freitas")).toBe("Maria Jose Silva de Freitas");
    expect(nomeNoEnvio("JULIANA MENDES GONÇALVES")).toBe("Juliana Mendes Gonçalves");
    expect([celulaOuTraco(""), celulaOuTraco(null), celulaOuTraco(0), celulaOuTraco("15:13"), celulaOuTraco(2)]).toEqual(["-", "-", "-", "15:13", "2"]);
  });
});

test("totais do resumo somam horas (h:mm), faltas e atestados", async () => {
  const { totaisDoEnvio } = await import("../envioContabilidade");
  const { parseHoras } = await import("../gorjetaUtils");
  const l = (horaExtra: string | null, adicionalNoturno: string | null, faltas: number, atestados: number): LinhaEnvio =>
    ({ pessoa: { horaExtra, adicionalNoturno, faltas, atestados } as LinhaEnvio["pessoa"], empresa: "X", gorjeta: 0, peloTeto: false });
  expect(totaisDoEnvio([l("15:13", null, 0, 0), l("24:27", "5:06", 1, 2)], parseHoras))
    .toEqual({ minutosHoraExtra: 39 * 60 + 40, minutosNoturno: 306, faltas: 1, atestados: 2 });
});

test("impressão: gorjeta zero sem hora extra sai; com hora extra ou noturno fica", async () => {
  const { entraNaImpressao } = await import("../envioContabilidade");
  const { parseHoras } = await import("../gorjetaUtils");
  const l = (gorjeta: number, horaExtra: string | null = null, adicionalNoturno: string | null = null): LinhaEnvio =>
    ({ pessoa: { horaExtra, adicionalNoturno, faltas: 2 } as LinhaEnvio["pessoa"], empresa: "X", gorjeta, peloTeto: false });
  expect(entraNaImpressao(l(0), parseHoras)).toBe(false);
  expect(entraNaImpressao(l(0, "2:30"), parseHoras)).toBe(true);
  expect(entraNaImpressao(l(0, null, "0:28"), parseHoras)).toBe(true);
  expect(entraNaImpressao(l(745.32), parseHoras)).toBe(true);
});
