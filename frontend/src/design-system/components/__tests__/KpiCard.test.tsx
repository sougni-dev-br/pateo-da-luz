import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { SessionContext } from "../../../context/SessionContext";
import type { SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../context/HideValuesContext";
import { KpiCard } from "../KpiCard";

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

describe("KpiCard", () => {
  test("renderiza label + value", () => {
    withProviders(<KpiCard label="Receita" value="R$ 128.450" />);
    expect(screen.getByText("Receita")).toBeInTheDocument();
  });

  test("barra de acento sempre renderiza (elemento .ds-kpi-card-accent)", () => {
    const { container } = withProviders(<KpiCard label="x" value="y" />);
    expect(container.querySelector(".ds-kpi-card-accent")).not.toBeNull();
  });

  test.each(["neutral", "success", "warning", "danger", "info"] as const)("aplica tone %s", (tone) => {
    const { container } = withProviders(<KpiCard label="x" value="y" tone={tone} />);
    expect(container.querySelector("article")?.className).toContain(`ds-kpi-card-${tone}`);
  });

  test("value em R$ delega para Money", () => {
    withProviders(<KpiCard label="x" value="R$ 128.450" />);
    expect(screen.getByText("R$").className).toBe("ds-money-cur");
  });

  test("respeita hideValues global no value monetario", () => {
    withProviders(<KpiCard label="x" value="R$ 100" />, { hideSensitiveValues: true });
    expect(screen.getByText("••••")).toBeInTheDocument();
  });

  test("sub renderiza quando fornecido", () => {
    withProviders(<KpiCard label="x" value="y" sub="vs mes anterior" />);
    expect(screen.getByText("vs mes anterior")).toBeInTheDocument();
  });

  test("chip renderiza quando icon fornecido", () => {
    withProviders(<KpiCard label="x" value="y" icon={<span data-testid="icn">i</span>} />);
    expect(screen.getByTestId("icn").parentElement?.className).toContain("ds-kpi-card-chip");
  });

  test("delta up aplica classe delta-up", () => {
    const { container } = withProviders(
      <KpiCard label="x" value="y" delta={{ text: "+8.4%", direction: "up" }} />
    );
    const pill = container.querySelector(".ds-kpi-card-delta");
    expect(pill?.className).toContain("ds-kpi-card-delta-up");
    expect(pill?.textContent).toContain("+8.4%");
  });

  test("delta down aplica classe delta-down", () => {
    const { container } = withProviders(
      <KpiCard label="x" value="y" delta={{ text: "-2.1%", direction: "down" }} />
    );
    expect(container.querySelector(".ds-kpi-card-delta")?.className).toContain("ds-kpi-card-delta-down");
  });

  test("delta flat aplica classe delta-flat", () => {
    const { container } = withProviders(
      <KpiCard label="x" value="y" delta={{ text: "0%", direction: "flat" }} />
    );
    expect(container.querySelector(".ds-kpi-card-delta")?.className).toContain("ds-kpi-card-delta-flat");
  });

  test("sparkline renderiza svg quando points >= 2", () => {
    const { container } = withProviders(<KpiCard label="x" value="y" sparkline={[1, 2, 3, 4]} />);
    expect(container.querySelector(".ds-kpi-card-sparkline")).not.toBeNull();
  });

  test("sparkline nao renderiza com menos de 2 pontos", () => {
    const { container } = withProviders(<KpiCard label="x" value="y" sparkline={[5]} />);
    expect(container.querySelector(".ds-kpi-card-sparkline")).toBeNull();
  });

  test("foot so renderiza se tem delta ou sparkline", () => {
    const { container } = withProviders(<KpiCard label="x" value="y" />);
    expect(container.querySelector(".ds-kpi-card-foot")).toBeNull();
  });
});
