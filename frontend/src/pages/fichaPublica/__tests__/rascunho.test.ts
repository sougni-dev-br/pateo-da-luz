import { beforeEach, describe, expect, test } from "vitest";
import { filhosParaSalvar } from "../EtapaFamilia";
import { ETAPAS, corpoDaEtapa, etapaDeRetomada } from "../etapas";
import type { Estado } from "../api";
import { aplicarCep, apagarRascunho, guardarRascunho, hojeSp, impressaoDe, lerRascunho } from "../rascunho";

const CODIGO = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("rascunho na aba", () => {
  beforeEach(() => sessionStorage.clear());

  test("guarda, lê e apaga o que foi digitado e a etapa", () => {
    guardarRascunho(CODIGO, { valores: { endereco: "Rua Exemplo" }, filhos: [{ nome: "Lia", nascimento: "", cpf: "" }], etapa: 2, base: "b1" });
    expect(lerRascunho(CODIGO)).toEqual({ valores: { endereco: "Rua Exemplo" }, filhos: [{ nome: "Lia", nascimento: "", cpf: "" }], etapa: 2, doCep: {}, base: "b1" });
    apagarRascunho(CODIGO);
    expect(lerRascunho(CODIGO)).toBeNull();
  });

  test("rascunho estragado é ignorado", () => {
    sessionStorage.setItem(`ficha-rascunho:${CODIGO.slice(0, 12)}`, "{não é json");
    expect(lerRascunho(CODIGO)).toBeNull();
    sessionStorage.setItem(`ficha-rascunho:${CODIGO.slice(0, 12)}`, JSON.stringify({ valores: {}, filhos: "x", etapa: 1, base: "b" }));
    expect(lerRascunho(CODIGO)).toBeNull();
    // Filho estragado quebraria a tela a cada recarga; rascunho antigo sem base também sai.
    sessionStorage.setItem(`ficha-rascunho:${CODIGO.slice(0, 12)}`, JSON.stringify({ valores: {}, filhos: [null], etapa: 1, base: "b" }));
    expect(lerRascunho(CODIGO)).toBeNull();
    sessionStorage.setItem(`ficha-rascunho:${CODIGO.slice(0, 12)}`, JSON.stringify({ valores: {}, filhos: [], etapa: 1 }));
    expect(lerRascunho(CODIGO)).toBeNull();
  });

  test("impressão dos dados do servidor: igual para os mesmos dados, diferente se mudou", () => {
    expect(impressaoDe({ cpf: "1", nome: "A", filhos: [{ nome: "Lia", cpf: null }] })).toBe(impressaoDe({ filhos: [{ cpf: null, nome: "Lia" }], nome: "A", cpf: "1" }));
    expect(impressaoDe({ cpf: "1", nome: "A" })).not.toBe(impressaoDe({ cpf: "2", nome: "A" }));
  });
});

describe("endereço pelo CEP", () => {
  const achado = { endereco: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", uf: "SP" };

  test("preenche o vazio e guarda o que veio do CEP", () => {
    const r = aplicarCep({ endereco: "", numero: "50" }, achado, {});
    expect(r.valores).toMatchObject({ endereco: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", uf: "SP", numero: "50" });
    expect(r.doCep).toEqual(achado);
  });

  test("CEP corrigido troca o endereço do CEP errado, mas não o que a pessoa digitou", () => {
    const anterior = { endereco: "Rua Errada", bairro: "Bairro Errado", cidade: "Santos", uf: "SP" };
    const digitadoAMao = { endereco: "Rua Errada", bairro: "Vila Que Eu Escrevi", cidade: "Santos", uf: "SP" };
    const r = aplicarCep(digitadoAMao, achado, anterior);
    expect(r.valores).toMatchObject({ endereco: "Praça da Sé", bairro: "Vila Que Eu Escrevi", cidade: "São Paulo", uf: "SP" });
  });

  test("CEP novo sem rua (CEP geral de cidade): a rua do CEP anterior sai; a digitada à mão fica", () => {
    const anterior = { endereco: "Rua Errada", bairro: "Bairro Errado", cidade: "Santos", uf: "SP" };
    const semRua = { endereco: "", bairro: "", cidade: "Cidade Pequena", uf: "MG" };
    const r = aplicarCep({ ...anterior }, semRua, anterior);
    expect(r.valores).toMatchObject({ endereco: "", bairro: "", cidade: "Cidade Pequena", uf: "MG" });
    expect(r.doCep).toEqual({ cidade: "Cidade Pequena", uf: "MG" });
    expect(aplicarCep({ endereco: "Rua Minha" }, semRua, { endereco: "Rua Errada" }).valores.endereco).toBe("Rua Minha");
  });

  test("campo apagado à mão e o CEP novo sem ele: deixa de contar como vindo do CEP", () => {
    const r = aplicarCep({ endereco: "", bairro: "Sé" }, { endereco: "", bairro: "Centro", cidade: "Rio", uf: "RJ" }, { endereco: "Rua Velha", bairro: "Sé" });
    expect(r.doCep.endereco).toBeUndefined();
    expect(r.valores.bairro).toBe("Centro");
  });

  test("sem CEP anterior, o que já está escrito fica", () => {
    expect(aplicarCep({ endereco: "Rua Minha" }, achado, {}).valores.endereco).toBe("Rua Minha");
  });
});

describe("datas no fuso de São Paulo", () => {
  test("às 22h de São Paulo o dia ainda é hoje (em UTC já é amanhã)", () => {
    expect(hojeSp(new Date("2026-10-04T01:30:00Z"))).toBe("2026-10-03");
  });

  test("nascimento antes de 1900 e filho nascido no futuro são recusados", () => {
    const pessoais = ETAPAS.find((e) => e.campos.some((c) => c.nome === "dataNascimento"))!;
    const r = corpoDaEtapa(pessoais, { dataNascimento: "10/04/1850" }, true);
    expect("erros" in r && r.erros.dataNascimento).toBeTruthy();
    const f = filhosParaSalvar([{ nome: "Lia Exemplo", nascimento: "01/01/2999", cpf: "" }]);
    expect("erros" in f && f.erros["filho-0-nascimento"]).toContain("futuro");
  });
});

describe("onde a ficha reabre", () => {
  const base = { status: "PREENCHENDO", tipo: "ADMISSAO", dados: { nomeCompleto: "Joana Exemplo" }, arquivos: [] } as unknown as Estado;
  const revisao = ETAPAS.findIndex((e) => e.id === "revisao");

  test("com rascunho, na etapa em que a pessoa estava", () => {
    expect(etapaDeRetomada(base, { valores: {}, filhos: [], etapa: 3, base: "" })).toBe(3);
    expect(etapaDeRetomada(base, { valores: {}, filhos: [], etapa: 99, base: "" })).toBe(ETAPAS.length - 1);
    // Rascunho vale mais que "devolvida" (a pessoa já estava corrigindo quando recarregou).
    expect(etapaDeRetomada({ ...base, motivoDevolucao: "Foto ilegível" }, { valores: {}, filhos: [], etapa: 2, base: "" })).toBe(2);
  });

  test("devolvida pelo DP abre na revisão; atualização recomeça do início", () => {
    expect(etapaDeRetomada({ ...base, motivoDevolucao: "Foto ilegível" }, null)).toBe(revisao);
    expect(etapaDeRetomada({ ...base, tipo: "ATUALIZACAO" }, null)).toBe(0);
    expect(etapaDeRetomada({ ...base, status: "ENVIADA" }, null)).toBe(0);
  });
});
