import { render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import type { ReferenciaDaContagem as Referencia } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { ReferenciaDaContagem } from "../ReferenciaDaContagem";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

// Quem conta ve a mesma conta da conferencia: anterior + compras = disponivel.
const vinho: Referencia = {
  itemId: "i1", anterior: 5, anteriorData: "2026-08-31", anteriorCodigo: "INV-2026-0024", compras: 0, custoUnitario: 52.08
};

function texto() {
  return document.body.textContent?.replace(/\s+/g, " ") ?? "";
}

describe("ReferenciaDaContagem", () => {
  test("mostra anterior, compras, disponivel, contado e o valor", () => {
    render(<ReferenciaDaContagem referencia={vinho} unidade="UN" valorDigitado="4" isActive={false} mostrarValor />);
    expect(screen.getByText("Anterior · 31/08")).toBeTruthy();
    expect(screen.getByText("Disponível")).toBeTruthy();
    expect(texto()).toContain("4 UN");
    expect(texto()).toMatch(/208,32/);
    expect(document.querySelector(".ref-contagem__aviso")).toBeNull();
  });

  test("acima do disponivel avisa com a sobra e lembra da nota nao lancada", () => {
    render(<ReferenciaDaContagem referencia={vinho} unidade="UN" valorDigitado="11" isActive={false} mostrarValor />);
    const aviso = document.querySelector(".ref-contagem__aviso")?.textContent ?? "";
    expect(aviso).toContain("6 UN a mais do que havia");
    expect(aviso).toMatch(/312,48/);
    expect(aviso).toContain("a nota não foi lançada");
  });

  test("enquanto digita nao avisa", () => {
    render(<ReferenciaDaContagem referencia={vinho} unidade="UN" valorDigitado="11" isActive mostrarValor />);
    expect(document.querySelector(".ref-contagem__aviso")).toBeNull();
  });

  test("sem a permissao de custos nao mostra valor", () => {
    render(<ReferenciaDaContagem referencia={{ ...vinho, custoUnitario: null }} unidade="UN" valorDigitado="4" isActive={false} mostrarValor={false} />);
    expect(screen.queryByText("Valor")).toBeNull();
  });

  test("produto sem contagem aprovada diz que nao ha referencia", () => {
    render(<ReferenciaDaContagem referencia={{ ...vinho, anterior: null }} unidade="UN" valorDigitado="2" isActive={false} mostrarValor />);
    expect(screen.getByText("sem contagem aprovada")).toBeTruthy();
    expect(screen.queryByText("Disponível")).toBeNull();
  });
});
