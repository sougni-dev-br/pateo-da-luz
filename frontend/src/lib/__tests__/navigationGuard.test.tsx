import { render } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NavigationGuardContext, useNavigationGuard, type NavGuardFn } from "../navigationGuard";

function Tela({ ativo }: { ativo: boolean }) {
  useNavigationGuard(ativo, "Sair sem salvar?");
  return null;
}

const montar = (ref: MutableRefObject<NavGuardFn | null>, ativo: boolean) =>
  render(<NavigationGuardContext.Provider value={ref}><Tela ativo={ativo} /></NavigationGuardContext.Provider>);

afterEach(() => vi.restoreAllMocks());

describe("aviso ao sair pelo menu", () => {
  test("sem mudanças não salvas, o menu navega sem perguntar", () => {
    const ref: MutableRefObject<NavGuardFn | null> = { current: null };
    montar(ref, false);
    expect(ref.current).toBeNull();
  });

  test("com mudanças, pergunta; a resposta decide se sai", () => {
    const ref: MutableRefObject<NavGuardFn | null> = { current: null };
    const confirmar = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    montar(ref, true);
    expect(ref.current?.()).toBe(false);
    expect(ref.current?.()).toBe(true);
    expect(confirmar).toHaveBeenCalledWith("Sair sem salvar?");
  });

  test("salvar (ativo volta a false) ou sair da tela desliga o aviso", () => {
    const ref: MutableRefObject<NavGuardFn | null> = { current: null };
    const { rerender, unmount } = montar(ref, true);
    expect(ref.current).not.toBeNull();
    rerender(<NavigationGuardContext.Provider value={ref}><Tela ativo={false} /></NavigationGuardContext.Provider>);
    expect(ref.current).toBeNull();
    rerender(<NavigationGuardContext.Provider value={ref}><Tela ativo /></NavigationGuardContext.Provider>);
    unmount();
    expect(ref.current).toBeNull();
  });
});
