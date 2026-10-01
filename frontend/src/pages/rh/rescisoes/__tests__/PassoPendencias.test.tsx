import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  deletePayrollItem: vi.fn(async () => ({ ok: true })),
}));

import { deletePayrollItem } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { PassoPendencias } from "../PassoPendencias";
import type { Pendencia } from "../pendencias";

let podeExcluir = true;
const sessao = () => ({
  user: { id: "u", name: "Eli", role: "GESTAO_COMPLETA", modulePermissions: { payroll: { view: true, create: true, edit: true, delete: podeExcluir, approve: false, admin: false } } },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined,
  canAccessSection: () => true, hasPermission: () => true,
}) as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={sessao()}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

const vt: Pendencia = {
  id: "folha-i1", tom: "acao", titulo: "VT para dias depois da saída", oQueFazer: "Exclua o lançamento.", valor: 120,
  acao: { tipo: "excluir", itemId: "i1", rotulo: "Excluir lançamento", motivoSugerido: "VT de dias depois da saída (saída em 12/09/2026)" },
};
const vales: Pendencia = { id: "vales", tom: "aviso", titulo: "1 vale em aberto", oQueFazer: "Entram no desconto.", acao: { tipo: "link", para: "/rh/gorjeta", rotulo: "Abrir aba Vales" } };
const termo: Pendencia = { id: "termo", tom: "acao", titulo: "Termo não importado", oQueFazer: "Importe.", acao: { tipo: "passo", passo: 2, rotulo: "Importar o termo" } };

beforeEach(() => {
  vi.clearAllMocks();
  podeExcluir = true;
});

describe("PassoPendencias", () => {
  test("sem pendências diz que está tudo em ordem", () => {
    render(<PassoPendencias pendencias={[]} onMudou={vi.fn()} onPasso={vi.fn()} />);
    expect(screen.getByText(/Nada pendente/)).toBeTruthy();
  });

  test("conta o que resolver e o que conferir, e cada pendência tem o seu atalho", () => {
    const onPasso = vi.fn();
    render(<PassoPendencias pendencias={[vt, termo, vales]} onMudou={vi.fn()} onPasso={onPasso} />);
    expect(screen.getByText(/2 para resolver · 1 para conferir/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Abrir aba Vales/ }).getAttribute("href")).toBe("/rh/gorjeta");
    fireEvent.click(screen.getByRole("button", { name: "Importar o termo" }));
    expect(onPasso).toHaveBeenCalledWith(2);
  });

  test("excluir pede motivo (já sugerido) e chama a exclusão da Folha", async () => {
    const onMudou = vi.fn();
    render(<PassoPendencias pendencias={[vt]} onMudou={onMudou} onPasso={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Excluir lançamento/ }));
    const motivo = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(motivo.value).toMatch(/saída em 12\/09\/2026/);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(deletePayrollItem).toHaveBeenCalledWith("i1", "VT de dias depois da saída (saída em 12/09/2026)"));
    expect(onMudou).toHaveBeenCalled();
  });

  test("motivo curto não exclui", () => {
    render(<PassoPendencias pendencias={[vt]} onMudou={vi.fn()} onPasso={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Excluir lançamento/ }));
    const motivo = screen.getByRole("textbox");
    fireEvent.change(motivo, { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    expect(screen.getByText(/pelo menos 3 letras/)).toBeTruthy();
    expect(deletePayrollItem).not.toHaveBeenCalled();
  });

  test("sem permissão de excluir na Folha o botão fica desabilitado", () => {
    podeExcluir = false;
    render(<PassoPendencias pendencias={[vt]} onMudou={vi.fn()} onPasso={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Excluir lançamento/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
