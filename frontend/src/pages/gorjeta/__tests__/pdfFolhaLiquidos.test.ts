import { beforeEach, expect, test, vi } from "vitest";
import type { TipFolhaLiquidos } from "../../../api/client";

// As tabelas que iriam para o PDF, sem gerar arquivo.
const tabelas: Array<{ head: string[][]; body: string[][]; foot: string[][] }> = [];
vi.mock("jspdf", () => ({
  jsPDF: class {
    lastAutoTable = { finalY: 50 };
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setFont() {} setFontSize() {} setTextColor() {} setDrawColor() {} setFillColor() {} setLineWidth() {}
    line() {} rect() {} roundedRect() {} addPage() {} setPage() {} text() {} save() {}
    getNumberOfPages() { return 1; }
    getTextWidth(t: string) { return t.length * 1.5; }
    splitTextToSize(t: string) { return [t]; }
  },
}));
vi.mock("jspdf-autotable", () => ({
  default: (_doc: unknown, o: { head: string[][]; body: string[][]; foot: string[][] }) => { tabelas.push(o); },
}));
import { empresaCurta, gerarPdfFolhaLiquidos } from "../pdfFolhaLiquidos";

// Dados fictícios.
const FC = "EMPRESA FICTICIA BAR E RESTAURANTE LTDA";
const LUZ = "OUTRA FICTICIA COMERCIO DE ALIMENTOS LTDA";
const folha = {
  code: "GOR-2026-0009", label: "Gorjeta 26/08-25/09", total: 600, extratos: [FC, LUZ], etapas: {}, jaPagos: [],
  linhas: [
    { employeeId: "z", nome: "ZULEICA DE TAL", grupo: LUZ, origem: "EXTRATO", valor: 100, pix: null, pixTipo: null, contaBancaria: null, aviso: null },
    { employeeId: "b", nome: "Bruno Fictício", grupo: FC, origem: "EXTRATO", valor: 200, pix: "bruno@exemplo.com", pixTipo: "EMAIL", contaBancaria: "Banco X · Ag. 1 · C/C 2-3", aviso: null },
    { employeeId: "a", nome: "Álvaro Fictício", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 300, pix: null, pixTipo: null, contaBancaria: null, aviso: null },
  ],
} as unknown as TipFolhaLiquidos;

beforeEach(() => { tabelas.length = 0; });

test("por empresa: um bloco por grupo, líquido logo depois do nome e dados bancários ao lado", async () => {
  await gerarPdfFolhaLiquidos(folha, { year: 2026, month: 9, liberada: true, modo: "empresa" });
  expect(tabelas).toHaveLength(3);
  expect(tabelas[0].head[0]).toEqual(["Funcionário", "Líquido", "Dados bancários", "Pago"]);
  expect(tabelas[0].body[0][0]).toBe("Zuleica de Tal");
  expect(tabelas[0].body[0][2]).toBe("Sem dados bancários no cadastro");
  expect(tabelas[1].body[0].slice(0, 3)).toEqual(["Bruno Fictício", "R$ 200,00", "PIX (e-mail): bruno@exemplo.com\nBanco X · Ag. 1 · C/C 2-3"]);
});

test("modo Pateo: uma lista só, em ordem alfabética, com a empresa curta", async () => {
  await gerarPdfFolhaLiquidos(folha, { year: 2026, month: 9, liberada: true, modo: "alfabetica" });
  expect(tabelas).toHaveLength(1);
  expect(tabelas[0].head[0]).toEqual(["Funcionário", "Empresa", "Líquido", "Dados bancários", "Pago"]);
  expect(tabelas[0].body.map((r) => r[0])).toEqual(["Álvaro Fictício", "Bruno Fictício", "Zuleica de Tal"]);
  expect(tabelas[0].body.map((r) => r[1])).toEqual(["Sem registro", "Empresa Ficticia", "Outra Ficticia"]);
  expect(tabelas[0].foot[0]).toEqual(["Total", "", "R$ 600,00", "", ""]);
});

test("nome curto da empresa: até a atividade ou o tipo societário", () => {
  expect(empresaCurta("PATEO FICTICIO COMERCIO DE ALIMENTOS LTDA")).toBe("Pateo Ficticio");
  expect(empresaCurta("CASA FICTICIA LTDA")).toBe("Casa Ficticia");
  expect(empresaCurta("Sem registro")).toBe("Sem registro");
});

test("colunas ocultas saem do PDF; nome e líquido ficam sempre", async () => {
  await gerarPdfFolhaLiquidos(folha, { year: 2026, month: 9, liberada: true, modo: "empresa", ocultas: new Set(["banco", "pago"]) });
  expect(tabelas[1].head[0]).toEqual(["Funcionário", "Líquido"]);
  expect(tabelas[1].body[0]).toEqual(["Bruno Fictício", "R$ 200,00"]);
  expect(tabelas[1].foot[0]).toEqual(["Subtotal", "R$ 200,00"]);

  tabelas.length = 0;
  await gerarPdfFolhaLiquidos(folha, { year: 2026, month: 9, liberada: true, modo: "alfabetica", ocultas: new Set(["empresa"]) });
  expect(tabelas[0].head[0]).toEqual(["Funcionário", "Líquido", "Dados bancários", "Pago"]);
});
