import { describe, expect, test } from "vitest";
import { lerTextoExtrato } from "../rh-extract.service.js";

// Trecho no formato que a pdf-parse devolve do extrato do adiantamento (09/2026),
// com nome e CPF fictícios.
const ADIANTAMENTO = `Página: 1/2
Emissão: 08/09/2026
Horas: 16:20:33
EXTRATO MENSAL
09/2026
Empresa:
Competência:
Cálculo: Adiantamento
05.520.881/0001-95
PATEO DA LUZ COMERCIO DE ALIMENTOS LTDA
CNPJ:
1133 FULANO DE TAL	Empr.: 01/03/2007	Adm:	111.222.333-44	Trabalhando CPF:	Situação:
Celetista	Vínculo: 220,00	Horas Mês:	1	1 Depto:	CC:
Cargo: 513210 COZINHEIRO 2.584,16	Salário:	C.B.O: Filial: 1	513205
859 TROCO DO ADIANTAMENTO P	0,34	0,00
980 ADIANTAMENTO SALARIAL P	1.033,66	40,00
ND: 0 Proventos: 1.034,00 Líquido:	Descontos: 0,00 Informativa: 0 Informativa Dedutora: 0 1.034,00
NF: 0 Base INSS: 0,00 Base FGTS: Base IRRF:	0,00 1.033,66	Excedente INSS: 0,00 Valor FGTS: 0,00
Total Geral Proventos: Total Geral Descontos:	1.034,00 0,00
`;

describe("extrato do adiantamento salarial", () => {
  test("reconhece o cálculo de adiantamento pelo cabeçalho", () => {
    const e = lerTextoExtrato(ADIANTAMENTO);
    expect(e.calculo).toBe("ADIANTAMENTO");
    expect(e.competenceMonth).toBe(9);
    expect(e.competenceYear).toBe(2026);
  });

  test("lê o líquido pago e o valor do adiantamento (sem o troco)", () => {
    const [f] = lerTextoExtrato(ADIANTAMENTO).funcionarios;
    expect(f).toMatchObject({ nome: "FULANO DE TAL", liquido: 1034, adiantamento: 1033.66, gorjeta: null });
  });

  test("a folha do mês continua sendo lida como MENSAL", () => {
    const mensal = ADIANTAMENTO.replace("Cálculo: Adiantamento", "Cálculo: Folha Mensal");
    expect(lerTextoExtrato(mensal).calculo).toBe("MENSAL");
  });
});
