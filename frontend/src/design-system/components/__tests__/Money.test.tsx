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
  test("formata valor positivo em pt-BR com 2 decimais sempre", () => {
    const { container } = withProviders(<Money value={128450} />);
    expect(container.textContent).toBe("R$128.450,00");
    expect(screen.getByText("R$")).toBeInTheDocument();
  });

  test("preserva decimais com virgula em pt-BR (per spec DS)", () => {
    const { container } = withProviders(<Money value={1234.56} />);
    expect(container.textContent).toBe("R$1.234,56");
  });

  test("decimal parcial completa 2 casas: 2760.5 -> R$ 2.760,50", () => {
    const { container } = withProviders(<Money value={2760.5} />);
    expect(container.textContent).toBe("R$2.760,50");
  });

  test("decimal parcial completa 2 casas: 1840.5 -> R$ 1.840,50", () => {
    const { container } = withProviders(<Money value={1840.5} />);
    expect(container.textContent).toBe("R$1.840,50");
  });

  test("prop decimals=0 para displays compactos", () => {
    const { container } = withProviders(<Money value={128450.75} decimals={0} />);
    expect(container.textContent).toBe("R$128.451");
  });

  test("zero renderiza como R$ 0,00 (nao como travessao)", () => {
    const { container } = withProviders(<Money value={0} />);
    expect(container.textContent).toBe("R$0,00");
  });

  test("valor negativo tem sinal en-dash discreto antes do R$", () => {
    const { container } = withProviders(<Money value={-820} />);
    // U+2013 (en dash) + espaco + R$ + numero absoluto
    expect(container.textContent).toBe("– R$820,00");
  });

  test("nao quebra linha em container estreito (nowrap + inline-block)", () => {
    const { container } = withProviders(
      <div style={{ width: 60 }}>
        <Money value={2760.5} />
      </div>
    );
    const money = container.querySelector(".ds-money") as HTMLElement;
    const style = window.getComputedStyle(money);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.display).toBe("inline-block");
    expect(style.textOverflow).toBe("ellipsis");
  });

  test("null renderiza travessao em-dash", () => {
    const { container } = withProviders(<Money value={null} />);
    expect(container.textContent).toBe("—");
  });

  test("undefined renderiza travessao em-dash", () => {
    const { container } = withProviders(<Money value={undefined} />);
    expect(container.textContent).toBe("—");
  });

  test("prop hidden=true mascara com marcador (glifo canonico R$ ••••)", () => {
    const { container } = withProviders(<Money value={128450} hidden />);
    expect(container.textContent).toBe("R$••••");
    // R$ discreto continua presente para sinalizar "isso é moeda oculta"
    expect(screen.getByText("R$").className).toBe("ds-money-cur");
  });

  test("mascara quando SessionContext.hideSensitiveValues=true e prop omitida", () => {
    const { container } = withProviders(<Money value={128450} />, { hideSensitiveValues: true });
    expect(container.textContent).toBe("R$••••");
  });

  test("prop hidden=false sobrescreve context hidden=true", () => {
    const { container } = withProviders(<Money value={128450} hidden={false} />, {
      hideSensitiveValues: true
    });
    expect(container.textContent).toBe("R$128.450,00");
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
