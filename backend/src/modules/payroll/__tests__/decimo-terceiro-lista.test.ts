import { describe, expect, test } from "vitest";
import { valorComCombinado } from "../decimo-terceiro-combinado.js";
import { type ItemDaLista13, type LinhaPreviaLista13, montarListaDecimo13 } from "../decimo-terceiro-lista.js";
import type { PessoaMeio } from "../pagamento-meio.js";

// Lista de pagamento do 13º. Dados FICTÍCIOS: o repositório é público.
const pessoa = (id: string, nome: string, semRegistro = false): [string, PessoaMeio] =>
  [id, { id, nome, semRegistro, empresa: semRegistro ? null : "Empresa Teste Ltda", pix: "pix@teste", pixTipo: "EMAIL", contaBancaria: null }];
const pessoas = new Map([pessoa("clt", "Ana Silva"), pessoa("sr", "Bia Souza", true), pessoa("comb", "Caio Lima")]);
const item = (over: Partial<ItemDaLista13>): ItemDaLista13 => ({
  id: "i", employeeId: "clt", periodLabel: "13º Salário - 1ª parcela (extrato)", amount: 1000, dueDate: new Date("2026-11-30T00:00:00Z"),
  paymentDate: null, paidAmount: null, details: { empresa: "EMPRESA TESTE LTDA" }, ...over,
});
const venc = { vencimento1: "2026-11-30", vencimento2: "2026-12-20" };
const nada = { existe: false, paga: false, lancado: null, devido: null, gerar: false };

describe("montarListaDecimo13", () => {
  test("título do extrato entra como CLT, agrupado pela empresa, com a situação", () => {
    const l = montarListaDecimo13(2026, 1, [item({})], [], pessoas);
    expect(l.linhas).toHaveLength(1);
    expect(l.linhas[0]).toMatchObject({ nome: "Ana Silva", origem: "EXTRATO", grupo: "EMPRESA TESTE LTDA", valor: 1000, situacao: "LANCADO", pix: "pix@teste" });
    expect(l.total).toBe(1000);
    expect(l.lancado).toEqual({ pessoas: 1, total: 1000 });
  });

  test("só a parcela pedida", () => {
    const itens = [item({}), item({ id: "i2", periodLabel: "13º Salário - 2ª parcela", employeeId: "sr", amount: 400 })];
    expect(montarListaDecimo13(2026, 1, itens, [], pessoas).linhas.map((x) => x.nome)).toEqual(["Ana Silva"]);
    expect(montarListaDecimo13(2026, 2, itens, [], pessoas).linhas.map((x) => x.nome)).toEqual(["Bia Souza"]);
  });

  test("título somado ao combinado mostra a composição no aviso", () => {
    const somado = valorComCombinado(2000, 573);
    const l = montarListaDecimo13(2026, 1, [item({ employeeId: "comb", amount: somado.valor, details: { empresa: "X", ...somado.detalhes } })], [], pessoas);
    expect(l.linhas[0].valor).toBe(2573);
    expect(l.linhas[0].aviso).toContain("diferença do salário combinado");
    expect(l.linhas[0].aviso).toContain("573,00");
  });

  test("diferença do combinado por somar: o título do extrato sai com aviso para lançar antes de pagar", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "comb", origem: "COMBINADO", viaExtrato: true, calculo: venc, p: { existe: false, paga: false, lancado: null, devido: 573, gerar: true } }];
    const l = montarListaDecimo13(2026, 1, [item({ employeeId: "comb", amount: 2000 })], previa, pessoas);
    expect(l.linhas).toHaveLength(1);
    expect(l.linhas[0].aviso).toContain("lance a parcela");
    expect(l.linhas[0].aviso).toContain("573,00");
  });

  test("sem registro ainda sem título: sai como a lançar, com o valor devido e o vencimento", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "sr", origem: "SEM_REGISTRO", viaExtrato: false, calculo: venc, p: { ...nada, devido: 350.5, gerar: true } }];
    const l = montarListaDecimo13(2026, 1, [], previa, pessoas);
    expect(l.linhas[0]).toMatchObject({ nome: "Bia Souza", grupo: "Sem registro", situacao: "A_LANCAR", valor: 350.5, vencimento: "2026-11-30" });
    expect(l.aLancar).toEqual({ pessoas: 1, total: 350.5 });
  });

  test("combinado aguardando o extrato não vira linha, só um aviso", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "comb", origem: "COMBINADO", viaExtrato: false, calculo: venc, p: { ...nada, devido: 573, aguardaExtrato: true } }];
    const l = montarListaDecimo13(2026, 1, [], previa, pessoas);
    expect(l.linhas).toHaveLength(0);
    expect(l.avisos[0]).toContain("aguardam o extrato");
  });

  test("pago sai como pago, com o valor que saiu do banco", () => {
    const l = montarListaDecimo13(2026, 1, [item({ paymentDate: new Date("2026-11-28T00:00:00Z"), paidAmount: 990 })], [], pessoas);
    expect(l.linhas[0]).toMatchObject({ situacao: "PAGO", valorPago: 990, pagoEm: "2026-11-28" });
    expect(l.pago).toEqual({ pessoas: 1, total: 990 });
    expect(l.linhas[0].aviso).toContain("Pago");
  });

  test("sem registro com título em aberto e cálculo diferente: avisa e informa o valor de hoje", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "sr", origem: "SEM_REGISTRO", viaExtrato: false, calculo: venc, p: { existe: true, paga: false, lancado: 300, devido: 350.5, gerar: true } }];
    const l = montarListaDecimo13(2026, 1, [item({ employeeId: "sr", periodLabel: "13º Salário - 1ª parcela", amount: 300, details: {} })], previa, pessoas);
    expect(l.linhas[0].atualizarPara).toBe(350.5);
    expect(l.linhas[0].aviso).toContain("350,50");
  });
});

describe("montarListaDecimo13 — achados da auditoria", () => {
  test("falta somar: o título sai com o valor que vai valer e a lista vira prévia (atualizarPara)", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "comb", origem: "COMBINADO", viaExtrato: true, calculo: venc, p: { existe: false, paga: false, lancado: null, devido: 573, gerar: true } }];
    const l = montarListaDecimo13(2026, 1, [item({ employeeId: "comb", amount: 2000 })], previa, pessoas);
    expect(l.linhas[0].atualizarPara).toBe(2573);
    expect(l.linhas[0].aviso).toContain("2.573,00");
  });

  test("2ª parcela: a diferença a lançar aparece mesmo com a 1ª ainda em aberto no extrato", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "comb", origem: "COMBINADO", viaExtrato: true, calculo: venc, p: { existe: false, paga: false, lancado: null, devido: 700.33, gerar: true } }];
    const l = montarListaDecimo13(2026, 2, [], previa, pessoas);
    expect(l.linhas).toHaveLength(1);
    expect(l.linhas[0]).toMatchObject({ situacao: "A_LANCAR", valor: 700.33, vencimento: "2026-12-20" });
  });

  test("aguardando extrato: os nomes vão na lista para o PDF não sair como lançado", () => {
    const previa: LinhaPreviaLista13[] = [{ employeeId: "comb", origem: "COMBINADO", viaExtrato: false, calculo: venc, p: { ...nada, devido: 573, aguardaExtrato: true } }];
    expect(montarListaDecimo13(2026, 1, [], previa, pessoas).aguardandoExtrato).toEqual(["Caio Lima"]);
    expect(montarListaDecimo13(2026, 2, [], previa, pessoas).aguardandoExtrato).toEqual([]);
  });
});

describe("montarListaDecimo13 — 2ª parcela com a 1ª não resolvida (terceira auditoria)", () => {
  const linha2 = (p1: LinhaPreviaLista13["p1"], viaExtrato = true): LinhaPreviaLista13 => ({
    employeeId: "comb", origem: "COMBINADO", viaExtrato, calculo: venc, p1,
    p: { existe: false, paga: false, lancado: null, devido: 700.33, gerar: true },
  });
  test("1ª aguardando o extrato, para conferir ou por somar: a 2ª não entra na lista nem no total", () => {
    for (const p1 of [{ gerar: false, aguardaExtrato: true }, { gerar: false, conferir: true }, { gerar: true }]) {
      const l = montarListaDecimo13(2026, 2, [], [linha2(p1, p1.gerar === true)], pessoas);
      expect(l.linhas).toHaveLength(0);
      expect(l.total).toBe(0);
    }
  });
  test("1ª resolvida (somada e em dia): a 2ª entra como a lançar", () => {
    const l = montarListaDecimo13(2026, 2, [], [linha2({ gerar: false })], pessoas);
    expect(l.linhas).toHaveLength(1);
    expect(l.linhas[0]).toMatchObject({ situacao: "A_LANCAR", valor: 700.33 });
  });
  test("somar de novo (o título já tinha uma diferença antiga): o título sai com líquido + diferença de hoje", () => {
    const somado = valorComCombinado(2000, 500);
    const previa: LinhaPreviaLista13[] = [{ employeeId: "comb", origem: "COMBINADO", viaExtrato: true, calculo: venc, p: { existe: true, paga: false, lancado: 500, devido: 562.5, gerar: true } }];
    const l = montarListaDecimo13(2026, 1, [item({ employeeId: "comb", amount: somado.valor, details: { liquido: 2000, ...somado.detalhes } })], previa, pessoas);
    expect(l.linhas[0].atualizarPara).toBe(2562.5);
  });
});
