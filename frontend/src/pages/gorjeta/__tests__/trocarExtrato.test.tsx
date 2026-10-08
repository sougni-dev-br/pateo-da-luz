import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Aba Contabilidade com a folha já liberada: cada extrato tem "Trocar extrato" (a
// contabilidade reemitiu), que pede o motivo e mostra o que mudou e quem ficou diferente no
// Contas a Pagar. O envio e o OK não se desmarcam com títulos liberados.
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipConferencia: vi.fn(),
  getTipFolhaLotes: vi.fn(),
  enviarTipExtrato: vi.fn(),
  getTipFolhaLiquidos: vi.fn(() => new Promise(() => undefined)),
}));

import { type TipConferenciaCompleta, enviarTipExtrato, getTipConferencia, getTipFolhaLotes } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaContabilidade } from "../AbaContabilidade";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>);
type Estado = { marcada: boolean; em: string | null; por: string | null; obs: string | null };
const feita: Estado = { marcada: true, em: "2026-10-01T12:00:00Z", por: "Eli", obs: null };
const nao: Estado = { marcada: false, em: null, por: null, obs: null };
const EXTRATO = { id: "x2", empresa: "CANECA EXEMPLO LTDA", cnpj: "2", arquivo: "caneca.pdf", hash: "h", importadoEm: "2026-10-01T10:00:00Z", importadoPor: "Eli", pessoas: 2 };
const conf = () => ({
  code: "GOR-2026-09", status: "CLOSED", podeVerFolha: true, pendentes: 0, linhas: [], extratos: [EXTRATO],
  etapas: { estado: { ENVIADO_CONTABILIDADE: feita, OK_CONTABILIDADE: feita, FOLHA_PAGA: nao }, historico: [] },
}) as unknown as TipConferenciaCompleta;
const LOTE = { id: "l1", rotulo: "Folha 09/2026 · Caneca Exemplo", grupo: "2", dueDate: "2026-10-06", status: "ABERTO", total: 2700, pessoas: 2, paymentDate: null, paidPaymentMethodName: null };
const TROCA = {
  motivo: "contabilidade reemitiu", gorjetaMudou: false,
  diferencas: [{ employeeId: "e2", nome: "BRUNO EXEMPLO", situacao: "MUDOU" as const, liquidoAntes: 1200, liquidoDepois: 1201, gorjetaAntes: 250, gorjetaDepois: 250 }],
  contasAPagar: [{ employeeId: "e2", nome: "Bruno Exemplo", noContasAPagar: 1200, extratoNovo: 1201, titulo: "Folha 09/2026 · Caneca Exemplo" }],
  avisoContasAPagar: "Reimporte este PDF em RH → Retorno do RH para atualizar o Contas a Pagar.",
};

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(getTipConferencia).mockResolvedValue(conf());
  vi.mocked(getTipFolhaLotes).mockResolvedValue({ lotes: [LOTE], soltos: 0 });
  vi.mocked(enviarTipExtrato).mockResolvedValue({ extratos: [EXTRATO], linhas: [], pendentes: 0, avisos: [], troca: TROCA });
});
afterEach(() => vi.restoreAllMocks());

const pdf = () => new File(["%PDF-falso"], "caneca-reemitido.pdf", { type: "application/pdf" });

describe("trocar extrato com a folha liberada", () => {
  test("pede o motivo, troca com o id do extrato e mostra as diferenças até fechar", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("contabilidade reemitiu");
    const onNotice = vi.fn();
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole("button", { name: "Trocar o extrato de CANECA EXEMPLO LTDA" }));
    // Com o OK dado, o "Carregar extrato" geral continua escondido.
    expect(screen.queryByRole("button", { name: /Carregar extrato/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PDF do extrato novo"), { target: { files: [pdf()] } });
    await waitFor(() => expect(enviarTipExtrato).toHaveBeenCalledTimes(1));
    expect(vi.mocked(enviarTipExtrato).mock.calls[0][4]).toEqual({ substitui: "x2", motivo: "contabilidade reemitiu" });
    const bloco = await screen.findByRole("region", { name: "Extrato trocado: CANECA EXEMPLO LTDA" });
    expect(within(bloco).getByRole("list", { name: "Diferenças do extrato novo" })).toHaveTextContent(/BRUNO EXEMPLO.*mudou/);
    expect(within(bloco).getByRole("alert")).toHaveTextContent("Reimporte este PDF em RH → Retorno do RH para atualizar o Contas a Pagar.");
    expect(within(bloco).getByRole("list", { name: "Salários diferentes no Contas a Pagar" })).toHaveTextContent(/Bruno Exemplo.*Folha 09\/2026 · Caneca Exemplo/);
    fireEvent.click(within(bloco).getByRole("button", { name: "Fechar o resultado da troca" }));
    expect(screen.queryByRole("region", { name: /Extrato trocado/ })).not.toBeInTheDocument();
  });

  test("sem motivo com o OK dado: não envia", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("ok");
    const onNotice = vi.fn();
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={onNotice} />);
    fireEvent.click(await screen.findByRole("button", { name: "Trocar o extrato de CANECA EXEMPLO LTDA" }));
    fireEvent.change(screen.getByLabelText("PDF do extrato novo"), { target: { files: [pdf()] } });
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", expect.stringMatching(/motivo/)));
    expect(enviarTipExtrato).not.toHaveBeenCalled();
  });

  test("com títulos liberados, o envio e o OK não mostram 'desmarcar'", async () => {
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={vi.fn()} />);
    await screen.findByRole("button", { name: "Trocar o extrato de CANECA EXEMPLO LTDA" });
    expect(screen.queryByRole("button", { name: "desmarcar" })).not.toBeInTheDocument();
  });

  test("sem títulos liberados, o envio continua desmarcável", async () => {
    vi.mocked(getTipFolhaLotes).mockResolvedValue({ lotes: [], soltos: 0 });
    render(<AbaContabilidade year={2026} month={9} canEdit onNotice={vi.fn()} />);
    await screen.findByRole("button", { name: "Trocar o extrato de CANECA EXEMPLO LTDA" });
    expect(screen.getAllByRole("button", { name: "desmarcar" }).length).toBeGreaterThan(0);
  });
});
