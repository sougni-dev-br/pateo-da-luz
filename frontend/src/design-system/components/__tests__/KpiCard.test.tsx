import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
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

  test("string com R$ agora e literal (sem auto-delegacao)", () => {
    withProviders(<KpiCard label="x" value="R$ 128.450" />);
    expect(screen.getByText("R$ 128.450")).toBeInTheDocument();
    expect(screen.queryByText((_, el) => el?.className === "ds-money-cur")).toBeNull();
  });

  test("numero cru em value passa through como literal", () => {
    withProviders(<KpiCard label="x" value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("R$")).not.toBeInTheDocument();
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

  describe("moneyValue", () => {
    test("moneyValue=number renderiza via Money (R$ discreto)", () => {
      withProviders(<KpiCard label="x" value={undefined} moneyValue={128450} />);
      expect(screen.getByText("R$").className).toBe("ds-money-cur");
    });

    test("moneyValue respeita HideValuesContext (glifo R$ ••••)", () => {
      const { container } = withProviders(
        <KpiCard label="x" value={undefined} moneyValue={100} />,
        { hideSensitiveValues: true }
      );
      expect(container.textContent).toContain("R$");
      expect(container.textContent).toContain("••••");
    });

    test("moneyValue=null renderiza travessao via Money", () => {
      const { container } = withProviders(<KpiCard label="x" value={undefined} moneyValue={null} />);
      expect(container.textContent).toContain("—");
    });

    test("sem value E sem moneyValue: renderiza estrutura vazia sem crash", () => {
      const { container } = withProviders(<KpiCard label="x" />);
      const valueEl = container.querySelector(".ds-kpi-card-value");
      expect(valueEl).not.toBeNull();
      expect(valueEl?.textContent).toBe("");
    });

    test("moneyValue tem prioridade sobre value E warna em dev", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      withProviders(<KpiCard label="x" value="ignorado" moneyValue={200} />);
      expect(screen.queryByText("ignorado")).toBeNull();
      expect(screen.getByText("R$").className).toBe("ds-money-cur");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("moneyValue"));
      warn.mockRestore();
    });
  });
});
