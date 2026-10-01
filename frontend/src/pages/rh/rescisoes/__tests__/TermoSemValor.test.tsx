import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  registrarTermoSemValor: vi.fn(),
}));

import { type TermoSemValorPrevia, registrarTermoSemValor } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { TermoSemValor } from "../TermoSemValor";

const sessao = {
  user: { id: "u", name: "Eli", role: "GESTAO_COMPLETA" }, setUser: () => undefined, hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={sessao}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

const previa = (over: Partial<TermoSemValorPrevia> = {}): TermoSemValorPrevia => ({
  employeeId: "e1", nome: "Maria Silva", nomeNoTermo: "MARIA SILVA", arquivo: "termo.pdf", hash: "abc",
  admissao: "2026-07-21", afastamento: "2026-09-03", pagamento: "2026-09-11", liquido: 0, totalBruto: 812.4, gorjeta: null,
  divergencias: [], podeQuitar: true, recusa: null, ...over,
});

async function enviarPdf(container: HTMLElement) {
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  const arquivo = new File(["%PDF-1.4 teste"], "termo.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [arquivo] } });
}

beforeEach(() => vi.clearAllMocks());

describe("TermoSemValor", () => {
  test("líquido zero: mostra a prévia, pede confirmação e marca como quitada", async () => {
    vi.mocked(registrarTermoSemValor)
      .mockResolvedValueOnce({ previa: previa(), aplicado: false })
      .mockResolvedValueOnce({ previa: previa(), aplicado: true, item: { id: "q1", competencia: "09/2026", pagamento: "2026-09-11" } });
    const onQuitou = vi.fn();
    const { container } = render(<TermoSemValor employeeId="e1" nome="Maria Silva" onQuitou={onQuitou} onLancarNormal={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Enviar o termo/ })).toBeInTheDocument();
    await enviarPdf(container);

    expect(await screen.findByText("MARIA SILVA")).toBeInTheDocument();
    expect(screen.getByText("11/09/2026")).toBeInTheDocument();
    expect(vi.mocked(registrarTermoSemValor).mock.calls[0]).toEqual(["e1", expect.stringContaining("base64"), "termo.pdf", false]);

    fireEvent.click(screen.getByRole("button", { name: "Marcar como quitada no termo" }));
    // Confirmação simples antes de gravar.
    expect(registrarTermoSemValor).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar: quitada no termo" }));

    await waitFor(() => expect(onQuitou).toHaveBeenCalled());
    expect(vi.mocked(registrarTermoSemValor).mock.calls[1][3]).toBe(true);
  });

  test("líquido maior que zero: explica e leva para o lançamento normal, sem botão de quitar", async () => {
    vi.mocked(registrarTermoSemValor).mockResolvedValueOnce({
      previa: previa({ liquido: 458.36, podeQuitar: false, recusa: "O termo tem líquido de R$ 458,36: há o que pagar. Lance a rescisão normal no passo 4." }),
      aplicado: false,
    });
    const onLancarNormal = vi.fn();
    const { container } = render(<TermoSemValor employeeId="e1" nome="Maria Silva" onQuitou={vi.fn()} onLancarNormal={onLancarNormal} />);
    await enviarPdf(container);

    expect(await screen.findByText(/há o que pagar/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como quitada no termo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Lançar a rescisão \(passo 4\)/ }));
    expect(onLancarNormal).toHaveBeenCalled();
  });

  test("termo de outra pessoa: mostra o erro do servidor", async () => {
    vi.mocked(registrarTermoSemValor).mockRejectedValueOnce(new Error("Este termo é de JOSE, não de Maria Silva. Escolha o PDF certo."));
    const { container } = render(<TermoSemValor employeeId="e1" nome="Maria Silva" onQuitou={vi.fn()} onLancarNormal={vi.fn()} />);
    await enviarPdf(container);
    expect(await screen.findByText(/Este termo é de JOSE/)).toBeInTheDocument();
  });
});
