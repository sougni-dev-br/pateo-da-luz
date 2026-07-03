import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
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

  test("string qualquer passa through como literal", () => {
    withProviders(<SummaryCard label="x" value="Ativo" />);
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.queryByText("R$")).not.toBeInTheDocument();
  });

  test("string iniciada em R$ agora e literal (sem auto-delegacao)", () => {
    withProviders(<SummaryCard label="x" value="R$ 128.450" />);
    // string bruta — nao ha mais span .ds-money-cur
    expect(screen.getByText("R$ 128.450")).toBeInTheDocument();
    expect(screen.queryByText((_, el) => el?.className === "ds-money-cur")).toBeNull();
  });

  test("numero cru passa through como contagem literal (nao vira Money)", () => {
    withProviders(<SummaryCard label="x" value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText("R$")).not.toBeInTheDocument();
  });

  test("icon renderiza no chip quando fornecido", () => {
    withProviders(<SummaryCard label="x" value="y" icon={<span data-testid="icn">i</span>} />);
    expect(screen.getByTestId("icn").parentElement?.className).toContain("ds-summary-card-chip");
  });

  test("chip nao renderiza sem icon", () => {
    const { container } = withProviders(<SummaryCard label="x" value="y" />);
    expect(container.querySelector(".ds-summary-card-chip")).toBeNull();
  });

  describe("moneyValue", () => {
    test("moneyValue=number renderiza via Money (R$ discreto)", () => {
      withProviders(<SummaryCard label="x" value={undefined} moneyValue={128450} />);
      expect(screen.getByText("R$").className).toBe("ds-money-cur");
    });

    test("moneyValue respeita HideValuesContext (glifo R$ ••••)", () => {
      const { container } = withProviders(
        <SummaryCard label="x" value={undefined} moneyValue={100} />,
        { hideSensitiveValues: true }
      );
      expect(container.textContent).toContain("R$");
      expect(container.textContent).toContain("••••");
    });

    test("moneyValue=null renderiza travessao via Money", () => {
      const { container } = withProviders(<SummaryCard label="x" value={undefined} moneyValue={null} />);
      expect(container.textContent).toContain("—");
    });

    test("moneyValue omitido → value manda (nao vira Money)", () => {
      withProviders(<SummaryCard label="x" value={42} />);
      expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.queryByText("R$")).not.toBeInTheDocument();
    });

    test("sem value E sem moneyValue: renderiza estrutura vazia sem crash", () => {
      const { container } = withProviders(<SummaryCard label="x" />);
      const valueEl = container.querySelector(".ds-summary-card-value");
      expect(valueEl).not.toBeNull();
      expect(valueEl?.textContent).toBe("");
    });

    test("moneyValue tem prioridade sobre value E warna em dev", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      withProviders(<SummaryCard label="x" value="ignorado" moneyValue={200} />);
      expect(screen.queryByText("ignorado")).toBeNull();
      expect(screen.getByText("R$").className).toBe("ds-money-cur");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("moneyValue"));
      warn.mockRestore();
    });
  });
});
