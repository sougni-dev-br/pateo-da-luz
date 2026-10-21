import { describe, expect, test } from "vitest";
import type { TaxPaymentDetail } from "../../../api/client";
import {
  FORM_VAZIO, codigoDaDenominacao, descricaoDasLinhas, formDaGuia, formDuplicado, linhasComValor, linhasDoModelo, mesSugerido, novaLinha,
  payloadDaGuia, totalDaGuia, totalDaLinha, type FormGuia,
  chaveDoNumero, descricaoDoCodigo, diferencaComOPapel, estadoDaDenominacao, pendenciasDaGuia, temVerbaDeRescisao, tipoDoGrupo, tipoSemCatalogo, valorColado,
  type ContextoDasPendencias,
} from "../formularioGuia";
import { modeloDoTipo, sugestoesDoTipo } from "../modelosDeGuia";

// Composição do DAS de exemplo (valores fictícios): o total é a soma das linhas.
const linhasDas = () => [
  novaLinha({ code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: "469,71" }),
  novaLinha({ code: "1002", description: "CSLL - SIMPLES NACIONAL", principal: "298,90" }),
  novaLinha({ code: "1004", description: "COFINS - SIMPLES NACIONAL", principal: "1.088,03" }),
  novaLinha({ code: "1005", description: "PIS - SIMPLES NACIONAL", principal: "235,71" }),
  novaLinha({ code: "1006", description: "INSS - SIMPLES NACIONAL", principal: "3.586,89" }),
  novaLinha({ code: "1007", description: "ICMS - SIMPLES NACIONAL SP", principal: "2.060,87" }),
];

const guiaDas = (): FormGuia => ({ ...FORM_VAZIO, documentType: "Simples Nacional / DAS", mes: "2026-09", dueDate: "2026-10-20", linhas: linhasDas() });

describe("total da guia", () => {
  test("soma as linhas do DAS ao centavo", () => {
    expect(totalDaGuia(linhasDas())).toBe(7740.11);
  });

  test("a linha soma principal, multa e juros", () => {
    expect(totalDaLinha({ principal: "100,10", fine: "2,20", interest: "0,30" })).toBe(102.6);
    expect(totalDaLinha({ principal: "0,10", fine: "0,20", interest: "" })).toBe(0.3);
  });

  test("só as linhas com valor contam: as do modelo em branco são ignoradas", () => {
    const linhas = [novaLinha({ description: "FGTS Mensal", principal: "1.383,57" }), novaLinha({ description: "FGTS Rescisório" })];
    expect(linhasComValor(linhas)).toHaveLength(1);
    expect(totalDaGuia(linhas)).toBe(1383.57);
  });

  test("a descrição para sugerir categoria usa só as linhas com valor", () => {
    const linhas = [
      novaLinha({ description: "CONTR PREV DESCONTA SEGURADO", principal: "10" }),
      novaLinha({ description: "IRRF - TRABALHO" }),
    ];
    expect(descricaoDasLinhas(linhas)).toBe("CONTR PREV DESCONTA SEGURADO");
  });
});

describe("modelos de guia", () => {
  test("DAS já traz as seis linhas do documento, com código", () => {
    const linhas = linhasDoModelo("Simples Nacional / DAS");
    expect(linhas.map((l) => l.code)).toEqual(["1001", "1002", "1004", "1005", "1006", "1007"]);
    expect(linhas[4].description).toBe("INSS - SIMPLES NACIONAL");
  });

  test("FGTS pede a quantidade de trabalhadores; DAS não", () => {
    expect(modeloDoTipo("FGTS").pedeTrabalhadores).toBe(true);
    expect(modeloDoTipo("Simples Nacional / DAS").pedeTrabalhadores).toBeFalsy();
  });

  test("FGTS traz as quatro colunas da guia, sem código", () => {
    const linhas = linhasDoModelo("FGTS");
    expect(linhas.map((l) => l.description)).toEqual(["FGTS Mensal", "FGTS Rescisório", "Indenização Compensatória", "Encargos FGTS"]);
    expect(linhas.every((l) => l.code === "")).toBe(true);
    expect(modeloDoTipo("FGTS").rotuloDocumento).toBe("Identificador");
  });

  test("DARF traz as duas linhas previdenciárias e sugere IRRF", () => {
    expect(linhasDoModelo("DARF").map((l) => l.code)).toEqual(["1082", "1099"]);
    expect(sugestoesDoTipo("DARF").map((l) => l.code)).toContain("0561");
  });

  test("tipo sem modelo começa com uma linha em branco", () => {
    const linhas = linhasDoModelo("IPTU");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].description).toBe("");
  });

  test("cada linha do modelo é uma linha nova (chave própria)", () => {
    const a = linhasDoModelo("FGTS");
    const b = linhasDoModelo("FGTS");
    expect(new Set([...a, ...b].map((l) => l.chave)).size).toBe(8);
  });

  test("digitar uma denominação conhecida devolve o código", () => {
    expect(codigoDaDenominacao("Simples Nacional / DAS", "cofins - simples nacional")).toBe("1004");
    expect(codigoDaDenominacao("Simples Nacional / DAS", "Outra coisa")).toBeNull();
  });
});

const CATALOGO_DAS = [
  { code: "1001", description: "IRPJ - SIMPLES NACIONAL" },
  { code: "1002", description: "CSLL - SIMPLES NACIONAL" },
  { code: "1006", description: "INSS - SIMPLES NACIONAL" },
];

const ctx = (extra: Partial<ContextoDasPendencias> = {}): ContextoDasPendencias => ({
  emEdicao: false, valoresFixos: false, exigeEmpresa: false, exigeCategoria: false, catalogo: CATALOGO_DAS, numeroRepetido: null, ...extra,
});

const guiaCompleta = (): FormGuia => ({ ...guiaDas(), documentNumber: "07.20.26290.7165263-2", companyId: "emp1", dreCategoryId: "cat1" });

describe("pendenciasDaGuia (a guia só conclui com tudo resolvido)", () => {
  test("guia completa não tem pendência", () => {
    expect(pendenciasDaGuia(guiaCompleta(), ctx())).toEqual([]);
  });

  test("FGTS novo sem a quantidade de trabalhadores é pendência; informada, resolve; edição não exige", () => {
    const fgts = { ...FORM_VAZIO, documentType: "FGTS", mes: "2026-07", dueDate: "2026-08-20", documentNumber: "123", linhas: [novaLinha({ description: "FGTS Mensal", principal: "10,00" })] };
    expect(pendenciasDaGuia(fgts, ctx({ catalogo: [] })).map((x) => x.campo)).toContain("trabalhadores");
    expect(pendenciasDaGuia({ ...fgts, workersCount: "12" }, ctx({ catalogo: [] })).map((x) => x.campo)).not.toContain("trabalhadores");
    expect(pendenciasDaGuia(fgts, ctx({ catalogo: [], emEdicao: true })).map((x) => x.campo)).not.toContain("trabalhadores");
    expect(payloadDaGuia({ ...fgts, workersCount: "12" }, false, false, false).workersCount).toBe(12);
    expect(payloadDaGuia({ ...guiaDas(), workersCount: "12" }, false, false, false).workersCount).toBeNull();
  });

  test("FGTS com verba de rescisão pede o funcionário desligado (só quem pode vincular); mensal não", () => {
    const base = { ...FORM_VAZIO, documentType: "FGTS", mes: "2026-07", dueDate: "2026-08-20", documentNumber: "123", workersCount: "1" };
    const rescisao = { ...base, linhas: [novaLinha({ description: "FGTS Rescisório", principal: "900,00" })] };
    const mensal = { ...base, linhas: [novaLinha({ description: "FGTS Mensal", principal: "900,00" })] };
    const c = ctx({ catalogo: [], podeVincularFuncionario: true });
    expect(pendenciasDaGuia(rescisao, c).map((x) => x.campo)).toContain("funcionario");
    expect(pendenciasDaGuia({ ...rescisao, employeeId: "e1" }, c).map((x) => x.campo)).not.toContain("funcionario");
    expect(pendenciasDaGuia(mensal, c).map((x) => x.campo)).not.toContain("funcionario");
    expect(pendenciasDaGuia(rescisao, ctx({ catalogo: [] })).map((x) => x.campo)).not.toContain("funcionario");
    expect(pendenciasDaGuia(rescisao, { ...c, emEdicao: true }).map((x) => x.campo)).not.toContain("funcionario");
    expect(temVerbaDeRescisao(rescisao)).toBe(true);
    expect(temVerbaDeRescisao({ ...rescisao, linhas: [novaLinha({ description: "FGTS Rescisório" })] })).toBe(false);
  });

  test("o funcionário só vai no payload do FGTS", () => {
    const fgts = { ...FORM_VAZIO, documentType: "FGTS", mes: "2026-07", dueDate: "2026-08-20", employeeId: "e1", linhas: [novaLinha({ description: "FGTS Rescisório", principal: "10,00" })] };
    expect(payloadDaGuia(fgts, false, false, false).employeeId).toBe("e1");
    expect(payloadDaGuia({ ...guiaDas(), employeeId: "e1" }, false, false, false).employeeId).toBeNull();
    expect(payloadDaGuia({ ...fgts, employeeId: "" }, false, false, false).employeeId).toBeNull();
  });

  test("sem competência não lança: a pendência diz por quê", () => {
    const p = pendenciasDaGuia({ ...guiaCompleta(), mes: "" }, ctx());
    expect(p).toHaveLength(1);
    expect(p[0].campo).toBe("competencia");
    expect(p[0].texto).toMatch(/Sem ela a guia fica fora do DRE e não pode ser lançada/);
  });

  test("lista tudo o que falta, na ordem do formulário", () => {
    const p = pendenciasDaGuia({ ...FORM_VAZIO, linhas: [novaLinha()] }, ctx({ exigeEmpresa: true }));
    expect(p.map((x) => x.campo)).toEqual(["tipo", "empresa", "vencimento", "competencia", "linhas"]);
  });

  test("DAS, FGTS e DARF exigem o número do documento (ou o identificador); outros tipos não", () => {
    expect(pendenciasDaGuia({ ...guiaDas(), companyId: "e", dreCategoryId: "c" }, ctx()).map((x) => x.campo)).toContain("numero");
    const fgts = pendenciasDaGuia({ ...FORM_VAZIO, documentType: "FGTS", mes: "2026-07", dueDate: "2026-08-20", linhas: [novaLinha({ description: "FGTS Mensal", principal: "10,00" })] }, ctx());
    expect(fgts.find((x) => x.campo === "numero")?.texto).toMatch(/identificador/);
    const iptu = pendenciasDaGuia({ ...FORM_VAZIO, documentType: "IPTU", mes: "2026-01", dueDate: "2026-02-10", linhas: [novaLinha({ description: "IPTU", principal: "10,00" })] }, ctx({ catalogo: [] }));
    expect(iptu.map((x) => x.campo)).not.toContain("numero");
  });

  test("número já usado por outra guia é pendência", () => {
    const p = pendenciasDaGuia(guiaCompleta(), ctx({ numeroRepetido: "07.20.26290.7165263-2" }));
    expect(p[0].texto).toMatch(/Já existe a guia nº 07\.20\.26290\.7165263-2/);
  });

  test("categoria: só é pendência quando o tipo e as linhas não têm categoria automática", () => {
    expect(pendenciasDaGuia({ ...guiaCompleta(), dreCategoryId: "" }, ctx({ exigeCategoria: false })).map((x) => x.campo)).not.toContain("categoria");
    expect(pendenciasDaGuia({ ...guiaCompleta(), dreCategoryId: "" }, ctx({ exigeCategoria: true })).map((x) => x.campo)).toContain("categoria");
    expect(pendenciasDaGuia(guiaCompleta(), ctx({ exigeCategoria: true }))).toEqual([]);
  });

  test("linha com valor e sem código nem denominação pede o código (a denominação vem dele)", () => {
    const sem = novaLinha({ principal: "10,00" });
    const p = pendenciasDaGuia({ ...guiaCompleta(), linhas: [...guiaCompleta().linhas, sem] }, ctx());
    expect(p).toHaveLength(1);
    expect(p[0].campo).toBe(`linha:${sem.chave}`);
    expect(p[0].texto).toMatch(/informe o código/);
  });

  test("código novo (fora do catálogo) sem denominação pede a denominação", () => {
    const nova = novaLinha({ code: "9999", principal: "10,00" });
    const p = pendenciasDaGuia({ ...guiaCompleta(), linhas: [...guiaCompleta().linhas, nova] }, ctx());
    expect(p[0].texto).toMatch(/informe a denominação do código 9999/);
  });

  test("tipo sem catálogo (IPTU, ISS): a denominação é digitada", () => {
    const l = novaLinha({ principal: "10,00" });
    const p = pendenciasDaGuia({ ...FORM_VAZIO, documentType: "IPTU", mes: "2026-01", dueDate: "2026-02-10", linhas: [l] }, ctx({ catalogo: [] }));
    expect(p.find((x) => x.campo === `linha:${l.chave}`)?.texto).toMatch(/informe a denominação\./);
  });

  test("total do papel diferente da soma é pendência e diz quanto", () => {
    const p = pendenciasDaGuia({ ...guiaCompleta(), totalDoPapel: "7.700,00" }, ctx());
    expect(p).toHaveLength(1);
    expect(p[0].campo).toBe("papel");
    expect(p[0].texto).toMatch(/difere do total do papel em R\$\s?40,11/);
  });

  test("guia cancelada dispensa a competência", () => {
    expect(pendenciasDaGuia({ ...guiaCompleta(), mes: "", cancelada: true }, ctx({ emEdicao: true })).map((x) => x.campo)).not.toContain("competencia");
  });

  test("guia paga (valores fixos) não confere as linhas; edição não exige empresa, número nem categoria", () => {
    const f = { ...FORM_VAZIO, documentType: "Simples Nacional / DAS", mes: "2026-09", dueDate: "2026-10-20", linhas: [novaLinha()] };
    expect(pendenciasDaGuia(f, ctx({ emEdicao: true, valoresFixos: true, exigeEmpresa: true, exigeCategoria: true }))).toEqual([]);
  });
});

describe("denominação travada pelo código (o sistema guarda os códigos)", () => {
  test("o código traz a denominação do catálogo", () => {
    expect(descricaoDoCodigo(CATALOGO_DAS, "1001")).toBe("IRPJ - SIMPLES NACIONAL");
    expect(descricaoDoCodigo(CATALOGO_DAS, " 1006 ")).toBe("INSS - SIMPLES NACIONAL");
    expect(descricaoDoCodigo(CATALOGO_DAS, "9999")).toBeNull();
    expect(descricaoDoCodigo(CATALOGO_DAS, "")).toBeNull();
  });

  test("linha do modelo: travada", () => {
    const [l] = linhasDoModelo("Simples Nacional / DAS");
    expect(estadoDaDenominacao(l, "Simples Nacional / DAS", CATALOGO_DAS)).toBe("travada");
  });

  test("linha em branco de tipo com catálogo: espera o código", () => {
    expect(estadoDaDenominacao(novaLinha(), "Simples Nacional / DAS", CATALOGO_DAS)).toBe("aguardaCodigo");
  });

  test("código conhecido: travada; código novo: livre (a pessoa informa e o sistema guarda)", () => {
    expect(estadoDaDenominacao(novaLinha({ code: "1002" }), "Simples Nacional / DAS", CATALOGO_DAS)).toBe("travada");
    expect(estadoDaDenominacao(novaLinha({ code: "9999" }), "Simples Nacional / DAS", CATALOGO_DAS)).toBe("livre");
  });

  test("tipo sem catálogo nem códigos no modelo (IPTU, ISS) é livre", () => {
    expect(tipoSemCatalogo("IPTU", [])).toBe(true);
    expect(estadoDaDenominacao(novaLinha(), "IPTU", [])).toBe("livre");
  });

  test("FGTS não tem códigos: as colunas do modelo travam, linha extra é livre", () => {
    const [mensal] = linhasDoModelo("FGTS");
    expect(estadoDaDenominacao(mensal, "FGTS", [])).toBe("travada");
    expect(estadoDaDenominacao(novaLinha(), "FGTS", [])).toBe("livre");
  });
});

describe("payloadDaGuia", () => {
  test("criação: linhas em números, competência no dia 1, sem valor total e sem status", () => {
    const p = payloadDaGuia({ ...guiaDas(), documentNumber: " 07.20.26290.7165263-2 " }, false, false, false);
    expect(p.competenceDate).toBe("2026-09-01");
    expect(p.documentNumber).toBe("07.20.26290.7165263-2");
    expect(p.items).toHaveLength(6);
    expect(p.items?.[0]).toEqual({ code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: 469.71, fine: 0, interest: 0 });
    expect("amount" in p).toBe(false);
    expect("status" in p).toBe(false);
    expect("paymentDate" in p).toBe(false);
  });

  test("linhas em branco do modelo não vão", () => {
    const f: FormGuia = { ...FORM_VAZIO, documentType: "FGTS", mes: "2026-07", dueDate: "2026-08-20", linhas: linhasDoModelo("FGTS") };
    f.linhas[0] = { ...f.linhas[0], principal: "1.383,57" };
    const p = payloadDaGuia(f, false, false, false);
    expect(p.items).toEqual([{ code: null, description: "FGTS Mensal", principal: 1383.57, fine: 0, interest: 0 }]);
  });

  test("multa e juros vão na mesma linha", () => {
    const f = { ...guiaDas(), linhas: [novaLinha({ code: "1001", description: "IRPJ", principal: "100,00", fine: "2,00", interest: "1,50" })] };
    expect(payloadDaGuia(f, false, false, false).items?.[0]).toMatchObject({ principal: 100, fine: 2, interest: 1.5 });
  });

  test("edição: só ativa/cancelada e as linhas", () => {
    const p = payloadDaGuia(guiaDas(), true, false, false);
    expect(p.status).toBe("PENDING");
    expect(p.items).toHaveLength(6);
    expect(payloadDaGuia({ ...guiaDas(), cancelada: true }, true, false, false).status).toBe("CANCELED");
  });

  test("guia paga não envia valores: para mudá-los, estornar em Contas a Pagar", () => {
    const p = payloadDaGuia(guiaDas(), true, false, true);
    expect("items" in p).toBe(false);
    expect("amount" in p).toBe(false);
  });

  test("categoria: sem escolha vai undefined (servidor sugere); escolhida vazia vai null", () => {
    expect(payloadDaGuia(guiaDas(), false, false, false).dreCategoryId).toBeUndefined();
    expect(payloadDaGuia(guiaDas(), false, true, false).dreCategoryId).toBeNull();
    expect(payloadDaGuia({ ...guiaDas(), dreCategoryId: "c1" }, false, true, false).dreCategoryId).toBe("c1");
  });

  test("a categoria só sugerida pela tela não vai: salvar logo depois de trocar as linhas não leva a categoria antiga", () => {
    // O formulário guarda a sugestão em dreCategoryId, mas sem categoriaEscolhida o servidor recalcula pelas linhas finais.
    expect(payloadDaGuia({ ...guiaDas(), dreCategoryId: "cat-inss-sugerida" }, false, false, false).dreCategoryId).toBeUndefined();
  });
});

describe("formDaGuia e duplicar", () => {
  const detalhe = {
    documentType: "GPS / INSS", description: "GPS", competenceDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-10-20T00:00:00.000Z", amount: "2100.00",
    documentNumber: "A-1", companyId: null, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: null, dreCategoryId: "c1",
    paymentDate: null, paidAmount: null, comments: null, status: "PENDING",
    items: [
      { id: "i1", position: 0, code: "1082", description: "CONTR PREV", principal: "2000.00", fine: "50.00", interest: "0.00" },
      { id: "i2", position: 1, code: null, description: "OUTRA", principal: "50.00", fine: "0.00", interest: "0.00" },
    ],
  } as unknown as TaxPaymentDetail;

  test("lê as linhas da guia com multa e juros só quando existem", () => {
    const f = formDaGuia(detalhe);
    expect(f.mes).toBe("2026-09");
    expect(f.dueDate).toBe("2026-10-20");
    expect(f.documentNumber).toBe("A-1");
    expect(f.linhas.map((l) => [l.code, l.principal, l.fine])).toEqual([["1082", "2.000,00", "50,00"], ["", "50,00", ""]]);
    expect(totalDaGuia(f.linhas)).toBe(2100);
  });

  test("guia antiga, sem linhas, vira uma linha com o valor da guia", () => {
    const f = formDaGuia({ ...detalhe, items: [] } as unknown as TaxPaymentDetail);
    expect(f.linhas).toHaveLength(1);
    expect(f.linhas[0]).toMatchObject({ description: "GPS", principal: "2.100,00" });
  });

  test("descrição longa de guia importada é cortada para caber na denominação (200)", () => {
    const f = formDaGuia({ ...detalhe, items: [], description: "x".repeat(300) } as unknown as TaxPaymentDetail);
    expect(f.linhas[0].description).toHaveLength(200);
  });

  test("duplicar limpa o que muda a cada emissão, inclusive o número do documento, e mantém as linhas", () => {
    const f = formDuplicado(detalhe);
    expect(f).toMatchObject({ mes: "", dueDate: "", documentNumber: "", cancelada: false });
    expect(f.documentType).toBe("GPS / INSS");
    expect(f.linhas).toHaveLength(2);
  });
});

describe("mesSugerido", () => {
  test("mês anterior ao vencimento, só para tipos que seguem a regra", () => {
    expect(mesSugerido("FGTS", "2026-10-07")).toBe("2026-09");
    expect(mesSugerido("IPTU", "2026-10-07")).toBe("");
    expect(mesSugerido("FGTS", "")).toBe("");
  });
});

describe("conferência com o total impresso no papel", () => {
  test("sem total do papel não há diferença a conferir", () => {
    expect(diferencaComOPapel(guiaDas())).toBeNull();
  });

  test("total do papel igual à soma das linhas: diferença zero", () => {
    expect(diferencaComOPapel({ ...guiaDas(), totalDoPapel: "7.740,11" })).toBe(0);
  });

  test("diferença em reais, sem erro de ponto flutuante", () => {
    expect(diferencaComOPapel({ ...guiaDas(), totalDoPapel: "7.740,10" })).toBe(0.01);
    expect(diferencaComOPapel({ ...guiaDas(), totalDoPapel: "8.000,00" })).toBe(-259.89);
  });

});

describe("valorColado", () => {
  test.each([
    ["1.234,56", "1.234,56"],
    ["1234,56", "1.234,56"],
    ["R$ 469,71", "469,71"],
    ["1.234", "1.234,00"],
    ["12,5", "12,50"],
    ["469.71", "469,71"],
  ])("%s vira %s", (colado, esperado) => {
    expect(valorColado(colado)).toBe(esperado);
  });

  test("texto sem número ou zerado vira vazio", () => {
    expect(valorColado("abc")).toBe("");
    expect(valorColado("0,00")).toBe("");
  });
});

describe("chaveDoNumero e tipoDoGrupo", () => {
  test("o número de documento é comparado só por letras e dígitos, sem caixa", () => {
    expect(chaveDoNumero("07.20.26290.7165263-2")).toBe("07202629071652632");
    expect(chaveDoNumero("ab-1.c")).toBe("AB1C");
  });

  test("grupo do DRE vira o tipo de guia a lançar", () => {
    expect(tipoDoGrupo("Simples Nacional")).toBe("Simples Nacional / DAS");
    expect(tipoDoGrupo("FGTS")).toBe("FGTS");
    expect(tipoDoGrupo("IRRF / DARF")).toBe("DARF");
    expect(tipoDoGrupo("Grupo qualquer")).toBeNull();
  });
});
