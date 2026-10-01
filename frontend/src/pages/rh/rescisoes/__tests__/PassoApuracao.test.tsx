import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../api/client")>()),
  deletePayrollItem: vi.fn(async () => ({ ok: true })),
}));

import { type ApuracaoRescisao, type DetalheRescisao, type TerminationInfo, deletePayrollItem } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { PassoApuracao } from "../PassoApuracao";

// Passo 2 do CLT: onde aparece "Enviar o termo" (líquido zero) e a rescisão já quitada no termo.
const sessao = {
  user: { id: "u", name: "Eli", role: "GESTAO_COMPLETA", modulePermissions: { payroll: { view: true, create: true, edit: true, delete: true, approve: false, admin: false } } },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined,
  canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={sessao}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

const apuracao: ApuracaoRescisao = {
  saida: "2026-09-03", semRegistro: false,
  vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
  vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: false },
  gorjeta: null, gorjetaObservacao: "Fora da apuração de gorjeta.",
  sugestao: { salario: null, gorjeta: null, creditos: 0, vales: 0, valesRotulo: null, vtDesconto: 0, bruto: null },
} as unknown as ApuracaoRescisao;
const info = { apuracao } as unknown as TerminationInfo;

const detalhe = (pessoa: Partial<DetalheRescisao["pessoa"]> = {}, over: Partial<DetalheRescisao> = {}): DetalheRescisao => ({
  pessoa: { employeeId: "e1", nome: "Maria Silva", apelido: null, empresa: null, semRegistro: false, saida: "2026-09-03", motivo: null, rescisao: null, termo: null, ...pessoa },
  itensAposSaida: [],
  periodoGorjeta: { year: 2026, month: 9, label: "Gorjeta 26/08–25/09", fechado: false, participa: false },
  extratoDoMes: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("PassoApuracao — CLT e termo com líquido zero", () => {
  test("fora da apuração de gorjeta: oferece enviar o termo", () => {
    render(<PassoApuracao detalhe={detalhe()} info={info} carregando={false} onMudou={vi.fn()} onLancarNormal={vi.fn()} />);
    expect(screen.getByText(/não está na apuração de gorjeta/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enviar o termo/ })).toBeInTheDocument();
  });

  test("sem período de gorjeta com a saída: também oferece enviar o termo", () => {
    render(<PassoApuracao detalhe={detalhe({}, { periodoGorjeta: null })} info={info} carregando={false} onMudou={vi.fn()} onLancarNormal={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Enviar o termo/ })).toBeInTheDocument();
  });

  test("quitada no termo: mostra concluída e desfaz excluindo o registro, com motivo", async () => {
    const onMudou = vi.fn();
    render(
      <PassoApuracao
        detalhe={detalhe({
          rescisao: { parcelas: 1, pagas: 1, liquido: 0, valorPago: 0, proximoVencimento: null, quitadaNoTermo: { itemId: "q1" } },
          termo: { arquivo: "termo.pdf", importadoEm: "2026-10-01T12:00:00Z", gorjeta: null, liquido: 0, pagamento: "2026-09-11" },
        })}
        info={info} carregando={false} onMudou={onMudou} onLancarNormal={vi.fn()}
      />,
    );
    expect(screen.getByText(/quitada no termo: nada a pagar/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enviar o termo/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "termo era de outra pessoa" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar: desfazer" }));

    await waitFor(() => expect(onMudou).toHaveBeenCalled());
    expect(deletePayrollItem).toHaveBeenCalledWith("q1", "termo era de outra pessoa");
  });
});
