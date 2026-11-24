import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SupplierHistory, SupplierHistoryTitle } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";

const api = vi.hoisted(() => ({ getSupplierHistory: vi.fn(), downloadSupplierHistoryXlsx: vi.fn() }));
vi.mock("../../api/client", async (original) => ({ ...(await original<object>()), ...api }));
const pdf = vi.hoisted(() => ({ gerarPdfHistoricoFornecedor: vi.fn() }));
vi.mock("../supplierHistoryPdf", () => pdf);
import { SupplierHistoryModal } from "../SupplierHistoryModal";

const titulo = (over: Partial<SupplierHistoryTitle>): SupplierHistoryTitle => ({
  state: "OPEN", parcels: [], installments: 1, paidInstallments: 0, amount: 100, paidAmount: 0, nextDueDate: null, paidDate: null, viaCycle: false, ...over
});

function history(overrides: Partial<SupplierHistory> = {}): SupplierHistory {
  return {
    period: { from: null, to: null },
    periodTotal: 18801.76,
    purchaseCount: 4,
    lastPurchase: { id: "c1", purchaseDate: "2026-11-23T00:00:00.000Z", totalAmount: "5192.77", purchaseNumber: "CMP-1", invoiceNumber: "1208953" },
    averagePaymentTermDays: 26.4,
    purchases: {
      items: [
        { id: "c1", purchaseNumber: "CMP-2026-001331", invoiceNumber: "1208953", purchaseDate: "2026-11-23T00:00:00.000Z", totalAmount: "5192.77", status: "ACTIVE", paymentMethod: "BOLETO",
          title: titulo({
            state: "OPEN", installments: 2, nextDueDate: "2026-12-05",
            parcels: [
              { number: 1, dueDate: "2026-11-05", amount: 2500.25, state: "PAID", paidDate: "2026-11-04", paidAmount: 2500.25 },
              { number: 2, dueDate: "2026-12-05", amount: 2500.25, state: "OPEN", paidDate: null, paidAmount: 0 }
            ]
          }) },
        { id: "c2", purchaseNumber: "CMP-2026-001314", invoiceNumber: "1208397", purchaseDate: "2026-11-20T00:00:00.000Z", totalAmount: "618.34", status: "ACTIVE", paymentMethod: "BOLETO",
          title: titulo({ state: "PAID", paidInstallments: 1, paidDate: "2026-11-12" }) },
        { id: "c3", purchaseNumber: "CMP-2026-001300", invoiceNumber: "1207000", purchaseDate: "2026-07-10T00:00:00.000Z", totalAmount: "900.00", status: "ACTIVE", paymentMethod: "BOLETO",
          title: titulo({ state: "OVERDUE", nextDueDate: "2026-07-17" }) },
        { id: "c4", purchaseNumber: "CMP-2026-001290", invoiceNumber: "1206000", purchaseDate: "2026-07-01T00:00:00.000Z", totalAmount: "50.00", status: "CANCELLED", paymentMethod: "BOLETO",
          title: titulo({ state: "NONE", installments: 0 }) }
      ],
      total: 40,
      page: 1,
      pageSize: 15,
      truncated: false
    },
    titleBuckets: {
      all: { count: 40, amount: 20000 }, open: { count: 10, amount: 8000 }, overdue: { count: 5, amount: 3000 },
      paid: { count: 24, amount: 9000 }, none: { count: 1, amount: 0 }
    },
    paymentMethods: [{ name: "BOLETO", count: 3, total: "15000.00" }],
    ...overrides
  };
}

function Destino() {
  return <p data-testid="rota">{useLocation().pathname}</p>;
}

function abrir(onClose = vi.fn()) {
  const sessao = { user: { id: "u", name: "Eli", role: "ADMIN", modulePermissions: {} }, setUser: () => undefined } as unknown as SessionContextValue;
  render(
    <SessionContext.Provider value={sessao}>
      <HideValuesProvider>
        <MemoryRouter initialEntries={["/cadastros/fornecedores"]}>
          <Routes>
            <Route path="/cadastros/fornecedores" element={<SupplierHistoryModal supplier={{ id: "s1", name: "CASTELÃO" }} onClose={onClose} />} />
            <Route path="*" element={<Destino />} />
          </Routes>
        </MemoryRouter>
      </HideValuesProvider>
    </SessionContext.Provider>
  );
  return onClose;
}

beforeEach(() => {
  api.getSupplierHistory.mockReset();
  api.downloadSupplierHistoryXlsx.mockReset();
  pdf.gerarPdfHistoricoFornecedor.mockReset();
  api.getSupplierHistory.mockResolvedValue(history());
  api.downloadSupplierHistoryXlsx.mockResolvedValue(undefined);
  pdf.gerarPdfHistoricoFornecedor.mockResolvedValue(undefined);
});

describe("modal de histórico do fornecedor", () => {
  test("abre no ano atual, sem lista de produtos, e pede só a primeira página", async () => {
    abrir();
    expect((await screen.findAllByText("1208953")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Produtos mais comprados/)).toBeNull();

    const filtros = api.getSupplierHistory.mock.calls[0][1];
    expect(filtros.from).toMatch(/^\d{4}-01-01$/);
    expect(filtros.to).toMatch(/^\d{4}-12-31$/);
    expect(filtros).toMatchObject({ page: 1, includeCancelled: false, titleState: undefined });
  });

  test("cada compra mostra a situação do título com o detalhe: vencimento, vencido e baixa", async () => {
    abrir();
    await screen.findAllByText("1208953");
    expect(screen.getByText("Em aberto", { selector: "span.ds-status-badge" })).toBeTruthy();
    expect(screen.getByText("vence 05/12/2026")).toBeTruthy();
    expect(screen.getByText("Vencido", { selector: "span.ds-status-badge" })).toBeTruthy();
    expect(screen.getByText("venceu 17/07/2026")).toBeTruthy();
    expect(screen.getByText("Baixado", { selector: "span.ds-status-badge" })).toBeTruthy();
    expect(screen.getByText("baixado em 12/11/2026")).toBeTruthy();
  });

  test("compra cancelada mostra 'Cancelada' no lugar do título", async () => {
    abrir();
    await screen.findByText("1206000");
    expect(screen.getByText("Cancelada")).toBeTruthy();
  });

  test("os chips mostram a contagem por situação e filtram a lista", async () => {
    abrir();
    await screen.findAllByText("1208953");
    const vencidas = screen.getByRole("button", { name: /Vencidas/ });
    expect(vencidas.textContent).toContain("5");

    fireEvent.click(vencidas);
    await waitFor(() => expect(api.getSupplierHistory.mock.lastCall?.[1]).toMatchObject({ titleState: "overdue", page: 1 }));
    expect(vencidas.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /Todas/ }));
    await waitFor(() => expect(api.getSupplierHistory.mock.lastCall?.[1].titleState).toBeUndefined());
  });

  test("trocar o período volta para a página 1 e pede o novo intervalo", async () => {
    abrir();
    await screen.findAllByText("1208953");
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(api.getSupplierHistory.mock.lastCall?.[1].page).toBe(2));

    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "all" } });
    await waitFor(() => expect(api.getSupplierHistory.mock.lastCall?.[1]).toMatchObject({ from: "", to: "", page: 1 }));
  });

  test("a paginação mostra a faixa e bloqueia Anterior na primeira página", async () => {
    abrir();
    expect(await screen.findByText("1–15 de 40")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Anterior" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Página 1 de 3")).toBeTruthy();
  });

  test("Abrir compra leva à edição daquela compra", async () => {
    abrir();
    await screen.findAllByText("1208953");
    fireEvent.click(screen.getAllByRole("button", { name: /Abrir compra/ })[0]);
    expect((await screen.findByTestId("rota")).textContent).toBe("/compras/c1/editar");
  });

  test("mostra o erro da API em vez de ficar em branco", async () => {
    api.getSupplierHistory.mockRejectedValue(new Error("Falha de rede"));
    abrir();
    expect(await screen.findByText("Falha de rede")).toBeTruthy();
  });

  test("compra parcelada se repete em cada parcela, com 1/2 e 2/2 e a situação de cada uma", async () => {
    abrir();
    expect(await screen.findAllByText("1208953")).toHaveLength(2);
    expect(screen.getByText("Parcela 1/2")).toBeTruthy();
    expect(screen.getByText("Parcela 2/2")).toBeTruthy();
    // Valor da parcela, com o total da compra embaixo.
    expect(screen.getAllByText("de")).toHaveLength(2);
    expect(screen.getByText("Baixada", { selector: "span.ds-status-badge" })).toBeTruthy();
    expect(screen.getByText(/baixada em 04\/11\/2026/)).toBeTruthy();
    expect(screen.getByText("vence 05/12/2026")).toBeTruthy();
  });

  test("compra de uma parcela só fica numa linha, sem 'Parcela'", async () => {
    abrir();
    expect(await screen.findAllByText("1207000")).toHaveLength(1);
    expect(screen.getAllByText(/^Parcela \d\/\d$/)).toHaveLength(2);
  });

  test("não há botão de expandir parcelas nem interruptor: tudo já está na tabela", async () => {
    abrir();
    await screen.findAllByText("1208953");
    expect(screen.queryByRole("button", { name: /parcelas/i })).toBeNull();
    expect(screen.queryByRole("switch", { name: /parcelas/i })).toBeNull();
  });
  test("Exportar Excel baixa a planilha com os filtros da tela, sem paginação", async () => {
    abrir();
    await screen.findAllByText("1208953");
    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }));
    await waitFor(() => expect(api.downloadSupplierHistoryXlsx).toHaveBeenCalled());
    const [id, filtros, arquivo] = api.downloadSupplierHistoryXlsx.mock.calls[0];
    expect(id).toBe("s1");
    expect(filtros).toMatchObject({ includeCancelled: false });
    expect(filtros.page).toBeUndefined();
    expect(arquivo).toMatch(/^Historico_CASTELAO_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("Exportar PDF busca a lista inteira do filtro e gera o arquivo", async () => {
    abrir();
    await screen.findAllByText("1208953");
    fireEvent.click(screen.getByRole("button", { name: /Exportar PDF/ }));
    await waitFor(() => expect(pdf.gerarPdfHistoricoFornecedor).toHaveBeenCalled());
    expect(api.getSupplierHistory.mock.lastCall?.[1]).toMatchObject({ all: true });
    expect(pdf.gerarPdfHistoricoFornecedor.mock.calls[0][1]).toMatchObject({ supplierName: "CASTELÃO", titleFilter: "all" });
  });

  test("falha ao exportar mostra o erro e libera os botões", async () => {
    api.downloadSupplierHistoryXlsx.mockRejectedValue(new Error("Sem permissão"));
    abrir();
    await screen.findAllByText("1208953");
    fireEvent.click(screen.getByRole("button", { name: /Exportar Excel/ }));
    expect(await screen.findByText("Sem permissão")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Exportar Excel/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("Esc fecha o modal", async () => {
    const onClose = abrir();
    await screen.findAllByText("1208953");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
