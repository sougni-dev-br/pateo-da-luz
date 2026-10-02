import { fireEvent, render as renderRaw, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { LancamentoManualModal } from "../LancamentoManualModal";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

function Tela({ onFechar }: { onFechar: () => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)}>Lançar à mão</button>
      {aberto && <LancamentoManualModal employees={[]} year={2026} month={9} onLancado={vi.fn()} onFechar={() => { onFechar(); setAberto(false); }} />}
    </>
  );
}

describe("LancamentoManualModal — janela padrão", () => {
  test("Esc fecha, o foco entra na janela e volta para quem abriu", () => {
    const onFechar = vi.fn();
    render(<Tela onFechar={onFechar} />);
    const abrir = screen.getByRole("button", { name: "Lançar à mão" });
    abrir.focus();
    fireEvent.click(abrir);
    const janela = screen.getByRole("dialog", { name: "Lançar pagamento" });
    expect(janela.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(abrir);
  });
});
