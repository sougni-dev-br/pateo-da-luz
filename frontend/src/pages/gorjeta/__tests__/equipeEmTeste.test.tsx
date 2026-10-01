import { render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipTeamMember } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipTeam: vi.fn(),
  getTipFunctions: vi.fn(),
  getTipCompanies: vi.fn(),
}));

import { getTipCompanies, getTipFunctions, getTipTeam } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaEquipe } from "../AbaEquipe";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

const membro = (over: Partial<TipTeamMember>): TipTeamMember => ({
  id: "m", firstName: "Pessoa", lastName: "Ficticia", displayName: null, isActive: true, sector: null, position: null,
  modality: "NAO_CLT", admissionDate: "2026-09-15T00:00:00.000Z", terminationDate: null, companyId: null,
  participaGorjeta: true, tipoGorjeta: "PONTOS", cotaFixaGorjeta: null, pontosExtra: null, pontosExtraMotivo: null, tipFunctionId: null,
  inicioGorjeta: null, ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getTipFunctions).mockResolvedValue([]);
  vi.mocked(getTipCompanies).mockResolvedValue([]);
});

describe("Equipe da gorjeta: quem está em teste", () => {
  test("participa sem a entrada na gorjeta: selo \"em teste (fora da gorjeta)\"; quem já entrou, não", async () => {
    vi.mocked(getTipTeam).mockResolvedValue([
      membro({ id: "a", firstName: "Nova", inicioGorjeta: null }),
      membro({ id: "b", firstName: "Antiga", inicioGorjeta: "2025-01-01T00:00:00.000Z" }),
    ]);
    render(<AbaEquipe canEdit onNotice={vi.fn()} onChanged={vi.fn()} />);
    const nova = (await screen.findByText("Nova Ficticia")).closest("tr")!;
    expect(nova.textContent).toContain("em teste (fora da gorjeta)");
    const antiga = screen.getByText("Antiga Ficticia").closest("tr")!;
    expect(antiga.textContent).not.toContain("em teste");
  });
});
