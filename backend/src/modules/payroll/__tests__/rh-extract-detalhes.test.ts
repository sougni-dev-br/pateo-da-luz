import { describe, expect, test } from "vitest";
import { lerDetalhesExtrato, lerRubrica } from "../rh-extract-detalhes.js";
import { lerTextoExtrato } from "../rh-extract.service.js";

// Folha mensal no formato que a pdf-parse devolve, com nomes, CPFs e valores fictícios.
// A segunda pessoa atravessa a quebra de página; a terceira é o pró-labore ("Contr:")
// e vem colada no "Total Geral" e no "Resumo por Rubrica".
const CABECALHO = (pagina: string) => `Página: ${pagina}
Emissão: 28/08/2026
Horas: 10:57:55
EXTRATO MENSAL
08/2026
Empresa:
Competência:
Cálculo: Folha Mensal
12.345.678/0001-90
RESTAURANTE FICTICIO LTDA
CNPJ:
`;

const FOLHA = `${CABECALHO("1/2")}900 FULANO DE TAL	Empr.: 01/11/2014	Adm:	111.222.333-44	Demitido CPF:	Situação:
Celetista	Vínculo: 220,00	Horas Mês:	1	1 Depto:	CC:
Cargo: 848340 GERENTE GERAL 4.000,00	Salário:	C.B.O: Filial: 1	141510
28 FERIAS VENCIDAS 51 5.000,00 D	P	4.000,00	1,00 LIQUIDO RESCISAO 0,00
811 FERIAS 1/12 INDENIZADO P	1.000,00	1,00
ND: 0 Proventos: 5.000,00 Líquido:	Descontos: 5.000,00 Informativa: 400,00 Informativa Dedutora: 0 0,00
NF: 0 Base INSS: 4.000,00 Base FGTS: Base IRRF:	5.000,00 3.500,00	Excedente INSS: 0,00 Valor FGTS: 400,00
DEMITIDO EM 01/08/2026 - MOTIVO 2-Demitido SEM justa causa
48 CICRANA DA SILVA	Empr.: 21/07/2026	Adm:	555.666.777-88	Trabalhando CPF:	Situação:
Celetista	Vínculo: 220,00	Horas Mês:	1	1 Depto:	CC:
Cargo: 7 BARMAN 2.450,00	Salário:	C.B.O: Filial: 1	513420
1 HORAS NORMAIS 204 980,00 D	P	2.450,00	220,00 FALTAS DIA 12,00
Sistema licenciado para FULANO CONTADOR

-- 1 of 2 --

${CABECALHO("2/2")}992 TROCO DO MES 981 980,00 D	P	0,25	0,00 DESC.ADIANT.SALARIAL 980,00
998 110,25 D	I.N.S.S. 7,50
ND: 0 Proventos: 2.450,25 Líquido:	Descontos: 2.070,25 Informativa: 117,60 Informativa Dedutora: 0 380,00
NF: 0 Base INSS: 1.470,00 Base FGTS: Base IRRF:	1.470,00 -117,20	Excedente INSS: 0,00 Valor FGTS: 117,60
3 BELTRANO SOCIO	Contr: 01/05/2026	Adm:	999.888.777-66	Trabalhando CPF:	Situação:
Diretor	Vínculo: Horas Mês:	1	1 Depto:	CC:
Cargo: 948349 DIRETOR ADMINISTRATIVO 4.000,00	Salário:	C.B.O: Filial: 1	123105
100 PRO-LABORE 843 440,00 D	P	4.000,00	220,00 INSS EMPREGADOR 11,00
ND: 0 Proventos: 4.000,00 Líquido:	Descontos: 440,00 Informativa: 0 Informativa Dedutora: 0 3.560,00
NF: 0 Base INSS: 4.000,00 Base FGTS: Base IRRF:	0,00 3.392,80	Excedente INSS: 0,00 Valor FGTS: 0,00
Total Geral Proventos: Total Geral Descontos:	11.450,25 7.510,25
Líquido Geral: 3.940,00
Resumo por Rubrica
1 HORAS NORMAIS 204 FALTAS DIA 980,00 D	P	2.450,00	220,00 12,00
992 TROCO DO MES P	0,25	0,00
Líquido Geral: 3.940,00
Sistema licenciado para FULANO CONTADOR

-- 2 of 2 --
`;

describe("lerDetalhesExtrato — cabeçalho da pessoa", () => {
  const { pessoas, emissao, totalProventos, totalDescontos, totalLiquido } = lerDetalhesExtrato(FOLHA);

  test("lê as três pessoas, inclusive o pró-labore (Contr:)", () => {
    expect(pessoas.map((p) => p.nome)).toEqual(["FULANO DE TAL", "CICRANA DA SILVA", "BELTRANO SOCIO"]);
  });

  test("matrícula, admissão, situação, vínculo, horas, cargo, salário base e CBO", () => {
    expect(pessoas[0]).toMatchObject({
      matricula: "900", admissao: "2014-11-01", situacao: "Demitido", vinculo: "Celetista", horasMes: 220,
      cargoCodigo: "848340", cargo: "GERENTE GERAL", salarioBase: 4000, cbo: "141510",
    });
    expect(pessoas[2]).toMatchObject({ vinculo: "Diretor", horasMes: null, admissao: "2026-05-01", cargo: "DIRETOR ADMINISTRATIVO" });
  });

  test("rodapé: proventos, descontos, líquido, bases (FGTS antes do IRRF) e FGTS", () => {
    expect(pessoas[0]).toMatchObject({ proventos: 5000, descontos: 5000, liquido: 0, baseInss: 4000, baseFgts: 5000, baseIrrf: 3500, valorFgts: 400 });
    expect(pessoas[1]).toMatchObject({ liquido: 380, baseIrrf: -117.2 });
    expect(pessoas[2]).toMatchObject({ baseFgts: 0, baseIrrf: 3392.8, valorFgts: 0 });
  });

  test("demissão com data, motivo e líquido da rescisão", () => {
    expect(pessoas[0]).toMatchObject({ demissao: "2026-08-01", demissaoMotivo: "2-Demitido SEM justa causa", liquidoRescisao: 5000 });
    expect(pessoas[1]).toMatchObject({ demissao: null, liquidoRescisao: null });
  });

  test("cabeçalho do extrato: emissão e totais gerais", () => {
    expect({ emissao, totalProventos, totalDescontos, totalLiquido }).toEqual({
      emissao: "2026-08-28", totalProventos: 11450.25, totalDescontos: 7510.25, totalLiquido: 3940,
    });
  });
});

describe("lerDetalhesExtrato — rubricas e conferência", () => {
  const { pessoas } = lerDetalhesExtrato(FOLHA);

  test("linha dupla vira um provento e um desconto", () => {
    expect(pessoas[0].rubricas).toContainEqual({ codigo: "28", descricao: "FERIAS VENCIDAS", tipo: "P", valor: 4000, referencia: 1 });
    expect(pessoas[0].rubricas).toContainEqual({ codigo: "51", descricao: "LIQUIDO RESCISAO", tipo: "D", valor: 5000, referencia: 0 });
  });

  test("linha simples e desconto sozinho na linha", () => {
    expect(lerRubrica("811 FERIAS 1/12 INDENIZADO P\t1.000,00\t1,00")).toEqual([
      { codigo: "811", descricao: "FERIAS 1/12 INDENIZADO", tipo: "P", valor: 1000, referencia: 1 },
    ]);
    expect(lerRubrica("998 110,25 D\tI.N.S.S. 7,50")).toEqual([
      { codigo: "998", descricao: "I.N.S.S.", tipo: "D", valor: 110.25, referencia: 7.5 },
    ]);
  });

  test("bloco que atravessa a página junta as rubricas das duas páginas", () => {
    expect(pessoas[1].rubricas.map((r) => r.codigo)).toEqual(["1", "204", "992", "981", "998"]);
    expect(pessoas[1].texto).not.toMatch(/Página:|Sistema licenciado|CNPJ:/);
  });

  test("o último bloco é cortado antes do Total Geral e do Resumo por Rubrica", () => {
    expect(pessoas[2].rubricas).toHaveLength(2);
    expect(pessoas[2].texto).not.toMatch(/Total Geral|Resumo/);
  });

  test("somas das rubricas batem com Proventos e Descontos → conferido", () => {
    expect(pessoas.every((p) => p.conferido)).toBe(true);
    expect(pessoas[1]).toMatchObject({ somaProventos: 2450.25, somaDescontos: 2070.25 });
  });

  test("soma que não bate fica conferido=false, com as somas lidas (não descarta)", () => {
    const quebrado = FOLHA.replace("Descontos: 440,00", "Descontos: 450,00");
    const p = lerDetalhesExtrato(quebrado).pessoas[2];
    expect(p).toMatchObject({ conferido: false, somaDescontos: 440, descontos: 450 });
  });

  test("linha de rubrica em formato desconhecido também derruba a conferência", () => {
    const estranho = FOLHA.replace("811 FERIAS 1/12 INDENIZADO P\t1.000,00\t1,00", "811 FERIAS ??? 1.000,00");
    const p = lerDetalhesExtrato(estranho).pessoas[0];
    expect(p.conferido).toBe(false);
    expect(p.naoLidas).toEqual(["811 FERIAS ??? 1.000,00"]);
  });
});

describe("lerDetalhesExtrato — CPF", () => {
  test("o texto guardado não tem CPF; o CPF só serve para vincular", () => {
    const { pessoas } = lerDetalhesExtrato(FOLHA);
    for (const p of pessoas) expect(p.texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(pessoas[0].texto).toContain("***.***.***-**");
    expect(pessoas[0].cpfNorm).toBe("11122233344");
  });

  test("a leitura antiga (Contas a Pagar) continua igual: só Empr., sem o pró-labore", () => {
    const antiga = lerTextoExtrato(FOLHA);
    expect(antiga.funcionarios.map((f) => f.nome)).toEqual(["FULANO DE TAL", "CICRANA DA SILVA"]);
  });
});
