import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { SessionContext } from "../../../context/SessionContext";
import type { SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider, useHideValues } from "../HideValuesContext";

function makeSession(overrides: Partial<SessionContextValue> = {}): SessionContextValue {
  return {
    user: null,
    setUser: () => undefined,
    hideSensitiveValues: false,
    toggleSensitiveValues: () => undefined,
    canAccessSection: () => true,
    hasPermission: () => true,
    ...overrides
  };
}

function Providers({ session, children }: { session: SessionContextValue; children: ReactNode }) {
  return (
    <SessionContext.Provider value={session}>
      <HideValuesProvider>{children}</HideValuesProvider>
    </SessionContext.Provider>
  );
}

describe("HideValuesContext", () => {
  test("expoe hidden=false quando SessionContext.hideSensitiveValues=false", () => {
    function Probe() {
      const { hidden } = useHideValues();
      return <span data-testid="probe">{String(hidden)}</span>;
    }
    render(
      <Providers session={makeSession({ hideSensitiveValues: false })}>
        <Probe />
      </Providers>
    );
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });

  test("expoe hidden=true quando SessionContext.hideSensitiveValues=true", () => {
    function Probe() {
      const { hidden } = useHideValues();
      return <span data-testid="probe">{String(hidden)}</span>;
    }
    render(
      <Providers session={makeSession({ hideSensitiveValues: true })}>
        <Probe />
      </Providers>
    );
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  test("toggle chama toggleSensitiveValues do SessionContext", () => {
    const toggleSpy = vi.fn();
    function Trigger() {
      const { toggle } = useHideValues();
      return <button onClick={toggle}>toggle</button>;
    }
    render(
      <Providers session={makeSession({ toggleSensitiveValues: toggleSpy })}>
        <Trigger />
      </Providers>
    );
    act(() => {
      screen.getByRole("button").click();
    });
    expect(toggleSpy).toHaveBeenCalledTimes(1);
  });

  test("mudanca em SessionContext propaga para consumidores do HideValues", () => {
    function TestApp() {
      const [hide, setHide] = useState(false);
      const session = makeSession({
        hideSensitiveValues: hide,
        toggleSensitiveValues: () => setHide((h) => !h)
      });
      return (
        <SessionContext.Provider value={session}>
          <HideValuesProvider>
            <Probe />
          </HideValuesProvider>
        </SessionContext.Provider>
      );
    }
    function Probe() {
      const { hidden, toggle } = useHideValues();
      return (
        <div>
          <span data-testid="probe">{String(hidden)}</span>
          <button onClick={toggle}>t</button>
        </div>
      );
    }
    render(<TestApp />);
    expect(screen.getByTestId("probe").textContent).toBe("false");
    act(() => {
      screen.getByRole("button").click();
    });
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  test("useHideValues lanca fora de HideValuesProvider", () => {
    // React loga o erro tambem — silenciar console para nao poluir output do vitest.
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useHideValues())).toThrow(
      /useHideValues deve ser usado dentro de HideValuesProvider/
    );
    err.mockRestore();
  });
});
