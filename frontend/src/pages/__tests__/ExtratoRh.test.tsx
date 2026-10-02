import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExtratoPreview, ImportExtratoResult } from "../../api/client";

vi.mock("../../api/client", () => ({
  previewExtratoRh: vi.fn(),
  importExtratoRh: vi.fn(),
  listarRhExtratos: vi.fn(),
  getRhExtrato: vi.fn(),
  getRhExtratoPdf: vi.fn(),
}));

import { importExtratoRh, listarRhExtratos, previewExtratoRh } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { ExtratoRh } from "../ExtratoRh";

const SESSAO = {
  user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined,
  canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;

// Dados fictícios.
const item = { nome: "FULANO FICTICIO", cpf: "•••.•••.•••-44", liquido: 1000, gorjeta: null, matched: true, employeeId: "e1", employeeName: "Fulano", isActive: true };
const previa = (lancamentosExistentes: number): ExtratoPreview => ({
  calculo: "MENSAL", empresa: "EMPRESA FICTICIA", cnpj: null, competenceYear: 2026, competenceMonth: 8, totalLiquido: 1000,
  matchedCount: 1, items: [item], pessoasLidas: 1, pessoasConferidas: 1, lancamentosExistentes, avisos: [],
});
const RESULTADO: ImportExtratoResult = {
  calculo: "MENSAL", empresa: "EMPRESA FICTICIA", companyId: "c1", competenceYear: 2026, competenceMonth: 8, totalLiquido: 1000,
  funcionariosCadastrados: 0, titulosGerados: 0, rhExtractId: "x1", titulosAtualizados: 0, titulosNovos: 0, extratoAtualizado: true,
  pessoasLidas: 1, pessoasConferidas: 1, titulosPulados: 1,
  avisos: ["Lançamento de FULANO FICTICIO foi excluído à mão no Contas a Pagar e não foi recriado."],
};

function renderizar() {
  const r = render(
    <SessionContext.Provider value={SESSAO}><HideValuesProvider><ExtratoRh /></HideValuesProvider></SessionContext.Provider>,
  );
  const input = r.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "extrato.pdf", { type: "application/pdf" })] } });
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listarRhExtratos).mockResolvedValue([]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Retorno do RH depois de importar", () => {
  test("relê a prévia: o botão deixa de dizer \"Lançar\" e o resumo mostra o excluído à mão", async () => {
    vi.mocked(previewExtratoRh).mockResolvedValueOnce(previa(0)).mockResolvedValueOnce(previa(1));
    vi.mocked(importExtratoRh).mockResolvedValue(RESULTADO);
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Lançar salários no Contas a Pagar" }, { timeout: 5000 }));
    expect(await screen.findByRole("button", { name: "Atualizar e guardar o extrato" }, { timeout: 5000 })).toBeInTheDocument();
    expect(previewExtratoRh).toHaveBeenCalledTimes(2);
    expect(vi.mocked(previewExtratoRh).mock.calls[1][0]).toBe(vi.mocked(previewExtratoRh).mock.calls[0][0]);
    expect(screen.getAllByText(/1 excluído\(s\) à mão, não recriado\(s\)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/foi excluído à mão no Contas a Pagar e não foi recriado/)).toBeInTheDocument();
  });

  test("se a releitura falhar, some com a prévia antiga em vez de deixá-la dizendo \"Lançar\"", async () => {
    vi.mocked(previewExtratoRh).mockResolvedValueOnce(previa(0)).mockRejectedValueOnce(new Error("rede"));
    vi.mocked(importExtratoRh).mockResolvedValue({ ...RESULTADO, titulosPulados: undefined, avisos: [] });
    renderizar();
    fireEvent.click(await screen.findByRole("button", { name: "Lançar salários no Contas a Pagar" }, { timeout: 5000 }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Lançar salários/ })).toBeNull());
    expect(screen.getByText(/Este arquivo já estava guardado/)).toBeInTheDocument();
  });
});
