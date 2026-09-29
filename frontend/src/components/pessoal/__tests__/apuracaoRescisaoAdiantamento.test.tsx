import { render as renderRaw, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ApuracaoRescisao } from "../../../api/client";
import type { ReactElement } from "react";
import { HideValuesProvider } from "../../../design-system";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { ApuracaoRescisaoPainel } from "../ApuracaoRescisao";

const base: ApuracaoRescisao = {
  saida: "2026-09-22", semRegistro: true,
  vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
  vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
  gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 22, salarioProporcional: 1613.26 },
  gorjetaObservacao: null,
  sugestao: { salario: 1613.26, gorjeta: 186.8, creditos: 0, vales: 880, valesRotulo: "Adiantamento salarial 20/09", adiantamento: 880, vtDesconto: 0, bruto: 1800.06 },
  adiantamento: { valor: 880, data: "2026-09-20" },
};

// Money lê o contexto de ocultar valores, que lê a sessão.
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("apuração da rescisão: adiantamento salarial", () => {
  test("mostra o adiantamento já pago e o líquido já sem ele", () => {
    render(<ApuracaoRescisaoPainel apuracao={base} aberto />);
    expect(screen.getByText("Adiantamento salarial já pago")).toBeTruthy();
    expect(screen.getByText(/pago em 20\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/920,06/)).toBeTruthy(); // 1.800,06 − 880
  });

  test("sem adiantamento a linha não aparece", () => {
    render(<ApuracaoRescisaoPainel apuracao={{ ...base, adiantamento: null }} aberto />);
    expect(screen.queryByText("Adiantamento salarial já pago")).toBeNull();
  });
});
