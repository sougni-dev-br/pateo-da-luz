import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

const PANORAMA = {
  hoje: "2026-11-18",
  situacoes: { todas: 572, vencidas: 0, aVencer: 4, pagas: 568, canceladas: 0 },
  aPagar: { vencido: { qtd: 0, valor: 0 }, ate7: { qtd: 0, valor: 0 }, ate30: { qtd: 0, valor: 0 }, depois: { qtd: 0, valor: 0 } },
  meses: ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
  cobertura: [], coberturaPorEmpresa: [], semCompetencia: 0,
};

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getTaxPanorama: vi.fn(async () => PANORAMA),
  getTaxPayments: vi.fn(async () => ({ data: [], pagination: { page: 1, pageSize: 30, total: 3, totalPages: 1 }, summary: {} })),
  getCompanies: vi.fn(async () => []),
  getTaxPaymentTypes: vi.fn(async () => [{ documentType: "RECEITA FEDERAL", qtd: 109 }]),
}));

import { getTaxPanorama, getTaxPayments } from "../../api/client";
import { TaxPayments } from "../TaxPayments";

const USUARIO = { id: "u1", role: "ADMIN", modulePermissions: {} } as never;
const abrir = () => render(<MemoryRouter><TaxPayments user={USUARIO} /></MemoryRouter>);
const ultimosFiltros = () => { const chamadas = vi.mocked(getTaxPayments).mock.calls; return (chamadas[chamadas.length - 1]?.[0] ?? {}) as Record<string, unknown>; };

describe("Impostos: filtros da lista", () => {
  beforeEach(() => vi.clearAllMocks());

  test("ano de 5 dígitos na competência não vira filtro: avisa e a lista não pede um mês que não existe", async () => {
    abrir();
    const mes = await screen.findByLabelText("Competência") as HTMLInputElement;
    await waitFor(() => expect(getTaxPayments).toHaveBeenCalled());
    fireEvent.change(mes, { target: { value: "20266-02" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/ano de 4 dígitos/)).toBeTruthy();
    expect(ultimosFiltros().competenceStart).toBeUndefined();
    expect(screen.queryByText(/competência em/)).toBeNull();

    fireEvent.change(mes, { target: { value: "2026-09" } });
    await waitFor(() => expect(ultimosFiltros().competenceStart).toBe("2026-09-01"));
    expect(screen.queryByText(/ano de 4 dígitos/)).toBeNull();
  });

  test("com um filtro além da situação, a tela diz que as pílulas contam todas as guias e quantas há na lista", async () => {
    abrir();
    await waitFor(() => expect(getTaxPayments).toHaveBeenCalled());
    expect(screen.queryByText(/Os números das pílulas são de todas as guias/)).toBeNull();
    fireEvent.change(await screen.findByLabelText("Tipo da guia"), { target: { value: "FGTS" } });
    expect(await screen.findByText(/Os números das pílulas são de todas as guias/)).toBeTruthy();
    expect(screen.getByText("3", { selector: "b" })).toBeTruthy();
  });

  test("o aviso de mês inválido some quando a pessoa escolhe 'sem competência' (outro caminho de filtro)", async () => {
    vi.mocked(getTaxPanorama).mockResolvedValue({ ...PANORAMA, semCompetencia: 2 });
    abrir();
    const mes = await screen.findByLabelText("Competência") as HTMLInputElement;
    fireEvent.change(mes, { target: { value: "20266-02" } });
    expect(await screen.findByText(/ano de 4 dígitos/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /sem competência/i }));
    await waitFor(() => expect(screen.queryByText(/ano de 4 dígitos/)).toBeNull());
    vi.mocked(getTaxPanorama).mockResolvedValue(PANORAMA);
  });

  test("a lista de tipos do filtro inclui os do legado importado", async () => {
    abrir();
    await waitFor(() => expect(screen.getByRole("option", { name: "RECEITA FEDERAL" })).toBeTruthy());
  });

  test("só a situação ligada (pílula) não gera a nota: a contagem da pílula já é a da lista", async () => {
    abrir();
    await waitFor(() => expect(getTaxPayments).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Vencidas/ }));
    await waitFor(() => expect(ultimosFiltros().status).toBe("OVERDUE"));
    expect(screen.queryByText(/Os números das pílulas são de todas as guias/)).toBeNull();
  });
});
