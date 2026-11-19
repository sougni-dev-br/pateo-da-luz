import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation, TipMudanca } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../../api/client")>()), getTipChanges: vi.fn() }));

import { getTipChanges } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { MudancasDoCiclo } from "../MudancasDoCiclo";

const COMP = {
  periodStart: "2026-10-26T00:00:00.000Z", periodEnd: "2026-11-25T00:00:00.000Z",
  participants: [{ employeeId: "e", functionName: "Garçom", basePoints: 4 }],
} as unknown as TipComputation;

// Dados fictícios.
const mud = (over: Partial<TipMudanca>): TipMudanca => ({
  id: "m1", employeeId: "e", employeeName: "Ana Ficticia", apelido: null, validFrom: "2026-11-01T00:00:00.000Z", tipo: "PROMOCAO",
  funcaoAntes: "Garçom", funcaoDepois: "Garçom", baseAntes: 3.5, baseDepois: 4, diferenca: 0.5, participa: true, motivo: "Líder de turno",
  registradoEm: "2026-11-02T15:00:00.000Z", registradoPor: "Eli", ...over,
});

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const abrir = () => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider><MudancasDoCiclo comp={COMP} /></HideValuesProvider></SessionContext.Provider>,
);

beforeEach(() => vi.resetAllMocks());

describe("MudancasDoCiclo", () => {
  test("busca as mudanças do ciclo e mostra quem, o quê, desde quando, por quem e por quê", async () => {
    vi.mocked(getTipChanges).mockResolvedValue([mud({})]);
    abrir();
    expect(await screen.findByText("Mudanças de função e pontos neste ciclo (1)")).toBeInTheDocument();
    expect(getTipChanges).toHaveBeenCalledWith("2026-10-26", "2026-11-25");
    expect(screen.getByText("Promoção: 3,5 → 4 pts")).toBeInTheDocument();
    expect(screen.getByText(/vale desde 01\/11\/2026 · registrada por Eli em 02\/11\/2026 · Líder de turno/)).toBeInTheDocument();
  });

  test("sem mudanças no ciclo, não ocupa a tela", async () => {
    vi.mocked(getTipChanges).mockResolvedValue([mud({ tipo: "INICIAL" }), mud({ id: "x", validFrom: "2026-09-01T00:00:00.000Z" })]);
    const { container } = abrir();
    await waitFor(() => expect(getTipChanges).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
  });

  test("avisa quando alguma foi lançada depois do fim do ciclo", async () => {
    vi.mocked(getTipChanges).mockResolvedValue([mud({ registradoEm: "2026-11-28T15:00:00.000Z" })]);
    abrir();
    expect(await screen.findByText("1 lançada depois do fim do ciclo")).toBeInTheDocument();
  });

  test("se a busca falhar, diz que não conseguiu em vez de sumir", async () => {
    vi.mocked(getTipChanges).mockRejectedValue(new Error("fora do ar"));
    abrir();
    expect(await screen.findByText(/Não consegui carregar as mudanças/)).toBeInTheDocument();
  });
});
