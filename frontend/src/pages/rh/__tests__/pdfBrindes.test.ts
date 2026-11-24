import { describe, expect, test } from "vitest";
import type { DetalheBrinde, PessoaBrinde } from "../../../api/client";
import { nomeArquivoBrinde, pessoasParaPdf } from "../brindes/brindeLista";
import { montarPdfBrinde } from "../brindes/pdfBrindes";

const pessoa = (o: Partial<PessoaBrinde> & Pick<PessoaBrinde, "employeeId" | "nome">): PessoaBrinde => ({
  nomeCompleto: `${o.nome} da Silva`, empresa: "Casa Teste", setor: "Salão", cargo: null, ativo: true, saidaEm: null, entrega: null, ...o,
});
const entrega = { id: "e", entregueEm: "2026-12-18", observacao: null, registradoPor: null };
const pessoas = [pessoa({ employeeId: "a", nome: "Ana" }), pessoa({ employeeId: "b", nome: "Bia", entrega }), pessoa({ employeeId: "c", nome: "Caio", ativo: false, entrega })];
const detalhe = (ps: PessoaBrinde[]): DetalheBrinde => ({
  hoje: "2026-12-20", campanha: { id: "b1", nome: "Brinde de Natal", ano: 2026, observacao: null },
  resumo: { ativos: 2, entregues: 1, faltam: 1, entreguesDeInativos: 1 }, pessoas: ps,
});

describe("pessoasParaPdf", () => {
  test("FALTAM: só ativos sem entrega", () => {
    expect(pessoasParaPdf(pessoas, "FALTAM").map((p) => p.employeeId)).toEqual(["a"]);
  });
  test("TODOS: todos os ativos, nunca quem saiu", () => {
    expect(pessoasParaPdf(pessoas, "TODOS").map((p) => p.employeeId)).toEqual(["a", "b"]);
  });
});

describe("nomeArquivoBrinde", () => {
  test("sem acento nem símbolo", () => {
    expect(nomeArquivoBrinde("Brinde de Natal", 2026)).toBe("brinde-de-natal-2026-assinaturas.pdf");
    expect(nomeArquivoBrinde("Cesta — Páscoa!", 2027)).toBe("cesta-pascoa-2027-assinaturas.pdf");
    expect(nomeArquivoBrinde("???", 2026)).toBe("brinde-2026-assinaturas.pdf");
  });
});

describe("montarPdfBrinde", () => {
  test("gera um PDF válido com uma página para poucas pessoas", async () => {
    const doc = await montarPdfBrinde(detalhe(pessoas), "FALTAM", new Date("2026-12-20T10:00:00"));
    expect(doc.getNumberOfPages()).toBe(1);
    const bytes = new Uint8Array((doc as unknown as { output: (t: string) => ArrayBuffer }).output("arraybuffer"));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });
  test("lista longa passa para mais páginas sem quebrar uma linha de assinatura", async () => {
    const muitas = Array.from({ length: 60 }, (_, i) => pessoa({ employeeId: `p${i}`, nome: `Pessoa ${i}`, empresa: i % 2 ? "Casa A" : "Casa B" }));
    const doc = await montarPdfBrinde(detalhe(muitas), "TODOS");
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
  test("lista vazia não quebra", async () => {
    const doc = await montarPdfBrinde(detalhe([]), "FALTAM");
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
