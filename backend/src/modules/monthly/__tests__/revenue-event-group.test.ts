import { describe, expect, test } from "vitest";
import {
  EVENT_REVENUE_CHANNEL,
  EventGroupValidationError,
  MAX_EVENT_GROUP_ROWS,
  normalizeEventGroup
} from "../revenue-event-group.js";

const linha = (extra: Record<string, unknown> = {}) => ({
  date: "2026-10-14",
  description: "Congresso — Convidados / Palestrantes (14 × R$ 89,00)",
  grossAmount: 1246,
  tickets: 14,
  ...extra
});

function mensagem(corpo: unknown) {
  try {
    normalizeEventGroup(corpo);
  } catch (erro) {
    expect(erro).toBeInstanceOf(EventGroupValidationError);
    return (erro as Error).message;
  }
  throw new Error("esperava erro de validação");
}

describe("normalizeEventGroup", () => {
  test("normaliza uma linha: canal fixo de eventos, competência pela data e ticket médio calculado", () => {
    const [row] = normalizeEventGroup({ entries: [linha({ paymentMethod: "A receber", sourcePlatform: "Evento — Centro de Convenções" })] });
    expect(row).toMatchObject({
      dateKey: "2026-10-14",
      competenceYear: 2026,
      competenceMonth: 10,
      channel: EVENT_REVENUE_CHANNEL,
      grossAmount: 1246,
      serviceAmount: 0,
      netAmount: 1246,
      tickets: 14,
      ticketAverage: 89,
      paymentMethod: "A receber"
    });
    expect(row.date.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });

  test("com serviço, o líquido é bruto menos serviço e o ticket médio usa o líquido", () => {
    const [row] = normalizeEventGroup({ entries: [linha({ serviceAmount: 124.6 })] });
    expect(row.netAmount).toBe(1121.4);
    expect(row.ticketAverage).toBe(80.1);
  });

  test("ignora o canal enviado pelo cliente mas recusa canal diferente do de eventos", () => {
    expect(normalizeEventGroup({ entries: [linha({ channel: EVENT_REVENUE_CHANNEL })] })).toHaveLength(1);
    expect(mensagem({ entries: [linha({ channel: "Salão" })] })).toMatch(/Linha 1.*canal/i);
  });

  test("exige ao menos uma linha e respeita o limite máximo", () => {
    expect(mensagem({ entries: [] })).toMatch(/pelo menos um/i);
    expect(mensagem({})).toMatch(/pelo menos um/i);
    expect(mensagem({ entries: Array.from({ length: MAX_EVENT_GROUP_ROWS + 1 }, () => linha()) })).toMatch(/no máximo/i);
  });

  test("aponta a linha com problema", () => {
    expect(mensagem({ entries: [linha(), linha({ date: "" })] })).toMatch(/Linha 2.*data/i);
    expect(mensagem({ entries: [linha({ description: "   " })] })).toMatch(/Linha 1.*descrição/i);
    expect(mensagem({ entries: [linha({ grossAmount: 0 })] })).toMatch(/Linha 1.*valor/i);
    expect(mensagem({ entries: [linha({ grossAmount: "abc" })] })).toMatch(/Linha 1.*valor/i);
    expect(mensagem({ entries: [linha({ tickets: 0 })] })).toMatch(/Linha 1.*pessoas/i);
    expect(mensagem({ entries: [linha({ tickets: 2.5 })] })).toMatch(/Linha 1.*pessoas/i);
  });

  test("serviço não pode passar do bruto e o líquido informado precisa bater", () => {
    expect(mensagem({ entries: [linha({ serviceAmount: 2000 })] })).toMatch(/Linha 1.*serviço/i);
    expect(mensagem({ entries: [linha({ serviceAmount: 100, netAmount: 1000 })] })).toMatch(/Linha 1.*líquido/i);
    expect(normalizeEventGroup({ entries: [linha({ serviceAmount: 100, netAmount: 1146 })] })[0].netAmount).toBe(1146);
  });

  test("limita o tamanho dos textos livres", () => {
    expect(mensagem({ entries: [linha({ description: "x".repeat(201) })] })).toMatch(/Linha 1.*descrição/i);
    expect(mensagem({ entries: [linha({ notes: "x".repeat(1001) })] })).toMatch(/Linha 1.*observa/i);
  });

  test("arredonda valores em centavos sem erro de ponto flutuante", () => {
    const [row] = normalizeEventGroup({ entries: [linha({ grossAmount: 0.1 + 0.2, tickets: 1 })] });
    expect(row.grossAmount).toBe(0.3);
  });
});
