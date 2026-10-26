import { expect, test } from "vitest";
import { decidirParcelasNaEdicao } from "../parcelas-pagas-na-edicao.js";

// Editar a compra apagava as parcelas e recriava todas como OPEN: a baixa sumia
// e a conta voltava para "em aberto". Regra: parcela paga so e mantida quando a
// edicao nao mexe na cobranca; se mexe, a edicao e recusada (estornar antes).

const paga = { dueDate: new Date("2026-09-01T00:00:00.000Z"), amount: 52928.57, status: "PAID", paidDate: new Date("2026-09-01T00:00:00.000Z") };
const nova = { dueDate: new Date("2026-09-01T00:00:00.000Z"), amount: 52928.57, status: "OPEN", paidDate: null };

test("recria as parcelas quando nenhuma esta paga", () => {
  const aberta = { ...paga, status: "OPEN", paidDate: null };
  expect(decidirParcelasNaEdicao([aberta], [{ ...nova, amount: 10 }])).toBe("RECRIAR");
});

test("mantem a parcela paga quando a edicao reenvia o mesmo vencimento e valor", () => {
  expect(decidirParcelasNaEdicao([paga], [nova])).toBe("MANTER");
});

test("bloqueia quando o valor da parcela paga muda", () => {
  expect(decidirParcelasNaEdicao([paga], [{ ...nova, amount: 60000 }])).toBe("BLOQUEAR");
});

test("bloqueia quando o vencimento da parcela paga muda", () => {
  expect(decidirParcelasNaEdicao([paga], [{ ...nova, dueDate: new Date("2026-10-01T00:00:00.000Z") }])).toBe("BLOQUEAR");
});

test("bloqueia quando a quantidade de parcelas muda", () => {
  expect(decidirParcelasNaEdicao([paga], [nova, { ...nova, dueDate: new Date("2026-10-01T00:00:00.000Z") }])).toBe("BLOQUEAR");
});

test("bloqueia quando a edicao passa a nao ter parcelas proprias (cartao, ciclo, reembolso)", () => {
  expect(decidirParcelasNaEdicao([paga], [])).toBe("BLOQUEAR");
});

test("ignora parcelas canceladas na comparacao", () => {
  const cancelada = { dueDate: new Date("2026-08-01T00:00:00.000Z"), amount: 1, status: "CANCELLED", paidDate: null };
  expect(decidirParcelasNaEdicao([cancelada, paga], [nova])).toBe("MANTER");
});

test("reconhece parcela paga por status mesmo sem paidDate", () => {
  expect(decidirParcelasNaEdicao([{ ...paga, paidDate: null, status: "PAID_LATE" }], [{ ...nova, amount: 5 }])).toBe("BLOQUEAR");
});

test("pequeno gasto no caixa com a data da compra alterada: a baixa acompanha, segue recriando", () => {
  const dia = new Date("2026-09-02T00:00:00.000Z");
  expect(decidirParcelasNaEdicao([paga], [{ ...nova, dueDate: dia, status: "PAID", paidDate: dia }])).toBe("RECRIAR");
});

test("a tela reenvia a parcela cancelada: nao conta e nao bloqueia", () => {
  const cancelada = { dueDate: new Date("2026-08-01T00:00:00.000Z"), amount: 1, status: "CANCELLED", paidDate: null };
  expect(decidirParcelasNaEdicao([cancelada, paga], [{ ...cancelada }, nova])).toBe("MANTER");
});

test("pequeno gasto no caixa sem mudanca: a baixa existente e mantida, nao sobrescrita", () => {
  const sintetica = { ...nova, status: "PAID", paidDate: new Date("2026-09-01T00:00:00.000Z") };
  expect(decidirParcelasNaEdicao([paga], [sintetica])).toBe("MANTER");
});

test("compara vencimento pelo dia, nao pela hora", () => {
  expect(decidirParcelasNaEdicao([paga], [{ ...nova, dueDate: new Date("2026-09-01T03:00:00.000Z") }])).toBe("MANTER");
});
