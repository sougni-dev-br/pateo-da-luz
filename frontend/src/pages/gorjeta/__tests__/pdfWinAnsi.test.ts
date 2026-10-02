import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation, TipComputedParticipant, TipFolhaLiquidos, TipReciboVale } from "../../../api/client";

// Tudo que vai para o PDF (texto solto e células das tabelas), sem gerar arquivo.
const enviados: string[] = [];
const guardar = (v: unknown) => {
  if (Array.isArray(v)) v.forEach(guardar);
  else if (typeof v === "string") enviados.push(v);
  else if (typeof v === "number") enviados.push(String(v));
};
vi.mock("jspdf", () => ({
  jsPDF: class {
    lastAutoTable = { finalY: 50 };
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setDrawColor() {}
    setFillColor() {}
    setLineWidth() {}
    setLineDashPattern() {}
    setProperties() {}
    line() {}
    rect() {}
    roundedRect() {}
    addPage() {}
    setPage() {}
    getNumberOfPages() { return 1; }
    getTextWidth(t: string) { return t.length * 1.5; }
    splitTextToSize(t: string) { return [t]; }
    text(t: string | string[]) { guardar(t); }
    output() { return new Blob(); }
    save() {}
  },
}));
vi.mock("jspdf-autotable", () => ({
  default: (_doc: unknown, opts: Record<string, unknown>) => { guardar(opts.head); guardar(opts.body); guardar(opts.foot); },
}));
import { exportarFolhaLiquidos, exportarListaPagamento } from "../exportarPdf";
import { gerarReciboVale } from "../reciboVale";

// Helvetica do jsPDF = WinAnsi (cp1252). Fora dela o caractere sai embaralhado. Além disso,
// nenhum traço de sinal que não seja o hífen comum: o desconto nunca pode parecer positivo.
const EXTRAS_CP1252 = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•—˜™š›œžŸ";
const foraDoPdf = (s: string) => [...s].filter((c) => {
  const n = c.codePointAt(0)!;
  if (c === "\n") return false;
  if (n >= 0x20 && n <= 0x7e) return false;
  if (n >= 0xa0 && n <= 0xff) return false;
  return !EXTRAS_CP1252.includes(c);
});

beforeEach(() => { enviados.length = 0; });

function pessoa(over: Partial<TipComputedParticipant>): TipComputedParticipant {
  return {
    participantId: "tp", employeeId: "e", employeeName: "Pessoa", apelido: null, companyId: "c1", companyName: "Pateo Frei", functionName: null,
    isActive: true, semRegistro: true, foraDaGorjeta: false, admissionDate: "2025-01-01T00:00:00.000Z", terminationDate: null, kind: "PONTOS", basePoints: 2,
    tipoCalculo: "MES", pagoNaRescisao: false, diasSalario: 30, salarioProporcional: 1500, adiantamentoSalarial: 600, primeiraQuinzena: 750,
    rateioAmount: 300, descontos: 45.5, creditos: 10, horaExtra: "2:00", adicionalNoturno: null, valorHoraExtra: 30, valorAdicionalNoturno: 0,
    totalAPagar: 1154.5, pixKey: "chave", vales: [],
    ...over,
  } as TipComputedParticipant;
}

const comp = {
  year: 2026, month: 9, label: "Gorjeta 26/08–25/09", code: "GOR-2026-09",
  participants: [pessoa({ employeeName: "Ana – Souza" }), pessoa({ employeeId: "b", employeeName: "Bia", foraDaGorjeta: true })],
  adiantamento: { percent: 40, dia: 20 },
} as unknown as TipComputation;

describe("PDF só leva caracteres que a fonte do jsPDF desenha", () => {
  test("lista de pagamento: desconto com hífen, nada de − nem –", async () => {
    await exportarListaPagamento(comp);
    const todos = enviados.join("\n");
    expect(todos).not.toMatch(/[−–]/);
    expect(foraDoPdf(todos)).toEqual([]);
    // O sinal do desconto continua lá (hífen comum).
    expect(enviados.some((t) => /^- R\$/.test(t))).toBe(true);
  });

  test("folha de líquidos: rodapé e cabeçalho sem − nem ·", async () => {
    const folha = {
      code: "FOL-2026-09", label: "Setembro – 2026", total: 2000, extratos: [], etapas: {}, salariosCombinados: [],
      linhas: [{ employeeId: "a", nome: "Ana", grupo: "Pateo – Frei", origem: "SALARIO_COMBINADO", valor: 2000, composicao: "x", pix: null, aviso: null }],
    } as unknown as TipFolhaLiquidos;
    await exportarFolhaLiquidos(folha, false);
    const todos = enviados.join("\n");
    expect(todos).not.toMatch(/[−–]/);
    expect(foraDoPdf(todos)).toEqual([]);
  });

  test("recibo do vale: descrição e nomes digitados com traços especiais saem limpos", async () => {
    const r: TipReciboVale = {
      codigo: "VAL-1", vez: 2,
      empresa: { razaoSocial: "Pateo – Ltda", fantasia: "Pateo", cnpj: "12345678000190", endereco: "Rua − 1", cidade: "São Paulo" },
      funcionario: { nome: "Ana – Souza", cpf: "12345678901", funcao: "Garçom ‐ salão" },
      vale: { tipo: "ADIANTAMENTO", valor: 100, data: "2026-09-10", descricao: "vale − setembro" },
      apuracao: { codigo: "GOR-2026-09", periodo: "26/08–25/09" },
      emitidoEm: "2026-09-10T12:00:00.000Z", emitidoPor: "Eli",
    };
    await gerarReciboVale(r);
    const todos = enviados.join("\n");
    expect(todos).not.toMatch(/[−–‐]/);
    expect(foraDoPdf(todos)).toEqual([]);
  });
});
