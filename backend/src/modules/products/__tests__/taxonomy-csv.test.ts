import { describe, expect, it } from "vitest";
import { lerCsv, lerDecisoes } from "../taxonomy-csv.js";

const cabecalho = "codigo;nome;natureza;categoria;origem;motivo";

describe("lerCsv", () => {
  it("lê ponto e vírgula, ignora BOM e linhas em branco, aceita CRLF", () => {
    const linhas = lerCsv(`﻿a;b\r\n1;2\r\n\r\n3;4\r\n`);
    expect(linhas).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("campo entre aspas pode ter ponto e vírgula, quebra de linha e aspas duplicadas", () => {
    expect(lerCsv('x;"a;b";"linha1\nlinha2";"disse ""oi"""\n')).toEqual([["x", "a;b", "linha1\nlinha2", 'disse "oi"']]);
  });

  it("aspas no meio do campo são texto comum (polegadas), não abrem campo entre aspas", () => {
    expect(lerCsv('PIZZA 12";outro\n')).toEqual([['PIZZA 12"', "outro"]]);
  });

  it("falha quando o arquivo termina dentro de aspas", () => {
    expect(() => lerCsv('a;"sem fechar\nb;c\n')).toThrow(/aspas/);
  });

  it("falha quando o arquivo não está em UTF-8", () => {
    expect(() => lerCsv("a;b\nCaf�;1\n")).toThrow(/UTF-8/);
  });
});

describe("lerDecisoes", () => {
  it("lê código, natureza e categoria, e trata vazio como ausente", () => {
    const decisoes = lerDecisoes(`${cabecalho}\n1;ITEM A;INSUMO;SECOS E GRAOS;proposta;\n2;ITEM B;;;decisao;sem classificar\n`);
    expect(decisoes).toEqual([
      { codigo: "1", nature: "INSUMO", category: "SECOS E GRAOS" },
      { codigo: "2", nature: null, category: null }
    ]);
  });

  it("falha quando falta uma coluna do cabeçalho", () => {
    expect(() => lerDecisoes("codigo;nome;natureza\n1;A;INSUMO\n")).toThrow(/categoria/);
  });

  it("falha com natureza desconhecida", () => {
    expect(() => lerDecisoes(`${cabecalho}\n1;A;OUTRA;X;p;\n`)).toThrow(/Natureza inválida/);
  });

  it("falha quando uma linha tem menos colunas que o cabeçalho (linha truncada não vira 'sem decisão')", () => {
    expect(() => lerDecisoes(`${cabecalho}\n1;A;INSUMO\n`)).toThrow(/colunas/);
  });

  it("linha sem código e sem decisão é ignorada; com decisão é erro", () => {
    expect(lerDecisoes(`${cabecalho}\n;ITEM SEM CODIGO;;;decisao;nao classificar\n3;ITEM C;INSUMO;FLV;p;\n`)).toEqual([
      { codigo: "3", nature: "INSUMO", category: "FLV" }
    ]);
    expect(() => lerDecisoes(`${cabecalho}\n;A;INSUMO;SECOS E GRAOS;p;\n`)).toThrow(/sem código/);
  });

  it("falha com arquivo vazio", () => {
    expect(() => lerDecisoes("")).toThrow(/vazio/);
  });
});
