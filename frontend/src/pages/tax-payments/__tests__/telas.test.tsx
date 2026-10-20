import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TaxPanorama, TaxPayment } from "../../../api/client";

// Money lê o contexto de "ocultar valores" (que exige sessão); aqui só interessa o valor.
vi.mock("../../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  payTaxPayment: vi.fn(async () => ({ id: "g1", status: "PAID" })),
}));

import { payTaxPayment } from "../../../api/client";
import { ListaGuias } from "../ListaGuias";
import { ModalPagar } from "../ModalPagar";
import { ResumoImpostos } from "../ResumoImpostos";

const hoje = "2026-10-20";


const guia = (extra: Partial<TaxPayment> = {}): TaxPayment => ({
  id: "g1", companyId: null, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: "Exemplo",
  documentType: "FGTS", description: "FGTS mensal", competenceDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-10-07T00:00:00.000Z",
  amount: "1980.00", paymentDate: null, paidAmount: null, status: "PENDING", comments: null, source: "MANUAL", importBatchId: null,
  dreCategoryId: null, dreCategoryName: null, createdById: "u1", deletedAt: null, createdAt: "", updatedAt: "", ...extra,
});

const acoes = {
  onPagar: vi.fn(), onEditar: vi.fn(), onDuplicar: vi.fn(), onExcluir: vi.fn(), onContasAPagar: vi.fn(), onLimparFiltros: vi.fn(),
};

const lista = (guias: TaxPayment[], extra: Record<string, unknown> = {}) =>
  render(<ListaGuias guias={guias} hoje={hoje} carregando={false} podeEditar podeLancar podeExcluir filtrando={false} {...acoes} {...extra} />);

describe("ListaGuias", () => {
  beforeEach(() => vi.clearAllMocks());

  test("guia vencida mostra o prazo em atraso e o botão Pagar", () => {
    lista([guia()]);
    expect(screen.getAllByText("venceu há 13 dias").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Pagar FGTS" })[0]);
    expect(acoes.onPagar).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
  });

  test("guia paga e guia cancelada não têm botão Pagar", () => {
    lista([
      guia({ id: "p", paymentDate: "2026-10-05T00:00:00.000Z", paidAmount: "1980.00" }),
      guia({ id: "c", status: "CANCELED" }),
    ]);
    expect(screen.queryAllByRole("button", { name: /^Pagar/ })).toHaveLength(0);
    expect(screen.getAllByText("Paga").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelada").length).toBeGreaterThan(0);
  });

  test("sem permissão de editar não aparece Pagar", () => {
    lista([guia()], { podeEditar: false });
    expect(screen.queryAllByRole("button", { name: /^Pagar/ })).toHaveLength(0);
  });

  test("guia sem competência avisa que fica fora do DRE", () => {
    lista([guia({ competenceDate: null })]);
    expect(screen.getAllByText("sem competência").length).toBeGreaterThan(0);
  });

  test("lista vazia com filtros oferece limpar; sem filtros oferece lançar", () => {
    const { unmount } = lista([], { filtrando: true });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(acoes.onLimparFiltros).toHaveBeenCalled();
    unmount();
    lista([], { onLancar: vi.fn() });
    expect(screen.getByRole("button", { name: "Lançar guia" })).toBeTruthy();
  });
});

describe("ResumoImpostos", () => {
  const z = { qtd: 0, valor: 0 };
  const base: TaxPanorama = {
    hoje, situacoes: { todas: 0, vencidas: 0, aVencer: 0, pagas: 0, canceladas: 0 },
    aPagar: { vencido: z, ate7: z, ate30: z, depois: z }, meses: ["2026-08", "2026-09", "2026-10"], cobertura: [], semCompetencia: 0,
  };
  const props = { podeLancar: true, onLancar: vi.fn(), onVerSituacao: vi.fn(), onVerMes: vi.fn() };

  test("nada pendente: diz que está tudo em dia", () => {
    render(<ResumoImpostos panorama={base} {...props} />);
    expect(screen.getByText("Tudo em dia")).toBeTruthy();
  });

  test("vencidas e guias sem competência aparecem como atenção, e Ver vencidas filtra", () => {
    const p: TaxPanorama = { ...base, aPagar: { ...base.aPagar, vencido: { qtd: 2, valor: 4060 } }, semCompetencia: 3 };
    render(<ResumoImpostos panorama={p} {...props} />);
    expect(screen.getByText("2 guias vencidas")).toBeTruthy();
    expect(screen.getByText("3 guias sem competência")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver vencidas" }));
    expect(props.onVerSituacao).toHaveBeenCalledWith("OVERDUE");
  });

  test("falta de guia de um imposto vira alerta mesmo que outro esteja em dia, e a célula em falta é marcada", () => {
    const meses = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const fgts = ["2026-05", "2026-06", "2026-07"].map((mes) => ({ mes, grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: 100 }));
    const das = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((mes) => ({ mes, grupo: "Simples Nacional", qtd: 1, pagas: 1, vencidas: 0, valor: 100 }));
    render(<ResumoImpostos panorama={{ ...base, meses, cobertura: [...fgts, ...das] }} {...props} />);
    expect(screen.getByText("Falta lançar guia de FGTS")).toBeTruthy();
    expect(screen.queryByText("Tudo em dia")).toBeNull();
    expect(screen.getByRole("button", { name: "FGTS, ago/26: falta lançar a guia" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lançar guia" }));
    expect(props.onLancar).toHaveBeenCalled();
  });

  test("clicar numa célula pede a lista daquele mês", () => {
    const cobertura = [{ mes: "2026-09", grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: 100 }];
    render(<ResumoImpostos panorama={{ ...base, cobertura }} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "FGTS, set/26: 1 guia, pago" }));
    expect(props.onVerMes).toHaveBeenCalledWith("2026-09");
  });
});

describe("ModalPagar", () => {
  beforeEach(() => vi.clearAllMocks());

  test("confirma com a data de hoje e o valor da guia, e avisa quem chamou", async () => {
    const onPago = vi.fn();
    render(<ModalPagar guia={guia()} hoje={hoje} onFechar={vi.fn()} onPago={onPago} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento" }));
    await waitFor(() => expect(onPago).toHaveBeenCalled());
    expect(payTaxPayment).toHaveBeenCalledWith("g1", { paymentDate: hoje, paidAmount: 1980, comments: null });
    expect(onPago.mock.calls[0][0]).toMatch(/FGTS de set\/26 marcada como paga em 20\/10\/2026/);
  });

  test("valor acima do da guia mostra a diferença como juros ou multa", () => {
    render(<ModalPagar guia={guia()} hoje={hoje} onFechar={vi.fn()} onPago={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("1.980,00"), { target: { value: "200000" } });
    expect(screen.getByRole("status").textContent).toMatch(/Acima do valor da guia.*juros ou multa/);
  });

  test("erro do servidor aparece dentro da janela e não fecha", async () => {
    vi.mocked(payTaxPayment).mockRejectedValueOnce(new Error("Período fechado."));
    const onPago = vi.fn();
    render(<ModalPagar guia={guia()} hoje={hoje} onFechar={vi.fn()} onPago={onPago} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar pagamento" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Período fechado.");
    expect(onPago).not.toHaveBeenCalled();
  });
});
