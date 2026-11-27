import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TipComputation } from "../../../api/client";

// Teste de fumaça da tela raiz da gorjeta. As abas pesadas têm testes próprios: aqui entram como
// stubs que só mostram o que a tela raiz lhes passa (permissão, mês, pedido de vales, avisos).
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipCommission: vi.fn(),
  getTipRoster: vi.fn(),
  openTipPeriod: vi.fn(),
  updateTipPeriod: vi.fn(),
  syncTipParticipants: vi.fn(),
  closeTipPeriodApi: vi.fn(),
  reopenTipPeriodApi: vi.fn(),
  saveTipParticipants: vi.fn(),
  refreshTipService: vi.fn(),
}));
vi.mock("../AbaApuracao", () => ({
  AbaApuracao: (p: { readonly: boolean; onVerVales: (id: string | null) => void }) => (
    <div>stub-apuracao readonly={String(p.readonly)}
      <button type="button" onClick={() => p.onVerVales("e1")}>ver vales de e1</button>
    </div>
  ),
}));
vi.mock("../AbaPagamento", () => ({ AbaPagamento: (p: { readonly: boolean }) => <div>stub-pagamento readonly={String(p.readonly)}</div> }));
vi.mock("../AbaVales", () => ({
  AbaVales: (p: { year: number; month: number; canEdit: boolean; pedidoPessoa: { pessoa: string } | null }) => (
    <div>stub-vales {p.year}-{p.month} canEdit={String(p.canEdit)} pedido={p.pedidoPessoa?.pessoa ?? "nenhum"}</div>
  ),
}));
vi.mock("../AbaContabilidade", () => ({ AbaContabilidade: (p: { year: number; month: number }) => <div>stub-contabilidade {p.year}-{p.month}</div> }));
vi.mock("../AbaEquipe", () => ({ AbaEquipe: (p: { canEdit: boolean }) => <div>stub-equipe canEdit={String(p.canEdit)}</div> }));
vi.mock("../AbaFuncoes", () => ({
  AbaFuncoes: (p: { canEdit: boolean; onNotice: (t: "success", m: string) => void }) => (
    <div>stub-funcoes canEdit={String(p.canEdit)}
      <button type="button" onClick={() => p.onNotice("success", "Tabela de funções salva.")}>avisar da aba</button>
    </div>
  ),
}));
vi.mock("../AbaRelatorios", () => ({ AbaRelatorios: (p: { canEdit: boolean }) => <div>stub-relatorios canEdit={String(p.canEdit)}</div> }));
vi.mock("../ResumoApuracao", () => ({
  ResumoApuracao: (p: { onAjustarServico?: () => void }) => (
    <div>stub-resumo {p.onAjustarServico ? <button type="button" onClick={p.onAjustarServico}>ajustar serviço</button> : "sem ajuste"}</div>
  ),
}));
vi.mock("../AjusteServico", () => ({
  AjusteServico: (p: { onSalvar: (a: number, m: string) => Promise<void>; onFechar: () => void }) => (
    <div>stub-ajuste-servico
      <button type="button" onClick={() => void p.onSalvar(50, "acordo do mês")}>salvar ajuste</button>
    </div>
  ),
}));
vi.mock("../Pendencias", () => ({ Pendencias: (p: { pendencias: string[] }) => <div>stub-pendencias {p.pendencias.join("|")}</div> }));
vi.mock("../AvisoCadastro", () => ({ AvisoCadastro: () => null }));

import {
  closeTipPeriodApi, getTipCommission, getTipRoster, openTipPeriod, reopenTipPeriodApi, syncTipParticipants, updateTipPeriod,
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { FolhaGorjeta } from "../../FolhaGorjeta";

type Permissao = { view?: boolean; edit?: boolean; approve?: boolean; admin?: boolean };
function renderComo(permissao: Permissao | "ADMIN", ui: ReactElement = <FolhaGorjeta />) {
  const user = permissao === "ADMIN"
    ? { role: "ADMIN", modulePermissions: {} }
    : { role: "USER", modulePermissions: { "payroll-tips": { view: true, ...permissao } } };
  const sessao = { user, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
  return renderRaw(<SessionContext.Provider value={sessao}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
}
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const FECHAMENTO = { id: "c1", code: "GOR-2026-0001/v1", version: 1, closedAt: "2026-02-05T15:00:00.000Z", closedByName: "Gestora Teste" };
const comp = (over: Partial<TipComputation> = {}): TipComputation => ({
  year: 2026, month: 1, label: "Gorjeta 26/12 a 25/01", periodId: "p1", code: "GOR-2026-0001", fechamento: null, status: "OPEN",
  periodStart: "2025-12-26T00:00:00.000Z", periodEnd: "2026-01-25T00:00:00.000Z", grossPool: 10000, servicoFaturamento: 10000, ajusteServico: 0,
  deductionPercent: 10, pointsBudget: 100, diasPadrao: 26, descontaFalta: true, descontaAtestado: true, descontaFerias: true, descontaOutros: false,
  descontaAfastamento: true, proporcionalEntrada: true, sobraRescisaoParaSaldo: false, reservaPontos: 0, quebraPercent: 0, destinoSobra: "FUNDO",
  participants: [], pendencias: [], warnings: [], check: { expectedNetPool: 9000, sumRateios: 9000, ok: true, diff: 0 },
  saldo: 0, distribuido: 9000, pointValue: 100, ...over,
} as unknown as TipComputation);
const SEM_PERIODO = () => comp({ periodId: null, code: null, status: null, label: "Sem período" });
const FECHADA = () => comp({ status: "CLOSED", fechamento: FECHAMENTO });

let atual: TipComputation;
const aba = (nome: string) => screen.getByRole("tab", { name: nome });
const tela = async () => { await screen.findByText(/Janeiro \/ 2026/); await waitFor(() => expect(getTipCommission).toHaveBeenCalled()); };
const esperarCarga = async () => { await screen.findByText(/stub-apuracao|Nenhum período aberto/); };

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-15T12:00:00"));
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  atual = comp();
  vi.mocked(getTipCommission).mockImplementation(async () => atual);
  vi.mocked(getTipRoster).mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

describe("Tela da gorjeta: carga e cabeçalho", () => {
  test("carrega a competência do mês corrente e mostra código, rótulo do período e situação", async () => {
    renderComo("ADMIN");
    await tela();
    await esperarCarga();
    expect(getTipCommission).toHaveBeenCalledWith(2026, 1);
    expect(getTipRoster).toHaveBeenCalledTimes(1);
    expect(screen.getByText("GOR-2026-0001")).toBeTruthy();
    expect(screen.getByText("Gorjeta 26/12 a 25/01")).toBeTruthy();
    expect(screen.getByText("Em apuração")).toBeTruthy();
    expect(aba("Apuração").getAttribute("aria-selected")).toBe("true");
  });

  test("período fechado mostra a situação \"Fechada\"", async () => {
    atual = FECHADA();
    renderComo("ADMIN");
    await esperarCarga();
    expect(screen.getByText("Fechada")).toBeTruthy();
  });

  test("falha ao carregar mostra o erro na tela e não monta a apuração", async () => {
    vi.mocked(getTipCommission).mockRejectedValue(new Error("Servidor indisponível"));
    renderComo("ADMIN");
    expect(await screen.findByText("Servidor indisponível")).toBeTruthy();
    expect(screen.queryByText(/stub-apuracao/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Fechar período/ })).toBeNull();
  });

  test("Recarregar busca a competência de novo", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(getTipCommission).toHaveBeenCalledTimes(2));
  });

  test("Tela cheia alterna o rótulo do botão", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Tela cheia" }));
    expect(await screen.findByRole("button", { name: "Sair da tela cheia" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sair da tela cheia" }));
    expect(await screen.findByRole("button", { name: "Tela cheia" })).toBeTruthy();
  });
});

describe("Tela da gorjeta: navegação entre meses", () => {
  test("mês anterior e próximo recarregam; de janeiro volta para dezembro do ano anterior", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Mês anterior" }));
    expect(await screen.findByText(/Dezembro \/ 2025/)).toBeTruthy();
    await waitFor(() => expect(getTipCommission).toHaveBeenLastCalledWith(2025, 12));
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(await screen.findByText(/Janeiro \/ 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(await screen.findByText(/Fevereiro \/ 2026/)).toBeTruthy();
    await waitFor(() => expect(getTipCommission).toHaveBeenLastCalledWith(2026, 2));
  });

  test("de dezembro avança para janeiro do ano seguinte", async () => {
    vi.setSystemTime(new Date("2026-12-10T12:00:00"));
    renderComo("ADMIN");
    await screen.findByText(/Dezembro \/ 2026/);
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    expect(await screen.findByText(/Janeiro \/ 2027/)).toBeTruthy();
    await waitFor(() => expect(getTipCommission).toHaveBeenLastCalledWith(2027, 1));
  });
});

describe("Tela da gorjeta: abas", () => {
  test("cada aba troca o conteúdo e repassa mês e permissão", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Apuração", "Vales", "Pagamento e envio", "Contabilidade e folha", "Equipe", "Funções e pontos", "Relatórios",
    ]);
    fireEvent.click(aba("Vales"));
    expect(screen.getByText(/stub-vales 2026-1 canEdit=true pedido=nenhum/)).toBeTruthy();
    expect(screen.queryByText(/stub-apuracao/)).toBeNull();
    fireEvent.click(aba("Pagamento e envio"));
    expect(screen.getByText(/stub-pagamento readonly=false/)).toBeTruthy();
    fireEvent.click(aba("Contabilidade e folha"));
    expect(screen.getByText("stub-contabilidade 2026-1")).toBeTruthy();
    fireEvent.click(aba("Equipe"));
    expect(screen.getByText("stub-equipe canEdit=true")).toBeTruthy();
    fireEvent.click(aba("Funções e pontos"));
    expect(screen.getByText(/stub-funcoes canEdit=true/)).toBeTruthy();
    fireEvent.click(aba("Relatórios"));
    expect(screen.getByText("stub-relatorios canEdit=true")).toBeTruthy();
    fireEvent.click(aba("Apuração"));
    expect(screen.getByText(/stub-apuracao readonly=false/)).toBeTruthy();
  });

  test("avisos que vêm de uma aba aparecem no topo da tela", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(aba("Funções e pontos"));
    fireEvent.click(screen.getByRole("button", { name: "avisar da aba" }));
    expect(await screen.findByText("Tabela de funções salva.")).toBeTruthy();
  });

  test("\"Vales\" sem período aberto mostra o estado vazio e o atalho volta para a Apuração", async () => {
    atual = SEM_PERIODO();
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(aba("Vales"));
    expect(screen.getByText("Nenhum período aberto em Janeiro/2026.")).toBeTruthy();
    expect(screen.queryByText(/stub-vales/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ir para a Apuração" }));
    expect(aba("Apuração").getAttribute("aria-selected")).toBe("true");
  });

  test("\"Vales de fulano\" na apuração leva à aba Vales com o pedido; trocar de aba e voltar descarta o pedido", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "ver vales de e1" }));
    expect(screen.getByText(/stub-vales 2026-1 canEdit=true pedido=e1/)).toBeTruthy();
    fireEvent.click(aba("Apuração"));
    fireEvent.click(aba("Vales"));
    expect(screen.getByText(/pedido=nenhum/)).toBeTruthy();
  });

  test("mudar de mês descarta o pedido de vales", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "ver vales de e1" }));
    fireEvent.click(screen.getByRole("button", { name: "Próximo mês" }));
    await screen.findByText(/Fevereiro \/ 2026/);
    await waitFor(() => expect(screen.getByText(/stub-vales 2026-2 canEdit=true pedido=nenhum/)).toBeTruthy());
  });
});

describe("Tela da gorjeta: abrir período", () => {
  test("sem período: explica e, com permissão de editar, abre o período e recarrega", async () => {
    atual = SEM_PERIODO();
    vi.mocked(openTipPeriod).mockImplementation(async () => { atual = comp(); return { id: "p1" } as never; });
    renderComo("ADMIN");
    expect(await screen.findByText("Nenhum período aberto para esta competência.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Abrir período/ }));
    await waitFor(() => expect(openTipPeriod).toHaveBeenCalledWith(2026, 1));
    expect(await screen.findByText(/Período aberto: serviço puxado do faturamento/)).toBeTruthy();
    expect(await screen.findByText(/stub-apuracao/)).toBeTruthy();
    expect(screen.queryByText("Nenhum período aberto para esta competência.")).toBeNull();
  });

  test("sem permissão de editar não há botão de abrir período", async () => {
    atual = SEM_PERIODO();
    renderComo({});
    await screen.findByText("Nenhum período aberto para esta competência.");
    expect(screen.queryByRole("button", { name: /Abrir período/ })).toBeNull();
  });

  test("falha ao abrir mostra o erro e continua sem período", async () => {
    atual = SEM_PERIODO();
    vi.mocked(openTipPeriod).mockRejectedValue(new Error("faturamento não fechado"));
    renderComo("ADMIN");
    fireEvent.click(await screen.findByRole("button", { name: /Abrir período/ }));
    expect(await screen.findByText("faturamento não fechado")).toBeTruthy();
    expect(screen.getByText("Nenhum período aberto para esta competência.")).toBeTruthy();
  });
});

describe("Tela da gorjeta: fechar e reabrir", () => {
  test("Fechar período só habilita com permissão de aprovar, conferência sem pendência e período aberto", async () => {
    renderComo({ edit: true, approve: true });
    await esperarCarga();
    expect((screen.getByRole("button", { name: /Fechar período/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("sem permissão de aprovar o botão fica desabilitado", async () => {
    renderComo({ edit: true });
    await esperarCarga();
    expect((screen.getByRole("button", { name: /Fechar período/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("conferência com diferença: botão desabilitado com a dica das pendências", async () => {
    atual = comp({ check: { expectedNetPool: 9000, sumRateios: 8900, ok: false, diff: 100 }, pendencias: ["Falta o ponto da Ana"] });
    renderComo("ADMIN");
    await esperarCarga();
    const botao = screen.getByRole("button", { name: /Fechar período/ }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.title).toBe("Resolva as pendências em vermelho antes de fechar.");
    expect(screen.getByText("stub-pendencias Falta o ponto da Ana")).toBeTruthy();
  });

  test("fechar pede confirmação com os valores; Voltar não fecha, Fechar período fecha, recarrega e avisa", async () => {
    atual = comp({ distribuido: 9000, pointValue: 100, saldo: 0 });
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Fechar período/ }));
    const caixa = await screen.findByRole("alertdialog");
    expect(within(caixa).getByText("Fechar a gorjeta de Janeiro/2026?")).toBeTruthy();
    expect(txt(caixa)).toContain("GOR-2026-0001");
    expect(txt(caixa)).toMatch(/Distribuído R\$\s?9\.000,00/);
    fireEvent.click(within(caixa).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(closeTipPeriodApi).not.toHaveBeenCalled();

    vi.mocked(closeTipPeriodApi).mockImplementation(async () => { atual = FECHADA(); return atual as never; });
    fireEvent.click(screen.getByRole("button", { name: /Fechar período/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Fechar período" }));
    await waitFor(() => expect(closeTipPeriodApi).toHaveBeenCalledWith(2026, 1));
    expect(await screen.findByText(/Período fechado\. O retrato completo ficou gravado/)).toBeTruthy();
    expect(await screen.findByText("Fechada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fechar período/ })).toBeNull();
  });

  test("a confirmação cita o saldo e para onde ele vai", async () => {
    atual = comp({ saldo: 80, saldoAoFundo: 80 } as Partial<TipComputation>);
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Fechar período/ }));
    const caixa = await screen.findByRole("alertdialog");
    expect(txt(caixa)).toMatch(/saldo de R\$\s?80,00 vai para o fundo de reserva/);
  });

  test("falha ao fechar mostra o erro e o período continua aberto", async () => {
    vi.mocked(closeTipPeriodApi).mockRejectedValue(new Error("mês travado"));
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Fechar período/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Fechar período" }));
    expect(await screen.findByText("mês travado")).toBeTruthy();
    expect(screen.getByText("Em apuração")).toBeTruthy();
  });

  test("período fechado mostra o registro e quem fechou; sem o botão de fechar", async () => {
    atual = FECHADA();
    renderComo("ADMIN");
    await esperarCarga();
    expect(screen.getByText(/Fechado — registro GOR-2026-0001\/v1, por Gestora Teste em/)).toBeTruthy();
    expect(screen.getByText(/stub-apuracao readonly=true/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fechar período/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Atualizar do cadastro/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Salvar parâmetros/ })).toBeNull();
  });

  test("reabrir só aparece para quem é administrador do módulo", async () => {
    atual = FECHADA();
    renderComo({ edit: true, approve: true });
    await esperarCarga();
    expect(screen.getByText(/Fechado — registro/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reabrir período/ })).toBeNull();
  });

  test("reabrir exige motivo de pelo menos 10 letras, mostra quantas faltam e grava o motivo aparado", async () => {
    atual = FECHADA();
    vi.mocked(reopenTipPeriodApi).mockImplementation(async () => { atual = comp(); return atual as never; });
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Reabrir período/ }));
    const confirmar = screen.getByRole("button", { name: "Confirmar reabertura" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
    expect(screen.getByText("faltam 10 letra(s) no motivo")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: "erro no" } });
    expect(screen.getByText("faltam 3 letra(s) no motivo")).toBeTruthy();
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo da reabertura"), { target: { value: "  erro no serviço  " } });
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    await waitFor(() => expect(reopenTipPeriodApi).toHaveBeenCalledWith(2026, 1, "erro no serviço"));
    expect(await screen.findByText("Período reaberto. O motivo ficou registrado.")).toBeTruthy();
    expect(await screen.findByText("Em apuração")).toBeTruthy();
    expect(screen.queryByLabelText("Motivo da reabertura")).toBeNull();
  });

  test("cancelar a reabertura fecha o campo e não chama o servidor", async () => {
    atual = FECHADA();
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Reabrir período/ }));
    fireEvent.click(screen.getByRole("button", { name: "cancelar" }));
    expect(screen.queryByLabelText("Motivo da reabertura")).toBeNull();
    expect(screen.getByRole("button", { name: /Reabrir período/ })).toBeTruthy();
    expect(reopenTipPeriodApi).not.toHaveBeenCalled();
  });
});

describe("Tela da gorjeta: edição do período (permissão e estado)", () => {
  test("com permissão de editar e período aberto: parâmetros, atualizar do cadastro e ajuste do serviço disponíveis", async () => {
    renderComo({ edit: true });
    await esperarCarga();
    expect(screen.getByText("Parâmetros do período")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Salvar parâmetros/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Atualizar do cadastro/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ajustar serviço" })).toBeTruthy();
    expect(screen.getByText(/stub-apuracao readonly=false/)).toBeTruthy();
  });

  test("somente leitura: sem salvar, sem atualizar, sem ajuste, campos desabilitados e apuração em modo leitura", async () => {
    renderComo({});
    await esperarCarga();
    expect(screen.queryByRole("button", { name: /Salvar parâmetros/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Atualizar do cadastro/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "ajustar serviço" })).toBeNull();
    expect(screen.getByText(/sem ajuste/)).toBeTruthy();
    expect(screen.getByText(/stub-apuracao readonly=true/)).toBeTruthy();
    expect((screen.getByLabelText(/Retenção/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Fechar período/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("resumo dos parâmetros descreve os descontos e a regra da sobra", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    const resumo = txt(screen.getByText("Parâmetros do período").closest("summary"));
    expect(resumo).toContain("26 dias padrão");
    expect(resumo).toContain("descontam: falta, atestado, férias, afastamento");
    expect(resumo).toContain("sobra: fundo de reserva");
    expect(resumo).toContain("parte de quem saiu: fica com quem continua");
  });

  test("salvar parâmetros envia o que está na tela e recarrega", async () => {
    vi.mocked(updateTipPeriod).mockResolvedValue({} as never);
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.change(screen.getByLabelText(/Retenção/), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/Quebra/), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Férias"));
    fireEvent.click(screen.getByRole("button", { name: /Salvar parâmetros/ }));
    await waitFor(() => expect(updateTipPeriod).toHaveBeenCalledTimes(1));
    const [id, payload] = vi.mocked(updateTipPeriod).mock.calls[0];
    expect(id).toBe("p1");
    expect(payload).toMatchObject({
      deductionPercent: 12, quebraPct: 2, pointsTotal: 100, diasPadrao: 26, descontaFerias: false, descontaFalta: true,
      destinoSobra: "FUNDO", sobraRescisaoParaSaldo: false, reservaPontos: 0,
    });
    expect(payload).not.toHaveProperty("periodStart"); // datas não mudaram
    expect(await screen.findByText("Parâmetros do período salvos.")).toBeTruthy();
    expect(getTipCommission).toHaveBeenCalledTimes(2);
  });

  test("mudar as datas envia início e fim", async () => {
    vi.mocked(updateTipPeriod).mockResolvedValue({} as never);
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.change(screen.getByLabelText("Fim"), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar parâmetros/ }));
    await waitFor(() => expect(updateTipPeriod).toHaveBeenCalled());
    expect(vi.mocked(updateTipPeriod).mock.calls[0][1]).toMatchObject({ periodStart: "2025-12-26", periodEnd: "2026-01-31" });
  });

  test("retenção + quebra acima de 100% é recusada antes de chamar o servidor", async () => {
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.change(screen.getByLabelText(/Quebra/), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar parâmetros/ }));
    expect(await screen.findByText("Retenção e quebra precisam ficar entre 0% e 100% somadas.")).toBeTruthy();
    expect(updateTipPeriod).not.toHaveBeenCalled();
  });

  test("ajuste do serviço: abre o painel, salva com o motivo, recarrega e avisa", async () => {
    vi.mocked(updateTipPeriod).mockResolvedValue({} as never);
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "ajustar serviço" }));
    fireEvent.click(await screen.findByRole("button", { name: "salvar ajuste" }));
    await waitFor(() => expect(updateTipPeriod).toHaveBeenCalledWith("p1", { ajusteServico: 50, ajusteServicoMotivo: "acordo do mês" }));
    expect(await screen.findByText("Serviço arrecadado ajustado.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("stub-ajuste-servico")).toBeNull());
  });
});

describe("Tela da gorjeta: atualizar do cadastro", () => {
  const sincronizado = (over: Partial<{ added: number; elegiveis: number; atualizados: number; removidos: number }>) =>
    ({ added: 2, elegiveis: 5, atualizados: 1, computation: comp(), ...over });

  test("mostra quantos foram incluídos e atualizados", async () => {
    vi.mocked(syncTipParticipants).mockResolvedValue(sincronizado({}));
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar do cadastro/ }));
    await waitFor(() => expect(syncTipParticipants).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText("2 incluído(s) e 1 atualizado(s) do cadastro.")).toBeTruthy();
  });

  test("avisa quantos saíram da apuração quando houve remoção", async () => {
    vi.mocked(syncTipParticipants).mockResolvedValue(sincronizado({ removidos: 2 }));
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar do cadastro/ }));
    expect(await screen.findByText(/2 saiu\(íram\): só recebia\(m\) salário e deixou\(aram\) de ter direito\./)).toBeTruthy();
  });

  test("ninguém marcado como participante: avisa para marcar a equipe", async () => {
    vi.mocked(syncTipParticipants).mockResolvedValue(sincronizado({ elegiveis: 0, added: 0, atualizados: 0 }));
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar do cadastro/ }));
    expect(await screen.findByText(/Ninguém está marcado como participante/)).toBeTruthy();
  });

  test("falha ao atualizar mostra o erro", async () => {
    vi.mocked(syncTipParticipants).mockRejectedValue(new Error("cadastro fora do ar"));
    renderComo("ADMIN");
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar do cadastro/ }));
    expect(await screen.findByText("cadastro fora do ar")).toBeTruthy();
  });
});
