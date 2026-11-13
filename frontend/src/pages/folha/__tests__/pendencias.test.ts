import { describe, expect, it } from "vitest";
import type { Decimo13Linha, Decimo13LinhaClt, PagamentoMeio } from "../../../api/client";
import { linkContasAPagar } from "../LinkInterno";
import { parcelaEmCurso, pendenciaDoMeio, pendenciasDoDecimo } from "../pendencias";
import { variacaoContraAnterior } from "../regrasPagamentoMeio";

const calculo = { ano: 2026, avos: 12, desde: "2026-01-01", salario: 2000, mediaVariaveis: 0, base: 2000, total: 2000,
  parcela1: 1000, parcela2: 1000, vencimento1: "2026-11-30", vencimento2: "2026-12-20", memoria: "" };
const sr = (over: Partial<Decimo13Linha>): Decimo13Linha => ({ employeeId: "s", nome: "Pessoa", setor: null, calculo, motivoSemCalculo: null,
  parcela1Existe: false, parcela2Existe: false, preRegistro: false, semRegistroAte: null, registroEm: null, ...over });
const clt = (over: Partial<Decimo13LinhaClt>): Decimo13LinhaClt => ({ employeeId: "c", nome: "Pessoa CLT", setor: null, parcela1: null, parcela2: null, ...over });

describe("pendenciaDoMeio", () => {
  it("só aparece quando falta lançar alguém", () => {
    expect(pendenciaDoMeio("Adiantamento", { aLancar: { pessoas: 0, total: 0 } } as PagamentoMeio, "/x")).toBeNull();
    expect(pendenciaDoMeio("Adiantamento", null, "/x")).toBeNull();
    expect(pendenciaDoMeio("Adiantamento", { aLancar: { pessoas: 3, total: 100 } } as PagamentoMeio, "/x")?.texto).toContain("3 pessoas a lançar");
  });
});

describe("pendenciasDoDecimo", () => {
  it("fora de outubro a dezembro o 13º não é assunto", () => {
    expect(parcelaEmCurso(9)).toBeNull();
    expect(pendenciasDoDecimo(9, [sr({})], [clt({})], "/13")).toEqual([]);
  });
  it("em novembro conta a 1ª parcela: a lançar (sem registro) e aguardando extrato (CLT)", () => {
    const out = pendenciasDoDecimo(11, [sr({}), sr({ employeeId: "s2", parcela1Existe: true })], [clt({}), clt({ employeeId: "c2", parcela1: { valor: 1, pago: false } })], "/13");
    expect(out.map((p) => p.texto)).toEqual([
      "13º salário (1ª parcela): 1 pessoa a lançar",
      "13º salário (1ª parcela): 1 pessoa CLT aguardando o extrato da contabilidade",
    ]);
  });
  it("em dezembro conta a 2ª parcela", () => {
    expect(pendenciasDoDecimo(12, [sr({ parcela1Existe: true })], [], "/13")[0].texto).toContain("2ª parcela");
  });
});

describe("variacaoContraAnterior", () => {
  it("avisa só quando passa do limite e diz o sentido", () => {
    expect(variacaoContraAnterior(1100, 1000)).toEqual({ pct: 10, sobe: true });
    expect(variacaoContraAnterior(800, 1000)).toEqual({ pct: 20, sobe: false });
    expect(variacaoContraAnterior(1050, 1000)).toBeNull();
  });
  it("sem valor anterior (ou zero) não compara", () => {
    expect(variacaoContraAnterior(1000, undefined)).toBeNull();
    expect(variacaoContraAnterior(1000, 0)).toBeNull();
  });
});

describe("linkContasAPagar", () => {
  it("filtra pelo dia do vencimento, só em aberto", () => {
    expect(linkContasAPagar("2026-11-30")).toBe("/financeiro/contas-a-pagar?de=2026-11-30&ate=2026-11-30&aba=abertos");
  });
});
