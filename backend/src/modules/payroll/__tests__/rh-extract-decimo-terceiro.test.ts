import { describe, expect, test } from "vitest";
import { mesmoPagamento } from "../folha-duplicidade.js";
import { calculoDoTexto, lerTextoExtrato } from "../rh-extract.service.js";

// Extrato do "13o Adiantamento" (1ª parcela do 13º) da contabilidade. Texto FICTÍCIO no
// mesmo layout do PDF real (nomes, CPFs e CNPJ inventados): o repositório é público.
const cabecalho = (calculo: string) => [
  "Página: 1/1", "Emissão: 12/11/2026", "Horas: 11:23:18", "EXTRATO MENSAL", "11/2026", "Empresa:", "Competência:",
  `Cálculo: ${calculo}`, "00.000.000/0001-00", "EMPRESA EXEMPLO COMERCIO LTDA", "CNPJ:",
];
const pessoa = (mat: number, nome: string, cpf: string, linhas: string[], proventos: string) => [
  `${mat} ${nome}\tEmpr.: 01/03/2020\tAdm:\t${cpf}\tTrabalhando CPF:\tSituação:`,
  "Celetista\tVínculo: 220,00\tHoras Mês:\t1\t1 Depto:\tCC:",
  "Cargo: 1 COZINHEIRO 2.400,00\tSalário:\tC.B.O: Filial: 1\t513205",
  ...linhas,
  `ND: 0 Proventos: ${proventos} Líquido:\tDescontos: 0,00 Informativa: 104,00 Informativa Dedutora: 0 ${proventos}`,
  "NF: 0 Base INSS: 0,00 Base FGTS: Base IRRF:\t1.300,00 0,00\tExcedente INSS: 0,00 Valor FGTS: 104,00",
];
const extrato = (calculo: string) => [
  ...cabecalho(calculo),
  ...pessoa(1, "ANA CLARA EXEMPLO", "000.000.001-91", [
    "13 13 SALARIO ADIANTADO P\t1.200,00\t12,00", "833 MEDIA HORAS 13o ADIANTADO P\t100,00\t12,00",
  ], "1.300,00"),
  ...pessoa(2, "BRUNO EXEMPLO FILHO", "000.000.002-72", ["13 13 SALARIO ADIANTADO P\t91,67\t1,00"], "91,67"),
  "Total Geral Proventos: Total Geral Descontos:\t1.391,67 0,00", "Líquido Geral: 1.391,67",
].join("\n");

describe("extrato do 13º adiantamento (1ª parcela)", () => {
  test("'Cálculo: 13o Adiantamento' é DECIMO_TERCEIRO, nunca a folha do mês", () => {
    expect(calculoDoTexto(extrato("13o Adiantamento"))).toBe("DECIMO_TERCEIRO");
  });
  test("variações de grafia do 13º também são reconhecidas", () => {
    expect(calculoDoTexto(extrato("13º Adiantamento"))).toBe("DECIMO_TERCEIRO");
    expect(calculoDoTexto(extrato("13° Adiantamento"))).toBe("DECIMO_TERCEIRO");
  });
  test("folha do mês e adiantamento do dia 20 seguem como antes", () => {
    expect(calculoDoTexto(extrato("Mensal"))).toBe("MENSAL");
    expect(calculoDoTexto(extrato("Adiantamento"))).toBe("ADIANTAMENTO");
  });
  test("13º que não é o adiantamento (2ª parcela) é recusado, não importado como folha", () => {
    expect(() => calculoDoTexto(extrato("13o Salário"))).toThrow(/ainda não é lido/);
  });
  test("lê as pessoas, o líquido e a competência; não confunde com adiantamento salarial", () => {
    const r = lerTextoExtrato(extrato("13o Adiantamento"));
    expect(r.calculo).toBe("DECIMO_TERCEIRO");
    expect(r).toMatchObject({ competenceMonth: 11, competenceYear: 2026, cnpj: "00.000.000/0001-00" });
    expect(r.funcionarios.map((f) => [f.nome, f.liquido, f.adiantamento])).toEqual([
      ["ANA CLARA EXEMPLO", 1300, null],
      ["BRUNO EXEMPLO FILHO", 91.67, null],
    ]);
    expect(r.funcionarios.reduce((a, f) => a + f.liquido, 0)).toBeCloseTo(1391.67, 2);
  });
});

describe("duplicidade do 13º", () => {
  const base = { employeeId: "e1", type: "DECIMO_TERCEIRO", competenceYear: 2026, competenceMonth: 11 };
  test("o 13º do extrato e o do período sem registro são pagamentos diferentes", () => {
    expect(mesmoPagamento(
      { ...base, id: "a", periodLabel: "13º Salário - 1ª parcela (extrato)" },
      { ...base, id: "b", periodLabel: "13º Salário - 1ª parcela" },
    )).toBe(false);
  });
  test("o salário continua sendo pagamento duplicado quando é o mesmo mês e a mesma pessoa", () => {
    const sal = { employeeId: "e1", type: "SALARIO", competenceYear: 2026, competenceMonth: 11 };
    expect(mesmoPagamento({ ...sal, id: "a", periodLabel: "Extrato 11/2026" }, { ...sal, id: "b", periodLabel: "Salário" })).toBe(true);
  });
});
