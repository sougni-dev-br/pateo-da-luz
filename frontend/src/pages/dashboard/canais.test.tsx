import { render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import type { DashboardChannelRevenue } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { CanaisPanel, descreverUltimoLancamento } from "./CanaisPanel";

const sessao = {
  user: null,
  setUser: () => undefined,
  hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined,
  canAccessSection: () => true,
  hasPermission: () => true,
} as unknown as SessionContextValue;

const render = (ui: ReactElement) =>
  renderRaw(
    <SessionContext.Provider value={sessao}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>,
  );

// Valores fictícios.
const canal = (p: Partial<DashboardChannelRevenue>): DashboardChannelRevenue => ({
  canal: "Keeta",
  grossAmount: 1000,
  netAmount: 800,
  sharePercent: 40,
  count: 5,
  ultimoDia: "2026-10-21",
  diaFuturo: null,
  situacao: "EM_DIA",
  diasDesdeUltimo: 2,
  ...p,
});

describe("descreverUltimoLancamento", () => {
  test("mostra o último dia lançado em dia/mês", () => {
    expect(descreverUltimoLancamento(canal({}))).toEqual({ texto: "Último lançamento 21/10", tone: "ok" });
  });

  test("avisa o atraso quando o servidor marca o canal como atrasado", () => {
    const r = descreverUltimoLancamento(canal({ situacao: "ATRASADO", diasDesdeUltimo: 4 }));
    expect(r.tone).toBe("late");
    expect(r.texto).toContain("atrasado há 4 dias");
  });

  test("em mês passado (sem situação) mostra só o último dia, sem cobrar atraso", () => {
    expect(descreverUltimoLancamento(canal({ situacao: null, diasDesdeUltimo: null })).tone).toBe("ok");
  });

  test("lançamento mensal gravado no fim do mês é dito parcial, e não como último dia", () => {
    const r = descreverUltimoLancamento(canal({ ultimoDia: null, diaFuturo: "2026-10-31" }));
    expect(r.texto).toBe("Lançamento mensal parcial, gravado em 31/10");
  });

  test("canal sem nada no mês", () => {
    expect(descreverUltimoLancamento(canal({ ultimoDia: null, count: 0, situacao: "SEM_DADOS" }))).toEqual({
      texto: "Sem lançamento neste mês",
      tone: "none",
    });
  });
});

describe("CanaisPanel", () => {
  test("lista cada canal com valor e situação, inclusive o que não lançou", () => {
    render(
      <CanaisPanel
        channels={[
          canal({ canal: "Salão", netAmount: 5000, sharePercent: 80 }),
          canal({ canal: "iFood", netAmount: 0, count: 0, sharePercent: 0, ultimoDia: null, situacao: "SEM_DADOS" }),
        ]}
      />,
    );
    expect(screen.getByText("Salão")).toBeTruthy();
    expect(screen.getByText("iFood")).toBeTruthy();
    expect(screen.getByText("Sem lançamento neste mês")).toBeTruthy();
    expect(screen.getByText(/5\.000,00/)).toBeTruthy();
  });
});
