import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FichaCadastralDetalhe as Detalhe } from "../../../../api/client";
import { ToastProvider } from "../../../../components/ui";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  getFichaCadastral: vi.fn(),
  salvarEmpresaFichaCadastral: vi.fn(),
  concluirFichaCadastral: vi.fn(),
  getArquivoFichaCadastral: vi.fn(async () => new Blob()),
}));

import { concluirFichaCadastral, getFichaCadastral, salvarEmpresaFichaCadastral } from "../../../../api/client";
import { FichaCadastralDetalhe } from "../FichaCadastralDetalhe";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const VISTA = "2026-10-04T12:00:00.000Z";

// Pessoa fictícia; atualização com uma diferença (nome da mãe) e o CPF trocado (desmarcado).
const ficha = (over: Partial<Detalhe> = {}) => ({
  id: "f1", tipo: "ATUALIZACAO", status: "FINALIZADA", nomeReferencia: "Joana Exemplo", employeeId: "e1", updatedAt: VISTA,
  expiraEm: "2026-10-10T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", canceladaEm: null, finalizadaEm: "2026-10-03T00:00:00.000Z",
  dados: { nomeCompleto: "Joana Exemplo" }, dadosEmpresa: {}, arquivos: [], funcionario: { id: "e1", nome: "Joana Exemplo", isActive: true },
  diferencas: [
    { campo: "nomeMae", rotulo: "Nome da mãe", atual: null, novo: "Maria Exemplo" },
    { campo: "cpf", rotulo: "CPF", atual: "529.982.247-25", novo: "123.456.789-09" },
  ],
  filhosNovos: [], filhosAlterados: [], falta: [], empresas: [], opcoes: { tiposArquivo: {}, rotulos: {} },
  bloqueadoAte: null, salarioOculto: false, motivoDevolucao: null, ...over,
}) as unknown as Detalhe;

const montar = () => render(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><ToastProvider><FichaCadastralDetalhe id="f1" onVoltar={() => undefined} /></ToastProvider></SessionContext.Provider></MemoryRouter>,
);

describe("conferência: concluir", () => {
  beforeEach(() => {
    vi.mocked(getFichaCadastral).mockReset().mockResolvedValue(ficha());
    vi.mocked(salvarEmpresaFichaCadastral).mockReset().mockResolvedValue({ ok: true, versao: "2026-10-04T12:01:00.000Z" });
    vi.mocked(concluirFichaCadastral).mockReset().mockResolvedValue({ ok: true, employeeId: "e1" });
  });

  test("salva a parte da empresa com a versão vista e conclui com a versão devolvida; CPF desmarcado não vai", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Gravar no cadastro" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gravar" }));
    await waitFor(() => expect(concluirFichaCadastral).toHaveBeenCalled());
    expect(salvarEmpresaFichaCadastral).toHaveBeenCalledWith("f1", expect.anything(), VISTA);
    expect(concluirFichaCadastral).toHaveBeenCalledWith("f1", "2026-10-04T12:01:00.000Z", ["nomeMae"]);
  });

  test("nada marcado: 'Concluir sem gravar', e nada vai para o cadastro", async () => {
    vi.mocked(getFichaCadastral).mockResolvedValue(ficha({ diferencas: [{ campo: "cpf", rotulo: "CPF", atual: "529.982.247-25", novo: "123.456.789-09" }] }));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Concluir sem gravar" }));
    expect(screen.getByText(/nada vai para o cadastro/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    await waitFor(() => expect(concluirFichaCadastral).toHaveBeenCalledWith("f1", "2026-10-04T12:01:00.000Z", []));
  });
});
