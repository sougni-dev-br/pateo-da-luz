import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getFerias: vi.fn(),
  programarFerias: vi.fn(async () => ({ id: "f1" })),
  atualizarFerias: vi.fn(async () => ({ id: "f1" })),
  salvarSolicitacaoFerias: vi.fn(async () => ({ id: "s9" })),
  removerSolicitacaoFerias: vi.fn(async () => ({ ok: true })),
  marcarFeriasAvisado: vi.fn(async () => ({ id: "g1", avisadoEm: "2026-10-16T12:00:00.000Z" })),
  marcarFeriasGozadas: vi.fn(async () => ({ id: "f2" })),
  cancelarFerias: vi.fn(async () => ({ ok: true })),
}));

import { type ListaFerias, type PeriodoFerias, type PessoaFerias, cancelarFerias, getFerias, marcarFeriasAvisado, programarFerias, removerSolicitacaoFerias, salvarSolicitacaoFerias } from "../../../api/client";
import { Ferias } from "../Ferias";

const render = (ui: ReactElement, rota = "/rh/ferias") => renderRaw(<MemoryRouter initialEntries={[rota]}>{ui}</MemoryRouter>);

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const pessoa = (id: string, nome: string, periodos: PeriodoFerias[]): PessoaFerias => ({ employeeId: id, nome, empresa: "Pateo", setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos });
const FERIADOS = { "2026-11-20": "Consciência Negra", "2026-12-25": "Natal" };
const lista = (pessoas: PessoaFerias[]): ListaFerias => ({ hoje: "2026-10-15", semDataDeAdmissao: [], resumo: { vencidas: 0, aVencer: 0 }, pessoas, feriados: FERIADOS });

// Bruno já está de férias de 16/10 a 31/12: a sugestão para a Ana tem de fugir disso.
const bruno = pessoa("e2", "Bruno Lima", [periodo({
  diasPendentes: 0, situacao: "PROGRAMADA", diasProgramados: 30,
  programacoes: [{ id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-10-16", gozoFim: "2026-12-31", dias: 30, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false }],
})]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Férias — linha do tempo", () => {
  test("abre na linha do tempo, com uma linha por pessoa e a barra de quem já programou", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()]), bruno]));
    render(<Ferias />);
    expect(await screen.findByRole("list", { name: "Férias por pessoa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Férias programadas de Bruno Lima: 16\/10\/2026 a 31\/12\/2026, 30 dias/ })).toBeInTheDocument();
    expect(screen.getByText("até 1 ao mesmo tempo")).toBeInTheDocument();
  });

  test("Programar já abre o formulário com a sugestão que foge de quem está fora", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()]), bruno]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    // Bruno ocupa até 31/12; 01/01 é sexta e 02-03/01 são fim de semana: a primeira segunda livre é 04/01.
    expect(within(form).getByLabelText(/^Início das férias/)).toHaveValue("2027-01-04");
    expect(within(form).getByLabelText(/^Dias de férias/)).toHaveValue(30);
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    await waitFor(() => expect(programarFerias).toHaveBeenCalledWith("e1", expect.objectContaining({ gozoInicio: "2027-01-04", dias: 30 })));
  });

  test("avisa quem já estará fora quando as datas escolhidas se sobrepõem", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()]), bruno]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-11-10" } });
    expect(within(form).getByText(/já estará fora: Bruno Lima/)).toBeInTheDocument();
  });

  test("não deixa começar em dia vedado e oferece o próximo dia permitido", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-11-18" } }); // 2 dias antes do feriado
    expect(within(form).getAllByText(/faltam 2 dias para o feriado Consciência Negra/).length).toBeGreaterThan(0);
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    expect(programarFerias).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("button", { name: "Usar esse dia" }));
    expect(within(form).getByLabelText(/^Início das férias/)).toHaveValue("2026-11-23");
    expect(within(form).getByText(/Pagar as férias até/)).toHaveTextContent("21/11/2026");
  });

  test("avisa quando falta menos de 30 dias para o início", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-11-02" } });
    expect(within(form).getByText(/art\. 135/)).toBeInTheDocument();
  });

  test("tela cheia: o botão alterna e o Esc sai", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    const { container } = render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Tela cheia" }));
    expect(container.querySelector(".fe-tela--cheia")).not.toBeNull();
    expect(document.body.classList.contains("fe-sem-rolagem")).toBe(true);
    expect(screen.getByRole("button", { name: "Sair da tela cheia" })).toHaveAttribute("aria-pressed", "true");
    // Na tela cheia avisos, planejamento e filtros recolhem atrás de uma linha-resumo; fora dela ficam à vista.
    const resumo = container.querySelector("details.fe-cabeca > summary");
    expect(resumo?.textContent).toMatch(/a programar · \d+ programadas/);
    expect(container.querySelector("details.fe-cabeca")).not.toHaveAttribute("open");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(container.querySelector(".fe-tela--cheia")).toBeNull());
    expect(container.querySelector("details.fe-cabeca")).toBeNull();
    expect(document.body.classList.contains("fe-sem-rolagem")).toBe(false);
  });

  test("o planejamento resume os dias fora e os prazos de aviso", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([bruno]));
    render(<Ferias />);
    expect(await screen.findByText(/dias de férias nos próximos 12 meses/)).toBeInTheDocument();
    expect(screen.getByText(/Avisar até/)).toBeInTheDocument();
  });

  test("o formulário diz qual repouso semanal foi considerado", async () => {
    const ana = { ...pessoa("e1", "Ana Souza", [periodo()]), repousoSemanal: [2], repousoPelaEscala: true };
    vi.mocked(getFerias).mockResolvedValue(lista([ana]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    expect(within(form).getByText(/Repouso considerado: ter \(pela escala\)/)).toBeInTheDocument();
  });

  test("ano com 5 dígitos no campo de data não derruba a tela", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "20266-10-16" } });
    expect(within(form).getByText("Data inválida.")).toBeInTheDocument();
  });

  test("Imprimir tela abre a janela da visão que está na tela, e Folhas por empresa continua à parte", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir tela" }));
    expect(screen.getByRole("dialog", { name: "Imprimir a tela" })).toHaveTextContent("A linha do tempo como está na tela");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    fireEvent.click(await screen.findByRole("button", { name: "Imprimir tela" }));
    expect(screen.getByRole("dialog", { name: "Imprimir a tela" })).toHaveTextContent("A lista como está na tela");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Folhas por empresa" }));
    expect(screen.getByRole("dialog", { name: "Imprimir férias por empresa" })).toBeInTheDocument();
  });

  test("Já avisei registra o aviso e o botão vira \"Avisado em\", que dá para desfazer", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([bruno]));
    const { container } = render(<Ferias />);
    await screen.findByRole("button", { name: /Férias programadas de Bruno Lima/ });
    container.querySelector<HTMLElement>(".fe-plano > summary")?.click();
    fireEvent.click(await screen.findByRole("button", { name: "Marcar que Bruno Lima foi avisado" }));
    await waitFor(() => expect(marcarFeriasAvisado).toHaveBeenCalledWith("g1", true));
    // Com o aviso devolvido pelo servidor a linha passa a mostrar a data e a opção de desfazer.
    vi.mocked(getFerias).mockResolvedValue(lista([{ ...bruno, periodos: [{ ...bruno.periodos[0], programacoes: [{ ...bruno.periodos[0].programacoes[0], avisadoEm: "2026-10-16T12:00:00.000Z" }] }] }]));
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(await screen.findByText(/Avisado em 16\/10\/2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desfazer o aviso de Bruno Lima" }));
    await waitFor(() => expect(marcarFeriasAvisado).toHaveBeenLastCalledWith("g1", false));
  });

  test("registrar o pedido do colaborador grava com o período e as datas pedidas", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pedido de férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Pedido de férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início pedido/), { target: { value: "2026-12-15" } });
    fireEvent.change(within(form).getByLabelText(/^Dias pedidos/), { target: { value: "15" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar pedido" }));
    await waitFor(() => expect(salvarSolicitacaoFerias).toHaveBeenCalledWith({
      employeeId: "e1", aquisitivoInicio: "2025-03-01", inicio: "2026-12-15", dias: 15, diasAbono: 0, observacao: undefined,
    }));
  });

  test("o pedido não bloqueia dia vedado: só avisa que a empresa não poderá programar assim", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar pedido de férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Pedido de férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início pedido/), { target: { value: "2026-11-18" } }); // 2 dias antes do feriado
    expect(within(form).getByText(/A empresa não vai poder programar começando em/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Registrar pedido" }));
    await waitFor(() => expect(salvarSolicitacaoFerias).toHaveBeenCalled());
  });

  test("a linha do tempo mostra o pedido, o que a empresa quer e o prazo limite", async () => {
    const comPedido = periodo({
      solicitacao: { id: "s1", inicio: "2026-12-14", fim: "2026-12-28", dias: 15, diasAbono: 0, observacao: null, registradaEm: "2026-10-20T12:00:00.000Z" },
      programacoes: [{ id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-21", gozoFim: "2027-01-04", dias: 15, diasAbono: 0, status: "PROGRAMADA", observacao: null, passouDaData: false }],
      diasPendentes: 15,
    });
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [comPedido])]));
    render(<Ferias />);
    const ficha = await screen.findByRole("list", { name: "Pedido, empresa e prazo de Ana Souza" });
    expect(within(ficha).getByText(/14\/12\/2026 a 28\/12\/2026 · 15 dias/)).toBeInTheDocument();
    expect(within(ficha).getByText(/21\/12\/2026 a 04\/01\/2027 · 15 dias/)).toBeInTheDocument();
    expect(within(ficha).getByText(/começar até 30\/01\/2027/)).toBeInTheDocument();
    expect(within(ficha).getByText("Empresa quer outra data")).toBeInTheDocument();
    expect(within(ficha).getByText(/7 dias depois do pedido/)).toBeInTheDocument();
  });

  test("Atender abre a programação já com as datas do pedido, e ela diz que é o que o colaborador pediu", async () => {
    const comPedido = periodo({ solicitacao: { id: "s1", inicio: "2026-12-14", fim: "2026-12-28", dias: 15, diasAbono: 0, observacao: null, registradaEm: "2026-10-20T12:00:00.000Z" } });
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [comPedido])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Pedido de férias de Ana Souza" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Pedido de férias de Ana Souza" })).getByRole("button", { name: "Atender: programar estas datas" }));
    const programar = await screen.findByRole("form", { name: "Programar férias de Ana Souza" });
    expect(within(programar).getByLabelText(/^Início das férias/)).toHaveValue("2026-12-14");
    expect(within(programar).getByLabelText(/^Dias de férias/)).toHaveValue(15);
    expect(within(programar).getByText("É exatamente o que o colaborador pediu.")).toBeInTheDocument();
  });

  test("retirar o pedido pede confirmação e chama o servidor", async () => {
    const comPedido = periodo({ solicitacao: { id: "s1", inicio: "2026-12-14", fim: "2026-12-28", dias: 15, diasAbono: 0, observacao: null, registradaEm: "2026-10-20T12:00:00.000Z" } });
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [comPedido])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Pedido de férias de Ana Souza" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Pedido de férias de Ana Souza" })).getByRole("button", { name: "Retirar pedido" }));
    await waitFor(() => expect(removerSolicitacaoFerias).toHaveBeenCalledWith("s1"));
  });

  test("clicar na barra mostra as opções e cancelar a programação chama o servidor", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([bruno]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: /Férias programadas de Bruno Lima/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancelar programação de Bruno Lima/ }));
    await waitFor(() => expect(cancelarFerias).toHaveBeenCalledWith("g1"));
  });

  test("a visão Lista continua disponível e guarda a escolha no endereço", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([pessoa("e1", "Ana Souza", [periodo()])]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: /Lista/ }));
    expect(await screen.findByRole("list", { name: "Períodos de férias" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Férias por pessoa" })).not.toBeInTheDocument();
  });
});
