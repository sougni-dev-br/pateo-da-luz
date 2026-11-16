import { describe, expect, test } from "vitest";
import type { FichaRegistro } from "../ficha-registro-parser.js";
import type { CadastroAtual } from "../ficha-registro.js";
import { type ContextoFicha, montarPrevisao } from "../ficha-importacao.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Pessoa fictícia (a mesma dos testes de ficha-registro).
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
  salarios: [{ vigencia: "2026-11-01", valor: 2700, retroativoCompetencia: null }],
  cargos: [],
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
const cadastro = (over: Record<string, unknown> = {}): ContextoFicha["cadastro"] => ({
  ...(VAZIO as unknown as CadastroAtual), id: "e1", firstName: "Fulana", lastName: "de Tal",
  position: "Cozinheiro (a)", baseSalary: "2600", admissaoCarteira: d("2025-03-01"), admissionDate: d("2025-03-01"),
  terminationDate: null, isActive: true, company: { cnpj: "11.222.333/0001-81", tradeName: "Empresa Teste" }, ...over,
});
const contexto = (over: Partial<ContextoFicha> = {}): ContextoFicha => ({
  cadastro: cadastro(), empresas: new Map([["11.222.333/0001-81", { id: "c1", tradeName: "Empresa Teste" }]]),
  historicoSalario: [], historicoCadastro: [], listas: { dependentes: [], ferias: [], anotacoes: [] }, hoje: "2026-11-13", desde: null, ...over,
});
const ids = (p: ReturnType<typeof montarPrevisao>) => p.itens.map((i) => i.id);

describe("montarPrevisao", () => {
  test("campo vazio vira item de preenchimento, já marcado; endereço entra inteiro num item só", () => {
    const p = montarPrevisao(ficha(), contexto());
    const preenche = p.itens.filter((i) => i.tipo === "PREENCHE");
    expect(preenche.every((i) => i.padrao && i.bloqueio === null)).toBe(true);
    expect(ids(p)).toContain("preenche:cbo");
    expect(ids(p)).toContain("preenche:endereco");
    expect(ids(p).filter((i) => /address|city|zipCode/.test(i))).toEqual([]);
    expect(p.aplicacoes.get("preenche:endereco")).toMatchObject({ tipo: "DADOS", dados: { address: "Rua das Flores", city: "São Paulo" } });
  });

  test("valor diferente já gravado vira divergência desmarcada, com o valor da ficha pronto para gravar", () => {
    const p = montarPrevisao(ficha(), contexto({ cadastro: cadastro({ racaCor: "Branca" }) }));
    expect(p.itens.find((i) => i.id === "diverge:racaCor")).toMatchObject({ tipo: "DIVERGE", atual: "Branca", ficha: "Parda", padrao: false });
    expect(p.aplicacoes.get("diverge:racaCor")).toEqual({ tipo: "DADOS", dados: { racaCor: "Parda" } });
  });

  test("o que o usuário lê: data em dia/mês/ano, sim/não e sexo por extenso", () => {
    const p = montarPrevisao(ficha(), contexto());
    const por = (id: string) => p.itens.find((i) => i.id === id);
    expect(por("preenche:fgtsDataOpcao")?.ficha).toBe("01/03/2025");
    expect(por("preenche:possuiDeficiencia")?.ficha).toBe("Não");
    expect(por("preenche:gender")).toMatchObject({ atual: "Não informado", ficha: "Feminino" });
    expect(por("preenche:birthDate")?.ficha).toBe("10/03/1990");
  });

  test("erro evidente da ficha (filiação com nome de dependente) fica só como suspeito: não vira item", () => {
    const p = montarPrevisao(ficha({ pai: "CICLANO DE TAL" }), contexto());
    expect(ids(p)).not.toContain("preenche:nomePai");
    expect(ids(p)).not.toContain("diverge:nomePai");
    expect(p.suspeitos.join(" ")).toMatch(/dependente "CICLANO DE TAL" como pai/);
  });

  test("cargo diferente vira item com a vigência da mudança na ficha; mesmo cargo com outra caixa não", () => {
    const comMudanca = ficha({ cargos: [{ data: "2026-05-01", deCbo: "513205", deCargo: "COZINHEIRO (A)", paraCbo: "513210", paraCargo: "LIDER DE PRACA" }] });
    const p = montarPrevisao(comMudanca, contexto());
    expect(p.itens.find((i) => i.id === "cargo")).toMatchObject({ atual: "Cozinheiro (a)", ficha: "Lider de Praca" });
    expect(p.aplicacoes.get("cargo")).toEqual({ tipo: "CARGO", cargo: "Lider de Praca", vigencia: "2026-05-01" });
    expect(ids(montarPrevisao(ficha(), contexto({ cadastro: cadastro({ position: "cozinheiro (A)" }) })))).not.toContain("cargo");
  });

  test("cargo com vigência futura grava a partir de hoje", () => {
    const f = ficha({ cargos: [{ data: "2027-01-01", deCbo: "1", deCargo: "A", paraCbo: "2", paraCargo: "NOVO CARGO" }] });
    expect(montarPrevisao(f, contexto()).aplicacoes.get("cargo")).toMatchObject({ vigencia: "2026-11-13" });
  });

  test("cargo e empresa com mudança feita à mão valendo a partir da vigência da ficha: bloqueados", () => {
    const f = ficha({ cargos: [{ data: "2026-05-01", deCbo: "1", deCargo: "A", paraCbo: "2", paraCargo: "LIDER DE PRACA" }] });
    const aMao = [{ campo: "position", vigenteDesde: d("2026-06-01"), origem: "CADASTRO" }, { campo: "companyId", vigenteDesde: d("2026-11-13"), origem: "CADASTRO" }];
    const p = montarPrevisao(f, contexto({ historicoCadastro: aMao, cadastro: cadastro({ company: null }) }));
    expect(p.itens.find((i) => i.id === "cargo")?.bloqueio).toMatch(/mudança de cargo valendo desde 01\/06\/2026/);
    expect(p.itens.find((i) => i.id === "empresa")?.bloqueio).toMatch(/mudança de empresa/);
  });

  test("mudança de cargo anterior à da ficha, ou lançada por uma importação anterior da ficha, não bloqueia", () => {
    const f = ficha({ cargos: [{ data: "2026-05-01", deCbo: "1", deCargo: "A", paraCbo: "2", paraCargo: "LIDER DE PRACA" }] });
    const antes = [{ campo: "position", vigenteDesde: d("2026-01-01"), origem: "CADASTRO" }, { campo: "position", vigenteDesde: d("2026-05-01"), origem: "FICHA_REGISTRO" }];
    expect(montarPrevisao(f, contexto({ historicoCadastro: antes })).itens.find((i) => i.id === "cargo")?.bloqueio).toBeNull();
  });

  test("empresa diferente: item quando o CNPJ está cadastrado, bloqueado quando não está; igual não gera item", () => {
    const semEmpresa = contexto({ cadastro: cadastro({ company: null }) });
    expect(montarPrevisao(ficha(), semEmpresa).itens.find((i) => i.id === "empresa")).toMatchObject({ ficha: "Empresa Teste", bloqueio: null });
    expect(montarPrevisao(ficha(), { ...semEmpresa, empresas: new Map() }).itens.find((i) => i.id === "empresa")?.bloqueio).toMatch(/não está cadastrado/);
    expect(ids(montarPrevisao(ficha(), contexto()))).not.toContain("empresa");
  });

  test("salário: sem 'desde' não propõe; com 'desde' lista os degraus e aplica o último", () => {
    expect(ids(montarPrevisao(ficha(), contexto()))).not.toContain("salario");
    const p = montarPrevisao(ficha(), contexto({ desde: "2026-11-01" }));
    const item = p.itens.find((i) => i.id === "salario")!;
    expect(item.bloqueio).toBeNull();
    expect(item.detalhes[0]).toMatch(/desde 01\/11\/2026/);
    expect(p.aplicacoes.get("salario")).toMatchObject({ tipo: "SALARIO", passos: [{ vigencia: "2026-11-01", valor: 2700, antes: 2600 }] });
  });

  test("salário já igual ao da ficha não gera item", () => {
    expect(ids(montarPrevisao(ficha(), contexto({ desde: "2026-11-01", cadastro: cadastro({ baseSalary: "2700" }) })))).not.toContain("salario");
  });

  test("salário bloqueado: desligado, vigência futura e anterior à admissão", () => {
    const f = ficha();
    const bloqueio = (ctx: ContextoFicha) => montarPrevisao(f, ctx).itens.find((i) => i.id === "salario")?.bloqueio;
    expect(bloqueio(contexto({ desde: "2026-11-01", cadastro: cadastro({ terminationDate: d("2026-10-01") }) }))).toMatch(/desligado/);
    expect(bloqueio(contexto({ desde: "2026-11-01", hoje: "2026-10-20" }))).toMatch(/futura/);
    expect(bloqueio(contexto({ desde: "2026-11-01", cadastro: cadastro({ admissionDate: d("2026-12-01") }) }))).toMatch(/anterior à admissão/);
  });

  test("salário com mudança à mão no cadastro na janela: bloqueado e sem aplicação", () => {
    const linhas = [{ campo: "baseSalary" as const, valorAnterior: "2600.00", valorNovo: "2650.00", vigenteDesde: d("2026-11-01"), createdAt: new Date(), origem: "CADASTRO" }];
    const p = montarPrevisao(ficha(), contexto({ desde: "2026-11-01", historicoSalario: linhas }));
    expect(p.itens.find((i) => i.id === "salario")?.bloqueio).toMatch(/mudança de salário/);
    expect(p.aplicacoes.has("salario")).toBe(false);
  });

  test("listas: primeira importação vem marcada; trocar o que já existe vem desmarcado e mostra antes e depois", () => {
    const primeira = montarPrevisao(ficha(), contexto()).itens.find((i) => i.id === "listas")!;
    expect(primeira.padrao).toBe(true);
    expect(primeira.detalhes.join(" ")).toMatch(/Períodos de férias: 0 no cadastro → 1 na ficha/);
    const jaTem = contexto({ listas: { dependentes: ["Alguém"], ferias: [], anotacoes: [] } });
    const troca = montarPrevisao(ficha(), jaTem).itens.find((i) => i.id === "listas")!;
    expect(troca.padrao).toBe(false);
    expect(troca.detalhes.join(" ")).toMatch(/Dependentes: 1 no cadastro → 1 na ficha/);
  });

  test("listas iguais às da ficha: sem item", () => {
    const aplicacao = montarPrevisao(ficha(), contexto()).aplicacoes.get("listas");
    if (aplicacao?.tipo !== "LISTAS") throw new Error("esperava a aplicação das listas");
    const { dependentes, ferias, anotacoes } = aplicacao.plano;
    const iguais = contexto({ listas: { dependentes, ferias, anotacoes: anotacoes.map((a) => ({ tipo: a.tipo, data: a.data, salario: a.salario, cargo: a.cargo })) } });
    expect(ids(montarPrevisao(ficha(), iguais))).not.toContain("listas");
  });
});
