import { describe, expect, it } from "vitest";
import type { RevenueEntry } from "../../api/client";
import { entryDetails, entryOrigin, isZeroMarker, matchesSearch, visibleDescription } from "../revenueEntryView";

function entry(partial: Partial<RevenueEntry> & { id: string }): RevenueEntry {
  return {
    date: "2026-06-30T12:00:00.000Z",
    channel: "Salão",
    description: null,
    grossAmount: 0,
    netAmount: 0,
    serviceAmount: 0,
    tickets: 0,
    status: "ACTIVE",
    ...partial
  } as RevenueEntry;
}

describe("entryOrigin", () => {
  it("traduz a plataforma gravada para o nome que a equipe usa", () => {
    expect(entryOrigin(entry({ id: "1", sourcePlatform: "AGILE_PDV" }))).toBe("Agile PDV");
    expect(entryOrigin(entry({ id: "2", channel: "Delivery", sourcePlatform: "NOVENTA_NOVE" }))).toBe("99Food");
    expect(entryOrigin(entry({ id: "3", channel: "Delivery", sourcePlatform: "ifood" }))).toBe("iFood");
  });

  it("sem plataforma é lançamento manual", () => {
    expect(entryOrigin(entry({ id: "1", sourcePlatform: null }))).toBe("Manual");
  });

  it("evento mostra o tipo do evento como veio", () => {
    expect(entryOrigin(entry({ id: "1", channel: "Eventos / Empreitada", sourcePlatform: "Reserva de grupo" }))).toBe("Reserva de grupo");
  });
});

describe("visibleDescription", () => {
  it("esconde textos automáticos que só repetem origem, dia da semana ou canal", () => {
    expect(visibleDescription(entry({ id: "1", description: "Agile PDV - TERÇA-FEIRA" }))).toBeNull();
    expect(visibleDescription(entry({ id: "2", description: "Faturamento Salão" }))).toBeNull();
    expect(visibleDescription(entry({ id: "3", channel: "Delivery", description: "Delivery confirmado sem faturamento" }))).toBeNull();
    expect(visibleDescription(entry({ id: "4", description: "  " }))).toBeNull();
  });

  it("mantém o que alguém escreveu", () => {
    expect(visibleDescription(entry({ id: "1", description: "Ajuste do caixa de sexta" }))).toBe("Ajuste do caixa de sexta");
  });
});

describe("isZeroMarker", () => {
  it("é marcador quando não tem valor, pessoas nem turnos", () => {
    expect(isZeroMarker(entry({ id: "1", channel: "Delivery" }))).toBe(true);
  });

  it("não é marcador se qualquer valor existe", () => {
    expect(isZeroMarker(entry({ id: "1", grossAmount: 10 }))).toBe(false);
    expect(isZeroMarker(entry({ id: "2", tickets: 2 }))).toBe(false);
    expect(isZeroMarker(entry({ id: "3", salesFirstShift: 5 }))).toBe(false);
  });
});

describe("matchesSearch", () => {
  const e = entry({ id: "1", description: "Congresso — Convidados", channel: "Eventos / Empreitada", sourcePlatform: "Evento — Centro de Convenções" });

  it("busca sem diferenciar acento nem caixa, em descrição, canal e origem", () => {
    expect(matchesSearch(e, "CONVIDADOS")).toBe(true);
    expect(matchesSearch(e, "convenções")).toBe(true);
    expect(matchesSearch(e, "convencoes")).toBe(true);
    expect(matchesSearch(e, "empreitada")).toBe(true);
    expect(matchesSearch(e, "salão")).toBe(false);
  });

  it("acha pela data e pelo dia da semana", () => {
    expect(matchesSearch(e, "30/06")).toBe(true);
    expect(matchesSearch(e, "terça")).toBe(true);
  });

  it("busca vazia aceita tudo", () => {
    expect(matchesSearch(e, "   ")).toBe(true);
  });
});

describe("entryDetails", () => {
  it("lista só o que tem valor, na ordem de leitura", () => {
    const details = entryDetails(
      entry({ id: "1", salesFirstShift: 115.66, salesSecondShift: 0, serviceAmount: 24.15, paymentMethod: "PIX", notes: "Conferido" })
    );
    expect(details.map((item) => item.label)).toEqual(["1º turno", "Serviço", "Forma de recebimento", "Observações"]);
    expect(details[0]).toMatchObject({ kind: "money", value: 115.66 });
    expect(details[2]).toMatchObject({ kind: "text", value: "PIX" });
  });

  it("lançamento simples não tem detalhes", () => {
    expect(entryDetails(entry({ id: "1", grossAmount: 50 }))).toEqual([]);
  });
});
