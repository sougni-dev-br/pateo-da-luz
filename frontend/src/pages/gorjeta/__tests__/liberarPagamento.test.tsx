import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Aba Contabilidade, passo 5: "Liberar para pagamento" (antes "Folha paga no banco"). Só
// depois do OK; mostra os títulos que serão criados e, liberados, a situação de cada um.
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipConferencia: vi.fn(),
  getTipFolhaLotes: vi.fn(),
  getTipFolhaLotesPrevia: vi.fn(),
  liberarTipFolha: vi.fn(),
  getTipFolhaLiquidos: vi.fn(() => new Promise(() => undefined)),
}));

import {
  type TipConferenciaCompleta, type TipFolhaLote, getTipConferencia, getTipFolhaLotes, getTipFolhaLotesPrevia, liberarTipFolha,
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaContabilidade } from "../AbaContabilidade";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>);
type Estado = { marcada: boolean; em: string | null; por: string | null; obs: string | null };
const feita: Estado = { marcada: true, em: "2026-10-01T12:00:00Z", por: "Eli", obs: null };
const nao: Estado = { marcada: false, em: null, por: null, obs: null };
const conf = (folhaPaga = nao) => ({
  code: "GOR-2026-09", status: "CLOSED", podeVerFolha: true, pendentes: 0, linhas: [],
  extratos: [{ id: "x1", empresa: "PATEO EXEMPLO LTDA", cnpj: "1", arquivo: "a.pdf", hash: "h", importadoEm: "2026-10-01T10:00:00Z", importadoPor: "Eli", pessoas: 2 }],
  etapas: { estado: { ENVIADO_CONTABILIDADE: feita, OK_CONTABILIDADE: feita, FOLHA_PAGA: folhaPaga }, historico: [] },
}) as unknown as TipConferenciaCompleta;
const lote = (over: Partial<TipFolhaLote> = {}): TipFolhaLote => ({
  id: "l1", rotulo: "Folha 09/2026 · Pateo Exemplo", grupo: "111", dueDate: "2026-10-06", status: "ABERTO", total: 2700, pessoas: 2,
  paymentDate: null, paidPaymentMethodName: null, ...over,
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(getTipFolhaLotes).mockResolvedValue({ lotes: [] });
});

describe("passo 5: liberar para pagamento", () => {
  test("com o OK: mostra a prévia dos títulos e libera", async () => {
    vi.mocked(getTipConferencia).mockResolvedValue(conf());
    vi.mocked(getTipFolhaLotesPrevia).mockResolvedValue({
      grupos: [
        { grupo: "111", rotulo: "Folha 09/2026 · Pateo Exemplo", total: 2700, membros: [{ payrollItemId: "p1", employeeId: "e1", nome: "Ana Exemplo", valor: 1500 }, { payrollItemId: "p2", employeeId: "e2", nome: "Bruno Exemplo", valor: 1200 }] },
        { grupo: "SEM_REGISTRO", rotulo: "Folha 09/2026 · Sem registro", total: 900, membros: [{ payrollItemId: "p4", employeeId: "e4", nome: "Davi Exemplo", valor: 900 }] },
      ],
      avisos: ["Fabio Exemplo: sem salário de 09/2026 em aberto no Contas a Pagar — fica fora do lote."], lotes: [], vencimento: "2026-10-06",
    });
    vi.mocked(liberarTipFolha).mockResolvedValue({
      criados: [{ id: "l1", rotulo: "Folha 09/2026 · Pateo Exemplo" }, { id: "l2", rotulo: "Folha 09/2026 · Sem registro" }],
      acrescentados: 3, jaLiberada: false, avisos: [],
      lotes: [lote(), lote({ id: "l2", rotulo: "Folha 09/2026 · Sem registro", grupo: "SEM_REGISTRO", total: 900, pessoas: 1 })],
      etapas: conf().etapas,
    });
    const onNotice = vi.fn();
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={onNotice} />);
    expect(await screen.findByText(/cria os títulos por empresa/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como feito" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Liberar para pagamento" }));
    const previa = await screen.findByRole("region", { name: "Títulos que serão criados" });
    expect(previa).toHaveTextContent("Folha 09/2026 · Pateo Exemplo");
    expect(previa).toHaveTextContent("vence 06/10/2026");
    expect(previa).toHaveTextContent("Fabio Exemplo: sem salário");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar liberação" }));
    await waitFor(() => expect(liberarTipFolha).toHaveBeenCalledWith(2026, 9));
    const titulos = await screen.findByRole("list", { name: "Títulos da folha no Contas a Pagar" });
    expect(titulos).toHaveTextContent("Folha 09/2026 · Sem registro");
    expect(titulos).toHaveTextContent("Em aberto");
    expect(screen.getByText(/2 título\(s\) no Contas a Pagar · 0 de 2 pago/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /abrir no Contas a Pagar/ })).toHaveAttribute("href", "/financeiro/contas-a-pagar");
    expect(onNotice).toHaveBeenCalledWith("success", expect.stringMatching(/2 título\(s\) criado/));
  });

  test("todos os títulos pagos: o passo fica feito sozinho, sem desmarcar à mão", async () => {
    vi.mocked(getTipConferencia).mockResolvedValue(conf(feita));
    vi.mocked(getTipFolhaLotes).mockResolvedValue({ lotes: [lote({ status: "PAGO", paymentDate: "2026-10-05", paidPaymentMethodName: "PIX" })] });
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={vi.fn()} />);
    expect(await screen.findByText(/todos os títulos pagos/)).toBeInTheDocument();
    expect(screen.getByText(/pago em 05\/10\/2026 \(PIX\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Liberar/ })).not.toBeInTheDocument();
    // Com títulos liberados nada se desmarca à mão: envio e OK ficam presos aos títulos (trocar
    // extrato e desfazer liberação têm caminho próprio) e a folha paga é automática.
    expect(screen.queryByRole("button", { name: "desmarcar" })).not.toBeInTheDocument();
  });

  test("sem o OK: nada de liberar e não busca os títulos", async () => {
    vi.mocked(getTipConferencia).mockResolvedValue({ ...conf(), etapas: { estado: { ENVIADO_CONTABILIDADE: feita, OK_CONTABILIDADE: nao, FOLHA_PAGA: nao }, historico: [] } } as unknown as TipConferenciaCompleta);
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={vi.fn()} />);
    expect(await screen.findByText("Liberar para pagamento")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Liberar para pagamento" })).not.toBeInTheDocument();
    expect(getTipFolhaLotes).not.toHaveBeenCalled();
  });

  test("salário solto fora dos títulos: avisa e oferece liberar de novo, mesmo com todos pagos", async () => {
    vi.mocked(getTipConferencia).mockResolvedValue(conf());
    vi.mocked(getTipFolhaLotes).mockResolvedValue({ lotes: [lote({ status: "PAGO", paymentDate: "2026-10-05" })], soltos: 1 });
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent(/1 salário\(s\) desta competência em aberto fora dos títulos/);
    expect(screen.getByRole("button", { name: "Liberar de novo (acréscimos)" })).toBeInTheDocument();
  });
});
