import { describe, expect, test } from "vitest";
import type { FichaRegistro } from "../ficha-registro-parser.js";
import { type CadastroAtual, type FeriasRow, planoDaFicha, quebrarEndereco, resumoFerias } from "../ficha-registro.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Pessoa fictícia.
const ficha = (over: Partial<FichaRegistro> = {}): FichaRegistro => ({
  registro: "000020", matriculaEsocial: "20", empregador: { nome: "EMPRESA TESTE LTDA", cnpj: "11.222.333/0001-81" },
  nome: "FULANA DE TAL", beneficiarios: ["CICLANO DE TAL"],
  endereco: "Rua DAS FLORES, 10, apto 5, JARDIM TESTE, SAO PAULO, SP", cep: "01000-000",
  dataNascimento: "1990-03-10", naturalidade: null, nacionalidade: "BRASIL", estadoCivil: "Solteiro",
  pai: "JOSE DE TAL", mae: "MARIA DE TAL",
  rg: "12.345.678-9", rgEmissao: "2016-01-15", rgOrgao: "SSP/SP", tituloEleitor: "123456789012", tituloZona: "001", tituloSecao: "0002",
  ctpsNumero: "5299822", ctpsSerie: "4725", ctpsEmissao: null, ctpsUf: "SP", cpf: "529.982.247-25",
  racaCor: "Parda", sexo: "Feminino", escolaridade: "Ensino Médio Completo", possuiDeficiencia: false,
  cargoAdmissao: "COZINHEIRO (A)", cboAdmissao: "513205", dataAdmissao: "2025-03-01", salarioAdmissao: 2000,
  jornada: { inicio: "08:00", fim: "16:20", intervaloInicio: "12:00", intervaloFim: "13:00" },
  fgtsOpcao: "2025-03-01", pis: "123.45678.90-1",
  salarios: [{ vigencia: "2026-05-01", valor: 2600, retroativoCompetencia: null }],
  cargos: [{ data: "2026-05-01", deCbo: "513205", deCargo: "COZINHEIRO (A)", paraCbo: "513210", paraCargo: "LIDER DE PRACA" }],
  ferias: [{ aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", gozoInicio: "2026-07-01", gozoFim: "2026-07-30", abonoInicio: null, abonoFim: null }],
  ...over,
});

const VAZIO = {
  nomeCompleto: null, registroNumero: null, matriculaEsocial: null, nomeMae: null, nomePai: null, estadoCivil: null, nacionalidade: null, naturalidade: null,
  racaCor: null, escolaridade: null, possuiDeficiencia: null, rgDataEmissao: null, rgOrgaoEmissor: null,
  tituloEleitor: null, tituloZona: null, tituloSecao: null, ctpsNumero: null, ctpsSerie: null, ctpsUf: null, ctpsDataEmissao: null,
  cbo: null, jornadaInicio: null, jornadaFim: null, intervaloInicio: null, intervaloFim: null, fgtsDataOpcao: null,
  rg: null, pis: null, birthDate: null, gender: "NAO_INFORMADO",
  zipCode: null, address: null, addressNumber: null, addressComplement: null, neighborhood: null, city: null, state: null,
};
const cadastro = (over: Partial<CadastroAtual> = {}): CadastroAtual => ({
  ...VAZIO, id: "e1", firstName: "Fulana", lastName: "de Tal",
  position: "Lider de Praca", baseSalary: "2600", admissaoCarteira: d("2025-03-01"),
  company: { cnpj: "11.222.333/0001-81" }, ...over,
});

describe("planoDaFicha", () => {
  test("cadastro vazio: preenche documentos, filiação, contrato, endereço quebrado, PIS só com dígitos e sexo", () => {
    const p = planoDaFicha(cadastro(), ficha());
    expect(p.dados).toMatchObject({
      nomeCompleto: "Fulana de Tal", registroNumero: "000020", matriculaEsocial: "20", nomePai: "Jose de Tal", nomeMae: "Maria de Tal",
      rgDataEmissao: d("2016-01-15"), rgOrgaoEmissor: "SSP/SP", ctpsNumero: "5299822", ctpsUf: "SP",
      cbo: "513210", jornadaInicio: "08:00", intervaloFim: "13:00", possuiDeficiencia: false, fgtsDataOpcao: d("2025-03-01"),
      rg: "12.345.678-9", pis: "12345678901", birthDate: d("1990-03-10"), gender: "FEMININO",
      address: "Rua das Flores", addressNumber: "10", addressComplement: "Apto 5", neighborhood: "Jardim Teste", city: "São Paulo", state: "SP", zipCode: "01000-000",
    });
    expect(p.dados).not.toHaveProperty("ctpsDataEmissao");
    expect(p.avisos).toEqual([]);
  });

  test("valor já gravado e diferente não é trocado: vira aviso", () => {
    const p = planoDaFicha(cadastro({ gender: "MASCULINO", rg: "99.999.999-9", nomeMae: "OUTRA", birthDate: d("1990-03-11") }), ficha());
    expect(p.dados).not.toHaveProperty("gender");
    expect(p.dados).not.toHaveProperty("rg");
    expect(p.dados).not.toHaveProperty("nomeMae");
    expect(p.dados).not.toHaveProperty("birthDate");
    expect(p.avisos.join("\n")).toMatch(/sexo: cadastro MASCULINO × ficha FEMININO/);
    expect(p.avisos.join("\n")).toMatch(/RG: cadastro/);
    expect(p.avisos.join("\n")).toMatch(/nomeMae: cadastro "OUTRA"/);
    expect(p.avisos.join("\n")).toMatch(/nascimento: cadastro 1990-03-11/);
  });

  test("RG igual com outra pontuação não é divergência", () => {
    const p = planoDaFicha(cadastro({ rg: "123456789" }), ficha());
    expect(p.avisos).toEqual([]);
  });

  test("dependente no lugar de pai/mãe e RG emitido antes do nascimento: campo não entra e vira aviso", () => {
    const p = planoDaFicha(cadastro(), ficha({ pai: "CICLANO DE TAL", rgEmissao: "1989-01-01" }));
    expect(p.dados).not.toHaveProperty("nomePai");
    expect(p.dados).not.toHaveProperty("rgDataEmissao");
    expect(p.dados).toHaveProperty("nomeMae", "Maria de Tal");
    expect(p.avisos.join("\n")).toMatch(/dependente "CICLANO DE TAL" como pai/);
    expect(p.avisos.join("\n")).toMatch(/antes do nascimento/);
  });

  test("reimportar a mesma ficha: nada a preencher e nenhum aviso", () => {
    const primeira = planoDaFicha(cadastro(), ficha());
    const depois = cadastro({ ...(primeira.dados as Partial<CadastroAtual>) });
    const p = planoDaFicha(depois, ficha());
    expect(p.dados).toEqual({});
    expect(p.avisos).toEqual([]);
  });

  test("endereço só entra inteiro: com qualquer parte já gravada, nada é trocado", () => {
    const p = planoDaFicha(cadastro({ city: "OSASCO" }), ficha());
    expect(p.dados).not.toHaveProperty("address");
    expect(p.dados).not.toHaveProperty("zipCode");
    expect(p.avisos).toContain("endereço do cadastro diferente do da ficha: mantido o do cadastro");
  });

  test("salário, cargo, admissão e empresa nunca entram nos dados; divergência é listada", () => {
    const p = planoDaFicha(cadastro({ baseSalary: "2500", position: "Cozinheira", admissaoCarteira: null, company: null }), ficha({ matriculaEsocial: "1333333" }));
    for (const campo of ["baseSalary", "position", "admissaoCarteira", "companyId"]) expect(p.dados).not.toHaveProperty(campo);
    const avisos = p.avisos.join("\n");
    expect(avisos).toMatch(/salário: cadastro 2500.00 × ficha 2600.00/);
    expect(avisos).toMatch(/cargo: cadastro "Cozinheira" × ficha "LIDER DE PRACA"/);
    expect(avisos).toMatch(/admissão em carteira: cadastro vazio/);
    expect(avisos).toMatch(/empresa: cadastro sem empresa/);
    expect(avisos).toMatch(/matrícula eSocial "1333333"/);
  });

  test("carteira: admissão, salários e cargos em ordem de data; dependentes e férias da ficha", () => {
    const p = planoDaFicha(cadastro(), ficha());
    expect(p.anotacoes.map((a) => [a.tipo, a.data.toISOString().slice(0, 10)])).toEqual([
      ["ADMISSAO", "2025-03-01"], ["SALARIO", "2026-05-01"], ["CARGO", "2026-05-01"],
    ]);
    expect(p.anotacoes[0]).toMatchObject({ salario: 2000, cargo: "Cozinheiro (a)", cbo: "513205" });
    expect(p.anotacoes[2]).toMatchObject({ cargoAnterior: "Cozinheiro (a)", cargo: "Lider de Praca", cbo: "513210" });
    expect(p.dependentes).toEqual(["Ciclano de Tal"]);
    expect(p.ferias[0]).toMatchObject({ aquisitivoInicio: d("2025-03-01"), gozoFim: d("2026-07-30"), abonoInicio: null });
  });
});

describe("quebrarEndereco", () => {
  test("5 partes: sem complemento; formato estranho fica inteiro no logradouro", () => {
    expect(quebrarEndereco("Rua UM, 1, CENTRO, SAO PAULO, SP")).toEqual({
      address: "Rua Um", addressNumber: "1", addressComplement: null, neighborhood: "Centro", city: "São Paulo", state: "SP",
    });
    expect(quebrarEndereco("Rua UM 1 CENTRO")).toMatchObject({ address: "Rua Um 1 Centro", city: null });
  });
});

describe("resumoFerias", () => {
  const linha = (aq: string, aqFim: string, gozo?: [string, string], abono?: [string, string]): FeriasRow => ({
    aquisitivoInicio: d(aq), aquisitivoFim: d(aqFim),
    gozoInicio: gozo ? d(gozo[0]) : null, gozoFim: gozo ? d(gozo[1]) : null,
    abonoInicio: abono ? d(abono[0]) : null, abonoFim: abono ? d(abono[1]) : null,
  });

  test("20 de gozo + 10 de abono quitam; gozo partido em três soma; sem registro e prazo passado: vencido", () => {
    const r = resumoFerias(d("2014-11-01"), null, [
      linha("2014-11-01", "2015-10-31", ["2016-04-16", "2016-05-05"], ["2016-05-06", "2016-05-15"]),
      linha("2015-11-01", "2016-10-31", ["2017-01-26", "2017-02-14"]),
      linha("2015-11-01", "2016-10-31", ["2017-08-17", "2017-08-21"]),
      linha("2015-11-01", "2016-10-31", ["2018-02-01", "2018-02-05"]),
    ], d("2018-03-01"));
    expect(r.map((p) => [p.aquisitivoInicio, p.diasGozados, p.diasAbono, p.status])).toEqual([
      ["2014-11-01", 20, 10, "QUITADO"],
      ["2015-11-01", 30, 0, "QUITADO"],
      ["2016-11-01", 0, 0, "A_GOZAR"],
      ["2017-11-01", 0, 0, "EM_AQUISICAO"],
    ]);
    expect(r[2].concessivoFim).toBe("2018-10-31");
    expect(resumoFerias(d("2014-11-01"), null, [], d("2018-11-01"))[2].status).toBe("PRAZO_VENCIDO");
  });

  test("admissão em 29/02 e período com 00/00 (sem gozo) ainda dentro do prazo", () => {
    const r = resumoFerias(d("2008-02-29"), null, [], d("2009-06-01"));
    expect(r[0]).toMatchObject({ aquisitivoInicio: "2008-02-29", aquisitivoFim: "2009-02-27", status: "A_GOZAR" });
    expect(r[1]).toMatchObject({ aquisitivoInicio: "2009-02-28", status: "EM_AQUISICAO" });
  });

  test("admissão do cadastro um dia diferente da ficha: não duplica o ano com um período vazio 'vencido'", () => {
    const r = resumoFerias(d("2007-03-02"), null, [
      linha("2007-03-01", "2008-02-29", ["2009-01-05", "2009-02-03"]),
      linha("2008-03-01", "2009-02-28", ["2010-01-05", "2010-02-03"]),
    ], d("2010-06-01"));
    expect(r.map((p) => [p.aquisitivoInicio, p.status])).toEqual([
      ["2007-03-01", "QUITADO"], ["2008-03-01", "QUITADO"], ["2009-03-02", "A_GOZAR"], ["2010-03-02", "EM_AQUISICAO"],
    ]);
  });

  test("admissão em 29/02: cada aniversário conta da admissão, sem deriva para 28/02", () => {
    const r = resumoFerias(d("2020-02-29"), null, [], d("2024-03-10"));
    expect(r.map((p) => p.aquisitivoInicio)).toEqual(["2020-02-29", "2021-02-28", "2022-02-28", "2023-02-28", "2024-02-29"]);
  });

  test("quem saiu: período sem os 30 dias fica com o acerto da rescisão; não conta depois da saída", () => {
    const r = resumoFerias(d("2024-09-01"), d("2026-08-01"), [linha("2024-09-01", "2025-08-31", ["2025-12-31", "2026-01-29"])], d("2026-10-01"));
    expect(r.map((p) => p.status)).toEqual(["QUITADO", "CONTRATO_ENCERRADO"]);
  });
});
