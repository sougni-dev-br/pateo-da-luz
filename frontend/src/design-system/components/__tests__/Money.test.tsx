import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { SessionContext } from "../../../context/SessionContext";
import type { SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../context/HideValuesContext";
import { Money } from "../Money";

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

describe("Money", () => {
  test("formata valor positivo em pt-BR (milhar com ponto)", () => {
    const { container } = withProviders(<Money value={128450} />);
    expect(container.textContent).toBe("R$128.450");
    expect(screen.getByText("R$")).toBeInTheDocument();
  });

  test("preserva decimais com virgula em pt-BR (per spec DS)", () => {
    const { container } = withProviders(<Money value={1234.56} />);
    expect(container.textContent).toBe("R$1.234,56");
  });

  test("zero renderiza como R$ 0 (nao como travessao)", () => {
    const { container } = withProviders(<Money value={0} />);
    expect(container.textContent).toBe("R$0");
  });

  test("valor negativo tem sinal en-dash discreto antes do R$", () => {
    const { container } = withProviders(<Money value={-820} />);
    // U+2013 (en dash) + espaco + R$ + numero absoluto
    expect(container.textContent).toBe("– R$820");
  });

  test("null renderiza travessao em-dash", () => {
    const { container } = withProviders(<Money value={null} />);
    expect(container.textContent).toBe("—");
  });

  test("undefined renderiza travessao em-dash", () => {
    const { container } = withProviders(<Money value={undefined} />);
    expect(container.textContent).toBe("—");
  });

  test("prop hidden=true mascara com marcador", () => {
    const { container } = withProviders(<Money value={128450} hidden />);
    expect(container.textContent).toBe("••••");
    expect(screen.queryByText("R$")).not.toBeInTheDocument();
  });

  test("mascara quando SessionContext.hideSensitiveValues=true e prop omitida", () => {
    const { container } = withProviders(<Money value={128450} />, { hideSensitiveValues: true });
    expect(container.textContent).toBe("••••");
  });

  test("prop hidden=false sobrescreve context hidden=true", () => {
    const { container } = withProviders(<Money value={128450} hidden={false} />, {
      hideSensitiveValues: true
    });
    expect(container.textContent).toBe("R$128.450");
  });

  test("aceita className adicional preservando ds-money", () => {
    const { container } = withProviders(<Money value={100} className="kpi-value" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toBe("ds-money kpi-value");
  });

  test("R$ e discreto (span dedicado com classe ds-money-cur)", () => {
    withProviders(<Money value={100} />);
    const cur = screen.getByText("R$");
    expect(cur.className).toBe("ds-money-cur");
  });

  test("aria-label anuncia valor oculto quando mascarado", () => {
    const { container } = withProviders(<Money value={100} hidden />);
    expect(container.querySelector('[aria-label="valor oculto"]')).not.toBeNull();
  });

  test("nao explode se HideValuesContext ausente e contexto padrao esperado", () => {
    // useHideValues lanca fora de HideValuesProvider — comportamento intencional.
    // Silenciamos o console.error do React durante o assert.
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Money value={100} />)).toThrow();
    err.mockRestore();
  });
});
