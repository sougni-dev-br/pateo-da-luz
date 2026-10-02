import { render as renderRaw, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipConferencia: vi.fn(),
}));

import { type TipConferenciaCompleta, getTipConferencia } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaContabilidade } from "../AbaContabilidade";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const etapa = { marcada: false, em: null, por: null };

beforeEach(() => { window.localStorage.clear(); vi.clearAllMocks(); });

describe("conferência dos extratos sem permissão (pelo teto do IR)", () => {
  test("linha pelo teto sem o valor do extrato (ausente): mostra '—' e o total avisa que faltam os ocultos", async () => {
    vi.mocked(getTipConferencia).mockResolvedValue({
      code: "GOR-2026-09", status: "CLOSED", podeVerFolha: false, pendentes: 1,
      etapas: { estado: { ENVIADO_CONTABILIDADE: etapa, OK_CONTABILIDADE: etapa, FOLHA_PAGA: etapa } },
      extratos: [{ id: "x1", empresa: "Pateo Frei", cnpj: "1", arquivo: "a.pdf", hash: "h", importadoEm: "2026-10-01T10:00:00Z", importadoPor: "Eli", pessoas: 2 }],
      linhas: [
        { chave: "eli", employeeId: "eli", nome: "Teodoro Fictício", empresa: "Pateo Frei", apuracao: null, diferenca: null, status: "DIVERGE", justificativa: null, peloTeto: true },
        { chave: "ana", employeeId: "ana", nome: "Ana Souza", empresa: "Pateo Frei", apuracao: 500, extrato: 500, diferenca: 0, status: "OK", justificativa: null },
      ],
    } as unknown as TipConferenciaCompleta);
    render(<AbaContabilidade year={2026} month={9} canEdit={false} onNotice={vi.fn()} />);
    const eli = (await screen.findByText("Teodoro Fictício")).closest("tr")!;
    const celulas = within(eli).getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(celulas.filter((t) => t.startsWith("—")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/sem os valores ocultos/).length).toBeGreaterThan(0);
  });
});
