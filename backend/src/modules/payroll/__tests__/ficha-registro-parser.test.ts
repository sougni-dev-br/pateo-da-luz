import { describe, expect, test } from "vitest";
import { isoDeBr, lerFichasRegistro } from "../ficha-registro-parser.js";

// Texto no formato do `pdftotext -layout` da ficha da contabilidade. Pessoas e documentos
// fictícios (o CPF é um número de teste válido).
const FICHA_CURTA = `
                  Autenticar                                REGISTRO DE EMPREGADO                                   Nº
                                            Matrícula eSocial                                                     000020
                                             20
                                            Empregador                                                     CNPJ
                                              EMPRESA TESTE LTDA                                         11.222.333/0001-81
Empregado                                                                          Beneficiários
 FULANA DE TAL                                                                     CICLANO DE TAL , BELTRANO DE TAL
Residência
 Rua DAS FLORES, 10, apto 5, JARDIM TESTE, SAO PAULO, SP, - CEP:
 01000-000
                              Data de nascimento          Local do nascimento                     Pais da nacionalidade          Estado civil
                               10/03/1990                 BRASIL                          Solteiro
                              FILIAÇÃO                       Pai
                                                  JOSE DE TAL
                                                  Mãe
                                                  MARIA DE TAL
                              Cédula de Identidade        Data de emissão          Órgão/UF emissor  Título Eleitoral             Zona                   Seção
                              Categoria
                              12.345.678-9               15/01/2016                SSP/SP            123456789012                 001 0002
                              CTPS          Série                    Data de expedição da CTPS UF CTPS CPF                        Cart. Nac. Habilitação
                              5299822       4725                     SP 529.982.247-25
                              Doc. militar                Categoria         Cor                              Sexo                 Grau de instrução
                                                                            Parda                            Feminino             Ensino Médio Completo
                              Deficiência                                                  Telefone Residencial                                Telefone Celular
                               Não
                              Cargo                                                                  Função                                                                  C.B.O.
                              COZINHEIRO (A)                                                                                                                   513205
Data de Admissão              Salário                                  Por         Horário de Trabalho                            Horário de Intervalo
01/03/2025                     R$                2.000,00 Mês                      das 08:00 as 16:20                             das 12:00 as 13:00
               Opção em                     Conta vinculada no banco                                                                              Data da Retificação
FGTS            01/03/2025
Cadastrado em     Sob nº                                                                     PROGRAMA DE INTEGRAÇÃO SOCIAL - PIS
                   123.45678.90-1
Em 01/04/2026 R$ 2.100,00 por mês retroativo a competência 02/2026  01/06/2026 - Cargo: 513205 COZINHEIRO (A)
Em 01/06/2026 R$ 2.600,00 por mês                                    Para: 513210 LIDER DE PRACA
FÉRIAS - PERÍODO AQUISITIVO FÉRIAS - PERÍODO DE GOZO FÉRIAS - PERÍODO ABONO PECUNIÁRIO
De 01/03/2025 a 28/02/2026 De 01/07/2026 a 20/07/2026 De 21/07/2026 a 30/07/2026
                  ACIDENTES DE TRABALHO
`;

const FICHA_LONGA = `
                  Autenticar                                REGISTRO DE EMPREGADO                                   Nº
                                            Matrícula eSocial                                                     001500
                                             1500
                                            Empregador                                                     CNPJ
                                              EMPRESA TESTE LTDA                                         11.222.333/0001-81
Empregado                                                                          Beneficiários
 FULANO ANTIGO
Residência
 Rua UM, 1, CENTRO, SAO PAULO, SP, - CEP: 01001-000
                              Data de nascimento          Local do nascimento                     Pais da nacionalidade          Estado civil
                               01/01/1980                 SAO PAULO - SP                  BRASIL                          Casado
                                                     Pai
                              FILIAÇÃO
                                                  Mãe
                                                  ANA ANTIGA
                              Cédula de Identidade        Data de emissão          Órgão/UF emissor  Título Eleitoral
                              1234567                                               SSP
                              CTPS          Série                    Data de expedição da CTPS UF CTPS CPF                        Cart. Nac. Habilitação  Categoria
                              01234         00456                    10/10/2000                SP 111.444.777-35
                              Doc. militar                Categoria         Cor                              Sexo                 Grau de instrução
                                                                            Não Informada                     Masculino           Ensino Médio Completo
                              Deficiência
                               Não
                              Cargo                                                                  Função                                                                  C.B.O.
                              SUPERVISOR DE TURNO                                                                                                                   141515
Data de Admissão              Salário                                  Por         Horário de Trabalho                            Horário de Intervalo
01/11/2014                     R$                2.400,00 Mês                      das 15:00 as 00:00                             das 19:00 as 20:00
FGTS            01/11/2014
                   100.00000.00-1
Em 01/05/2015 R$ 2.600,00 por mês                                    ALTERAÇÕES DE SALÁRIO, CARGO E/OU FUNÇÃO
                                                                                                         01/09/2019 - Cargo: 141515 SUPERVISOR DE TURNO
                                                                                                         Para: 141510 COORDENADOR
De 01/11/2014 a 31/10/2015 De 16/04/2016 a 05/05/2016 De 06/05/2016 a 15/05/2016
De 01/11/2015 a 31/10/2016 De 00/00/0000 a 00/00/0000
REGISTRO DE EMPREGADO                                                                                                                      Nº: 001500
EMPRESA TESTE LTDA                                                                                                    CNPJ: 11.222.333/0001-81
FULANO ANTIGO
                                         ALTERAÇÕES SALARIAIS
01/05/2022 R$ 3.400,00 por mês                             01/06/2024 R$ 4.100,00 por mês
                                                                         FÉRIAS
PERÍODO AQUISITIVO - PERÍODO GOZO - PERÍODO ABONO PECUNIÁRIO                     PERÍODO AQUISITIVO - PERÍODO GOZO - PERÍODO ABONO PECUNIÁRIO
01/11/2019 - 31/10/2020 10/01/2022 - 29/01/2022 30/01/2022 - 08/02/2022          01/11/2023 - 31/10/2024 16/07/2025 - 30/07/2025
`;

// Cabeçalho alternativo ("REGISTRO DE EMPREGADO" e "41  000041", sem o rótulo da matrícula).
const FICHA_CABECALHO_ALT = FICHA_CURTA.replace(
  /Matrícula eSocial\s+000020\n\s+20\n/,
  "  REGISTRO DE EMPREGADO\n  41  000041\n",
);

describe("lerFichasRegistro", () => {
  test("lê documentos, filiação, dependentes, contrato e endereço da ficha", () => {
    const [f] = lerFichasRegistro(FICHA_CURTA);
    expect(f).toMatchObject({
      registro: "000020", matriculaEsocial: "20", nome: "FULANA DE TAL",
      empregador: { nome: "EMPRESA TESTE LTDA", cnpj: "11.222.333/0001-81" },
      beneficiarios: ["CICLANO DE TAL", "BELTRANO DE TAL"],
      endereco: "Rua DAS FLORES, 10, apto 5, JARDIM TESTE, SAO PAULO, SP", cep: "01000-000",
      dataNascimento: "1990-03-10", naturalidade: null, nacionalidade: "BRASIL", estadoCivil: "Solteiro",
      pai: "JOSE DE TAL", mae: "MARIA DE TAL",
      rg: "12.345.678-9", rgEmissao: "2016-01-15", rgOrgao: "SSP/SP",
      tituloEleitor: "123456789012", tituloZona: "001", tituloSecao: "0002",
      ctpsNumero: "5299822", ctpsSerie: "4725", ctpsEmissao: null, ctpsUf: "SP", cpf: "529.982.247-25",
      racaCor: "Parda", sexo: "Feminino", escolaridade: "Ensino Médio Completo", possuiDeficiencia: false,
      cargoAdmissao: "COZINHEIRO (A)", cboAdmissao: "513205", dataAdmissao: "2025-03-01", salarioAdmissao: 2000,
      jornada: { inicio: "08:00", fim: "16:20", intervaloInicio: "12:00", intervaloFim: "13:00" },
      fgtsOpcao: "2025-03-01", pis: "123.45678.90-1",
    });
  });

  test("alterações de salário (com retroativo) e de cargo com o 'Para' na linha de baixo", () => {
    const [f] = lerFichasRegistro(FICHA_CURTA);
    expect(f.salarios).toEqual([
      { vigencia: "2026-04-01", valor: 2100, retroativoCompetencia: "02/2026" },
      { vigencia: "2026-06-01", valor: 2600, retroativoCompetencia: null },
    ]);
    expect(f.cargos).toEqual([{ data: "2026-06-01", deCbo: "513205", deCargo: "COZINHEIRO (A)", paraCbo: "513210", paraCargo: "LIDER DE PRACA" }]);
    expect(f.ferias).toEqual([{
      aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28",
      gozoInicio: "2026-07-01", gozoFim: "2026-07-20", abonoInicio: "2026-07-21", abonoFim: "2026-07-30",
    }]);
  });

  test("página de continuação soma salários e férias na mesma ficha; 00/00/0000 é sem data", () => {
    const fichas = lerFichasRegistro(FICHA_LONGA);
    expect(fichas).toHaveLength(1);
    const [f] = fichas;
    expect(f).toMatchObject({ registro: "001500", pai: null, mae: "ANA ANTIGA", naturalidade: "SAO PAULO - SP", estadoCivil: "Casado",
      racaCor: null, rg: "1234567", rgOrgao: "SSP", ctpsEmissao: "2000-10-10",
      jornada: { inicio: "15:00", fim: "00:00", intervaloInicio: "19:00", intervaloFim: "20:00" } });
    expect(f.salarios.map((s) => s.vigencia)).toEqual(["2015-05-01", "2022-05-01", "2024-06-01"]);
    expect(f.cargos[0]).toMatchObject({ paraCbo: "141510", paraCargo: "COORDENADOR" });
    expect(f.ferias).toHaveLength(4);
    expect(f.ferias[1]).toEqual({ aquisitivoInicio: "2015-11-01", aquisitivoFim: "2016-10-31", gozoInicio: null, gozoFim: null, abonoInicio: null, abonoFim: null });
    expect(f.ferias[2]).toMatchObject({ aquisitivoInicio: "2019-11-01", gozoInicio: "2022-01-10", abonoFim: "2022-02-08" });
    expect(f.ferias[3]).toMatchObject({ aquisitivoInicio: "2023-11-01", gozoInicio: "2025-07-16", gozoFim: "2025-07-30", abonoInicio: null });
  });

  test("várias fichas no mesmo arquivo e o cabeçalho alternativo da matrícula", () => {
    const fichas = lerFichasRegistro(FICHA_CABECALHO_ALT + FICHA_LONGA);
    expect(fichas.map((f) => [f.registro, f.matriculaEsocial])).toEqual([["000041", "41"], ["001500", "1500"]]);
  });

  test("isoDeBr: 00/00/0000 e data fora do calendário viram null", () => {
    expect(isoDeBr("29/02/2024")).toBe("2024-02-29");
    expect(isoDeBr("29/02/2023")).toBeNull();
    expect(isoDeBr("31/04/2026")).toBeNull();
    expect(isoDeBr("00/00/0000")).toBeNull();
    expect(isoDeBr("1/2/2026")).toBeNull();
  });

  test("nº de ficha repetido (duas empresas): a continuação vai para a ficha logo antes dela", () => {
    const outraEmpresaMesmoNumero = FICHA_CURTA.replace("000020", "001500").replace(/FULANA DE TAL/g, "BELTRANA DE TAL");
    const fichas = lerFichasRegistro(outraEmpresaMesmoNumero + FICHA_LONGA);
    expect(fichas.map((f) => f.nome)).toEqual(["BELTRANA DE TAL", "FULANO ANTIGO"]);
    expect(fichas[0].salarios.map((s) => s.vigencia)).toEqual(["2026-04-01", "2026-06-01"]);
    expect(fichas[1].salarios.map((s) => s.vigencia)).toEqual(["2015-05-01", "2022-05-01", "2024-06-01"]);
  });

  test("continuação com nome diferente da ficha anterior é erro, não mistura pessoas", () => {
    const trocada = FICHA_LONGA.replace(/\nFULANO ANTIGO\n(\s+ALTERAÇÕES SALARIAIS)/, "\nOUTRA PESSOA\n$1");
    expect(() => lerFichasRegistro(trocada)).toThrow(/é de "OUTRA PESSOA"/);
  });

  test("cargos em ordem de data mesmo com página fora de ordem: o atual é o mais recente", () => {
    const comCargoAntigoNoFim = FICHA_LONGA.replace(
      "                                         ALTERAÇÕES SALARIAIS",
      "01/01/2016 - Cargo: 141500 AUXILIAR Para: 141515 SUPERVISOR DE TURNO\n                                         ALTERAÇÕES SALARIAIS",
    );
    const [f] = lerFichasRegistro(comCargoAntigoNoFim);
    expect(f.cargos.map((c) => c.data)).toEqual(["2016-01-01", "2019-09-01"]);
    expect(f.cargos.at(-1)).toMatchObject({ paraCargo: "COORDENADOR" });
  });

  test("continuação sem a ficha principal antes é erro, não ficha órfã", () => {
    const soContinuacao = FICHA_LONGA.slice(FICHA_LONGA.indexOf("REGISTRO DE EMPREGADO  "));
    expect(() => lerFichasRegistro(soContinuacao)).toThrow(/sem a ficha principal/);
  });
});
