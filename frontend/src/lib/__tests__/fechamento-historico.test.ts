import { describe, expect, test } from "vitest";
import type { EventoDoHistorico, MonthlyClosureState } from "../../api/client";
import { descreverEvento, rotuloDoMes } from "../fechamento-historico";

const estado = {
  cards: { cartoes: [{ id: "c1", name: "Visa", last4Digits: "1234" }], faturas: [] },
  requiredSuppliers: []
} as unknown as MonthlyClosureState;

const evento = (parcial: Partial<EventoDoHistorico> & { acao: EventoDoHistorico["acao"] }): EventoDoHistorico => ({
  id: "e1",
  em: "2026-10-21T15:30:00.000Z", // 12:30 em São Paulo
  porNome: "Eli",
  blockKey: null,
  texto: null,
  ...parcial
});

describe("descreverEvento", () => {
  test("justificativa de cartão traz o nome do cartão e o motivo", () => {
    const d = descreverEvento(evento({ acao: "JUSTIFICOU", blockKey: "card:c1", texto: "Não usado." }), estado);
    expect(d.rotulo).toBe("Justificativa registrada");
    expect(d.alvo).toBe("Cartão Visa (final 1234)");
    expect(d.texto).toBe("Não usado.");
    expect(d.tom).toBe("neutro");
  });

  test("eventos lançados viram 'conferência', não justificativa", () => {
    const d = descreverEvento(evento({ acao: "JUSTIFICOU", blockKey: "block:eventRevenue", texto: "Conferi." }), estado);
    expect(d.rotulo).toBe("Conferência registrada");
    expect(d.alvo).toBe("Eventos / empreitada");
  });

  test("remoção distingue conferência de justificativa", () => {
    expect(descreverEvento(evento({ acao: "REMOVEU_JUSTIFICATIVA", blockKey: "block:taxes" }), estado).rotulo)
      .toBe("Justificativa removida");
    expect(descreverEvento(evento({ acao: "REMOVEU_JUSTIFICATIVA", blockKey: "block:eventRevenue" }), estado).rotulo)
      .toBe("Conferência removida");
  });

  test("remover é destacado: apaga algo que sustentava o fechamento", () => {
    expect(descreverEvento(evento({ acao: "REMOVEU_JUSTIFICATIVA", blockKey: "block:taxes" }), estado).tom).toBe("alerta");
  });

  test("travar e reabrir não têm alvo; reabrir mostra o motivo", () => {
    const travou = descreverEvento(evento({ acao: "TRAVOU" }), estado);
    expect(travou.rotulo).toBe("Mês travado");
    expect(travou.alvo).toBeNull();
    expect(travou.tom).toBe("positivo");

    const reabriu = descreverEvento(evento({ acao: "REABRIU", texto: "Nota atrasada." }), estado);
    expect(reabriu.rotulo).toBe("Mês reaberto");
    expect(reabriu.texto).toBe("Nota atrasada.");
    expect(reabriu.tom).toBe("alerta");
  });

  test("quem fez e quando, no horário de São Paulo", () => {
    const d = descreverEvento(evento({ acao: "TRAVOU" }), estado);
    expect(d.por).toBe("Eli");
    expect(d.quando).toBe("21/10/2026 12:30");
  });

  test("usuário removido do sistema aparece como traço", () => {
    expect(descreverEvento(evento({ acao: "TRAVOU", porNome: null }), estado).por).toBe("—");
  });

  test("justificativa sem chave não quebra", () => {
    const d = descreverEvento(evento({ acao: "JUSTIFICOU", blockKey: null }), estado);
    expect(d.alvo).toBeNull();
  });
});

describe("rotuloDoMes", () => {
  test("mês por extenso, em português", () => {
    expect(rotuloDoMes(2026, 9)).toBe("Setembro / 2026");
    expect(rotuloDoMes(2027, 1)).toBe("Janeiro / 2027");
  });
});
