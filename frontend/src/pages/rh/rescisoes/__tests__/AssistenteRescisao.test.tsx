import { act, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getRescisaoDetalhe: vi.fn(),
  getTerminationInfo: vi.fn(),
}));

import { type DetalheRescisao, type TerminationInfo, getRescisaoDetalhe, getTerminationInfo } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { AssistenteRescisao, type NumeroPasso } from "../AssistenteRescisao";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const ui = (employeeId: string | null, passo: NumeroPasso): ReactElement => (
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>
    <AssistenteRescisao employeeId={employeeId} passo={passo} lista={null} onEscolher={vi.fn()} onPasso={vi.fn()} onVoltar={vi.fn()} onMudou={vi.fn()} />
  </HideValuesProvider></SessionContext.Provider></MemoryRouter>
);

const detalhe = (employeeId: string, nome: string, saida: string | null): DetalheRescisao => ({
  pessoa: { employeeId, nome, apelido: null, empresa: null, semRegistro: true, saida, motivo: null, rescisao: null, termo: null },
  itensAposSaida: [], periodoGorjeta: null, extratoDoMes: null,
} as unknown as DetalheRescisao);
const info = { employee: { id: "x", name: "x", terminationDate: null, terminationReason: null }, vtItems: [], alreadyReleased: false, rescisaoId: null, apuracao: null, lancada: null } as unknown as TerminationInfo;

function adiado<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => { resolver = r; });
  return { promessa, resolver };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTerminationInfo).mockResolvedValue(info);
});

describe("AssistenteRescisao", () => {
  test("detalhe de outra pessoa que chega atrasado é ignorado", async () => {
    const daAna = adiado<DetalheRescisao>();
    vi.mocked(getRescisaoDetalhe).mockImplementation((id: string) =>
      id === "ana" ? daAna.promessa : Promise.resolve(detalhe("beto", "Beto Lima", "2026-09-20")));
    const { rerender } = renderRaw(ui("ana", 3));
    rerender(ui("beto", 3));
    expect(await screen.findByRole("heading", { name: /Beto Lima/ })).toBeInTheDocument();
    await act(async () => { daAna.resolver(detalhe("ana", "Ana Souza", "2026-09-10")); });
    expect(screen.getByRole("heading", { name: /Beto Lima/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Ana Souza/ })).toBeNull();
  });

  test("passo 4 sem data de saída não monta o lançamento: manda para o passo 1", async () => {
    vi.mocked(getRescisaoDetalhe).mockResolvedValue(detalhe("ana", "Ana Souza", null));
    renderRaw(ui("ana", 4));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ana Souza/ })).toBeInTheDocument());
    expect(screen.getByText(/Sem data de saída/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Liberar para Contas a Pagar|Lançar como quitada/ })).toBeNull();
  });

  test("pessoa desmarcada com a carga no ar: o \"carregando\" não fica preso", async () => {
    const daAna = adiado<DetalheRescisao>();
    vi.mocked(getRescisaoDetalhe).mockImplementation(() => daAna.promessa);
    const { rerender } = renderRaw(ui("ana", 1));
    expect(screen.getByText("Carregando a rescisão…")).toBeInTheDocument();
    rerender(ui(null, 1));
    await waitFor(() => expect(screen.queryByText("Carregando a rescisão…")).toBeNull());
    await act(async () => { daAna.resolver(detalhe("ana", "Ana Souza", "2026-09-10")); });
    expect(screen.queryByText("Carregando a rescisão…")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Ana Souza/ })).toBeNull();
  });

  test("passo 3 não mostra pendências de detalhe que não é da pessoa escolhida", async () => {
    vi.mocked(getRescisaoDetalhe).mockResolvedValue(detalhe("ana", "Ana Souza", "2026-09-10"));
    renderRaw(ui("beto", 3));
    await waitFor(() => expect(getRescisaoDetalhe).toHaveBeenCalledWith("beto"));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("heading", { name: /Pendências antes de lançar/ })).toBeNull();
  });

  test("passo 3 com o detalhe da própria pessoa mostra as pendências", async () => {
    vi.mocked(getRescisaoDetalhe).mockResolvedValue(detalhe("beto", "Beto Lima", "2026-09-20"));
    renderRaw(ui("beto", 3));
    expect(await screen.findByRole("heading", { name: /Pendências antes de lançar/ })).toBeInTheDocument();
  });
});
