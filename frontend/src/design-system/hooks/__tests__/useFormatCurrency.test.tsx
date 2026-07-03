import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { SessionContext } from "../../../context/SessionContext";
import type { SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../context/HideValuesContext";
import { useFormatCurrency } from "../useFormatCurrency";

// Intl.NumberFormat pt-BR insere NBSP (U+00A0) entre "R$" e o numero.
// Os asserts abaixo usam NBSP explicito para evitar falso-negativo visual.
const NBSP = " ";
const ZERO = `R$${NBSP}0,00`;
const MASKED = "R$ ••••"; // HIDDEN_GLYPH do hook usa espaco regular (literal)

function wrapperFactory(hideSensitiveValues = false) {
  const session: SessionContextValue = {
    user: null,
    setUser: () => undefined,
    hideSensitiveValues,
    toggleSensitiveValues: () => undefined,
    canAccessSection: () => true,
    hasPermission: () => true
  };
  return ({ children }: { children: ReactNode }) => (
    <SessionContext.Provider value={session}>
      <HideValuesProvider>{children}</HideValuesProvider>
    </SessionContext.Provider>
  );
}

function callFmt(value: Parameters<ReturnType<typeof useFormatCurrency>>[0], hideSensitiveValues = false) {
  const { result } = renderHook(() => useFormatCurrency(), {
    wrapper: wrapperFactory(hideSensitiveValues)
  });
  return result.current(value);
}

describe("useFormatCurrency", () => {
  describe("input valido", () => {
    test("number positivo formata pt-BR com 2 casas", () => {
      expect(callFmt(1234.5)).toBe(`R$${NBSP}1.234,50`);
    });

    test("number zero", () => {
      expect(callFmt(0)).toBe(ZERO);
    });

    test("string numerica (Prisma Decimal serializado)", () => {
      expect(callFmt("1234.5")).toBe(`R$${NBSP}1.234,50`);
    });

    test("string '0'", () => {
      expect(callFmt("0")).toBe(ZERO);
    });

    test("number negativo formata com sinal", () => {
      const out = callFmt(-820);
      expect(out).toContain("820,00");
      expect(out.startsWith("-")).toBe(true);
    });

    test("string negativa formata com sinal", () => {
      const out = callFmt("-820");
      expect(out).toContain("820,00");
      expect(out.startsWith("-")).toBe(true);
    });
  });

  describe("fallback para R$ 0,00", () => {
    test("null", () => {
      expect(callFmt(null)).toBe(ZERO);
    });

    test("undefined", () => {
      expect(callFmt(undefined)).toBe(ZERO);
    });

    test("NaN", () => {
      expect(callFmt(NaN)).toBe(ZERO);
    });

    test("Infinity", () => {
      expect(callFmt(Infinity)).toBe(ZERO);
    });

    test("-Infinity", () => {
      expect(callFmt(-Infinity)).toBe(ZERO);
    });

    test("string vazia", () => {
      expect(callFmt("")).toBe(ZERO);
    });

    test("string whitespace", () => {
      expect(callFmt("   ")).toBe(ZERO);
    });

    test("string nao-numerica", () => {
      expect(callFmt("abc")).toBe(ZERO);
    });
  });

  describe("mascaramento tem precedencia", () => {
    test("hidden=true + number valido → R$ ••••", () => {
      expect(callFmt(1234.5, true)).toBe(MASKED);
    });

    test("hidden=true + null → R$ •••• (precedencia sobre fallback)", () => {
      expect(callFmt(null, true)).toBe(MASKED);
    });

    test("hidden=true + string invalida → R$ •••• (precedencia sobre normalize)", () => {
      expect(callFmt("abc", true)).toBe(MASKED);
    });
  });
});
