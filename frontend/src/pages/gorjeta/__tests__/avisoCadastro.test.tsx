import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipPreviaCadastro } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipSyncPreview: vi.fn(),
}));

import { getTipSyncPreview } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AvisoCadastro } from "../AvisoCadastro";

const previa = (over: Partial<TipPreviaCadastro> = {}): TipPreviaCadastro => ({
  diferencas: [], foraDoRateio: [], desligadosComParticipaMarcado: 0, ...over,
});
const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const montar = (extra: Partial<React.ComponentProps<typeof AvisoCadastro>> = {}) => render(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider>
    <AvisoCadastro periodId="p1" versao={1} ocupado={false} podeAtualizar onAtualizar={vi.fn()} {...extra} />
  </HideValuesProvider></SessionContext.Provider>,
);

beforeEach(() => { vi.mocked(getTipSyncPreview).mockReset(); });

describe("AvisoCadastro", () => {
  test("cadastro igual ao período e ninguém fora: não mostra nada", async () => {
    vi.mocked(getTipSyncPreview).mockResolvedValue(previa());
    const { container } = montar();
    await waitFor(() => expect(getTipSyncPreview).toHaveBeenCalledWith("p1"));
    expect(container.textContent).toBe("");
  });

  test("lista o que mudou no cadastro e o botão chama a atualização", async () => {
    vi.mocked(getTipSyncPreview).mockResolvedValue(previa({
      diferencas: [{ employeeId: "a", nome: "Bruno", tipo: "INCLUIR", detalhe: "entra no rateio com 3,5 pts (Atendimento)" }],
    }));
    const onAtualizar = vi.fn();
    montar({ onAtualizar });
    expect(await screen.findByText(/O cadastro mudou desde a última atualização \(1\)/)).toBeTruthy();
    expect(screen.getByText(/entra no rateio com 3,5 pts/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar agora/ }));
    expect(onAtualizar).toHaveBeenCalledOnce();
  });

  test("sem permissão de editar não oferece o botão", async () => {
    vi.mocked(getTipSyncPreview).mockResolvedValue(previa({
      diferencas: [{ employeeId: "a", nome: "Bruno", tipo: "PONTOS", detalhe: "pontos-base 3,5 → 3" }],
    }));
    montar({ podeAtualizar: false });
    await screen.findByText(/O cadastro mudou/);
    expect(screen.queryByRole("button", { name: /Atualizar agora/ })).toBeNull();
  });

  test("fora do rateio fica recolhido e abre com os motivos e o aviso dos desligados antigos", async () => {
    vi.mocked(getTipSyncPreview).mockResolvedValue(previa({
      foraDoRateio: [{ employeeId: "r", nome: "Rafa", soSalario: true, motivo: "\"Participa da gorjeta\" está desmarcado no cadastro. Recebe só o salário." }],
      desligadosComParticipaMarcado: 7,
    }));
    montar();
    const botao = await screen.findByRole("button", { name: /Fora do rateio neste ciclo \(1\)/ });
    expect(screen.queryByText(/Recebe só o salário/)).toBeNull();
    fireEvent.click(botao);
    expect(screen.getByText(/Recebe só o salário/)).toBeTruthy();
    expect(screen.getByText(/7 desligado\(s\) de ciclos anteriores/)).toBeTruthy();
  });

  test("falha ao ler a prévia não atrapalha a tela", async () => {
    vi.mocked(getTipSyncPreview).mockRejectedValue(new Error("rede"));
    const { container } = montar();
    await waitFor(() => expect(getTipSyncPreview).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
