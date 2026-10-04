import { beforeEach, describe, expect, test } from "vitest";
import { filhosParaSalvar } from "../EtapaFamilia";
import { ETAPAS, corpoDaEtapa, etapaDeRetomada } from "../etapas";
import type { Estado } from "../api";
import { aplicarCep, apagarRascunho, guardarRascunho, hojeSp, lerRascunho } from "../rascunho";

const CODIGO = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("rascunho na aba", () => {
  beforeEach(() => sessionStorage.clear());

  test("guarda, lê e apaga o que foi digitado e a etapa", () => {
    guardarRascunho(CODIGO, { valores: { endereco: "Rua Exemplo" }, filhos: [{ nome: "Lia", nascimento: "", cpf: "" }], etapa: 2 });
    expect(lerRascunho(CODIGO)).toEqual({ valores: { endereco: "Rua Exemplo" }, filhos: [{ nome: "Lia", nascimento: "", cpf: "" }], etapa: 2, doCep: {} });
    apagarRascunho(CODIGO);
    expect(lerRascunho(CODIGO)).toBeNull();
  });

  test("rascunho estragado é ignorado", () => {
    sessionStorage.setItem(`ficha-rascunho:${CODIGO.slice(0, 12)}`, "{não é json");
    expect(lerRascunho(CODIGO)).toBeNull();
    sessionStorage.setItem(`ficha-rascunho:${CODIGO.slice(0, 12)}`, JSON.stringify({ valores: {}, filhos: "x", etapa: 1 }));
    expect(lerRascunho(CODIGO)).toBeNull();
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
    expect(etapaDeRetomada(base, { valores: {}, filhos: [], etapa: 3 })).toBe(3);
    expect(etapaDeRetomada(base, { valores: {}, filhos: [], etapa: 99 })).toBe(ETAPAS.length - 1);
  });

  test("devolvida pelo DP abre na revisão; atualização recomeça do início", () => {
    expect(etapaDeRetomada({ ...base, motivoDevolucao: "Foto ilegível" }, null)).toBe(revisao);
    expect(etapaDeRetomada({ ...base, tipo: "ATUALIZACAO" }, null)).toBe(0);
    expect(etapaDeRetomada({ ...base, status: "ENVIADA" }, null)).toBe(0);
  });
});
