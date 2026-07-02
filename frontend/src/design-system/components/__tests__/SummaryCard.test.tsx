import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { SessionContext } from "../../../context/SessionContext";
import type { SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../context/HideValuesContext";
import { SummaryCard } from "../SummaryCard";

function withProviders(ui: ReactNode, sessionOverride: Partial<SessionContextValue> = {}) {
  const session: SessionContextValue = {
    user: null,
    setUser: () => undefined,
    hideSensitiveValues: false,
    toggleSensitiveValues: () => undefined,
    canAccessSection: () => true,
    hasPermission: () => true,
    ...sessionOverride
  };
  return render(
    <SessionContext.Provider value={session}>
      <HideValuesProvider>{ui}</HideValuesProvider>
    </SessionContext.Provider>
  );
}

describe("SummaryCard", () => {
  test("renderiza label + value + detail", () => {
    withProviders(<SummaryCard label="Total" value="R$ 128.450" detail="junho/2026" />);
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("junho/2026")).toBeInTheDocument();
  });

  test("tone neutral por padrao", () => {
    const { container } = withProviders(<SummaryCard label="x" value="y" />);
    expect(container.querySelector("article")?.className).toContain("ds-summary-card-neutral");
  });

  test.each(["success", "warning", "danger", "info"] as const)("aplica tone %s", (tone) => {
    const { container } = withProviders(<SummaryCard label="x" value="y" tone={tone} />);
    expect(container.querySelector("article")?.className).toContain(`ds-summary-card-${tone}`);
  });

  test("string iniciada em R$ delega para Money (renderiza cur discreto)", () => {
    withProviders(<SummaryCard label="x" value="R$ 128.450" />);
    // Money renderiza <span class="ds-money-cur">R$</span>
    expect(screen.getByText("R$").className).toBe("ds-money-cur");
  });

  test("string iniciada em '– R$' delega para Money com sinal", () => {
    const { container } = withProviders(<SummaryCard label="x" value="– R$ 820" />);
    // sinal en-dash discreto seguido de R$ discreto e 820
    expect(container.textContent).toContain("– R$820");
  });

  test("string qualquer passa through sem virar Money", () => {
    withProviders(<SummaryCard label="x" value="Ativo" />);
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.queryByText("R$")).not.toBeInTheDocument();
  });

  test("numero cru passa through", () => {
    withProviders(<SummaryCard label="x" value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  test("respeita hideValues global quando value monetario", () => {
    withProviders(<SummaryCard label="x" value="R$ 100" />, { hideSensitiveValues: true });
    expect(screen.getByText("••••")).toBeInTheDocument();
  });

  test("icon renderiza no chip quando fornecido", () => {
    withProviders(<SummaryCard label="x" value="y" icon={<span data-testid="icn">i</span>} />);
    expect(screen.getByTestId("icn").parentElement?.className).toContain("ds-summary-card-chip");
  });

  test("chip nao renderiza sem icon", () => {
    const { container } = withProviders(<SummaryCard label="x" value="y" />);
    expect(container.querySelector(".ds-summary-card-chip")).toBeNull();
  });
});
