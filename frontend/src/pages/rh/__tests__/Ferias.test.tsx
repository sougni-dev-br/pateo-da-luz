import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getFerias: vi.fn(),
  programarFerias: vi.fn(async () => ({ id: "f1" })),
  atualizarFerias: vi.fn(async () => ({ id: "f1" })),
  marcarFeriasGozadas: vi.fn(async () => ({ id: "f2" })),
  cancelarFerias: vi.fn(async () => ({ ok: true })),
}));

import { type ListaFerias, type PeriodoFerias, atualizarFerias, cancelarFerias, getFerias, marcarFeriasGozadas, programarFerias } from "../../../api/client";
import { Ferias } from "../Ferias";

// Os testes da lista abrem na visão "lista"; a linha do tempo (visão padrão) tem os seus.
const render = (ui: ReactElement, rota = "/rh/ferias") => renderRaw(<MemoryRouter initialEntries={[rota.includes("?") ? `${rota}&visao=lista` : `${rota}?visao=lista`]}>{ui}</MemoryRouter>);

const periodo = (o: Partial<PeriodoFerias> = {}): PeriodoFerias => ({
  aquisitivoInicio: "2025-03-01", aquisitivoFim: "2026-02-28", limiteInicioGozo: "2027-01-30", fimConcessivo: "2027-02-28",
  diasDireito: 30, diasGozados: 0, diasProgramados: 0, diasAbono: 0, diasPendentes: 30,
  situacao: "DISPONIVEL", nivel: "ok", diasParaLimite: 107, diasParaCompletar: null,
  foraDoPrazo: false, doHistorico: false, programacoes: [], ...o,
});
const lista = (periodos: PeriodoFerias[], resumo = { vencidas: 0, aVencer: 0 }): ListaFerias => ({
  hoje: "2026-10-15", semDataDeAdmissao: [], resumo, feriados: {},
  pessoas: [{ employeeId: "e1", nome: "Ana Souza", empresa: "Pateo", setor: null, repousoSemanal: [0], repousoPelaEscala: false, admissao: "2025-03-01", nivel: "ok", periodos }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Ferias", () => {
  test("mostra o limite, o prazo e avisa quando há férias vencidas", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo({ situacao: "VENCIDA", nivel: "perigo", diasParaLimite: -12 })], { vencidas: 1, aVencer: 0 }));
    render(<Ferias />);
    expect((await screen.findAllByText("30/01/2027")).length).toBeGreaterThan(0); // na lista e no quadro "Quem tem direito"
    expect(screen.getAllByText("venceu há 12 dias").length).toBeGreaterThan(0);
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Quem tem direito a férias" })).getByText("Prazo vencido")).toBeInTheDocument();
    expect(screen.getByText(/1 período vencido ou programado fora do prazo/)).toBeInTheDocument();
  });

  test("o quadro Quem tem direito responde à busca por nome, com ou sem acento", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    const quadro = await screen.findByRole("region", { name: "Quem tem direito a férias" });
    expect(within(quadro).getByText("Ainda há tempo")).toBeInTheDocument();
    fireEvent.change(within(quadro).getByRole("searchbox"), { target: { value: "zzz" } });
    expect(within(quadro).getByText("Ninguém com esse nome na lista.")).toBeInTheDocument();
  });

  test("programa as férias pelo formulário e recarrega a lista", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-12-01" } });
    expect(within(form).getByText(/volta ao trabalho em/)).toHaveTextContent("31/12/2026");
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    await waitFor(() => expect(programarFerias).toHaveBeenCalledWith("e1", {
      aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", dias: 30, diasAbono: 0, observacao: undefined,
    }));
    await waitFor(() => expect(getFerias).toHaveBeenCalledTimes(2));
  });

  test("vender o abono reduz os dias sugeridos e envia o abono", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.click(within(form).getByRole("checkbox"));
    expect(within(form).getByLabelText(/^Dias de férias/)).toHaveValue(20);
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-12-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    await waitFor(() => expect(programarFerias).toHaveBeenCalledWith("e1", expect.objectContaining({ dias: 20, diasAbono: 10 })));
  });

  test("data depois do limite avisa que vence e a antes do fim do aquisitivo bloqueia", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2027-02-20" } });
    expect(within(form).getByText(/pagas em dobro/)).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-02-01" } });
    expect(within(form).getByText("Só depois do fim do período aquisitivo.")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    expect(programarFerias).not.toHaveBeenCalled();
  });

  test("mostra o erro do servidor dentro do formulário", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    vi.mocked(programarFerias).mockRejectedValueOnce(new Error("Esse período tem 10 dia(s) a programar."));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-12-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    expect(await within(form).findByText("Esse período tem 10 dia(s) a programar.")).toBeInTheDocument();
  });

  test("férias programadas: confirma que gozou e cancela", async () => {
    const programada = { id: "f1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-10-01", gozoFim: "2026-10-30", dias: 30, diasAbono: 0, status: "PROGRAMADA" as const, observacao: null, passouDaData: true };
    vi.mocked(getFerias).mockResolvedValue(lista([periodo({ situacao: "PROGRAMADA", diasPendentes: 0, diasProgramados: 30, diasParaLimite: null, programacoes: [programada] })]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: /Programadas/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Confirmar que gozou/ }));
    await waitFor(() => expect(atualizarFerias).toHaveBeenCalledWith("f1", { status: "GOZADA" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Cancelar programação de Ana Souza/ }));
    await waitFor(() => expect(cancelarFerias).toHaveBeenCalledWith("f1"));
  });

  test("Já gozou quita o período sem datas depois de confirmar", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Já gozou, período de Ana Souza" }));
    await waitFor(() => expect(marcarFeriasGozadas).toHaveBeenCalledWith("e1", "2025-03-01"));
    expect(window.confirm).toHaveBeenCalled();
  });

  test("o filtro vem do endereço e a escolha de outro filtro troca a lista", async () => {
    const programada = { id: "f1", aquisitivoInicio: "2025-03-01", gozoInicio: "2026-12-01", gozoFim: "2026-12-30", dias: 30, diasAbono: 0, status: "PROGRAMADA" as const, observacao: null, passouDaData: false };
    vi.mocked(getFerias).mockResolvedValue(lista([periodo({ situacao: "PROGRAMADA", diasPendentes: 0, diasProgramados: 30, diasParaLimite: null, programacoes: [programada] })]));
    render(<Ferias />, "/rh/ferias?filtro=PROGRAMADAS");
    expect(await screen.findByText("01/12/2026 a 30/12/2026 · 30 dias")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /A programar/ }));
    expect(await screen.findByText("Nada neste filtro")).toBeInTheDocument();
  });

  test("avisa em voz alta o que foi gravado e foca o primeiro campo ao abrir o formulário", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    expect(within(form).getByLabelText(/^Início das férias/)).toHaveFocus();
    fireEvent.change(within(form).getByLabelText(/^Início das férias/), { target: { value: "2026-12-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    expect(await screen.findByText(/Férias de Ana Souza programadas: 01\/12\/2026 \(30 dias\)/)).toBeInTheDocument();
  });

  test("Esc fecha o formulário sem gravar", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    fireEvent.keyDown(screen.getByRole("form", { name: "Programar férias de Ana Souza" }), { key: "Escape" });
    expect(screen.queryByRole("form")).toBeNull();
    expect(programarFerias).not.toHaveBeenCalled();
  });

  test("submeter vazio mostra o que falta e foca o primeiro campo com problema", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.click(within(form).getByRole("button", { name: "Programar" }));
    expect(await within(form).findByText("Informe a data de início.")).toBeInTheDocument();
    await waitFor(() => expect(within(form).getByLabelText(/^Início das férias/)).toHaveFocus());
    expect(within(form).getByLabelText(/^Início das férias/)).toHaveAttribute("aria-invalid", "true");
    expect(programarFerias).not.toHaveBeenCalled();
  });

  test("não deixa sobrar menos de 5 dias", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    fireEvent.click(await screen.findByRole("button", { name: "Programar férias de Ana Souza" }));
    const form = screen.getByRole("form", { name: "Programar férias de Ana Souza" });
    fireEvent.change(within(form).getByLabelText(/^Dias de férias/), { target: { value: "26" } });
    expect(within(form).getByText(/Sobrariam 4 dias/)).toBeInTheDocument();
  });

  test("Cancelar devolve o foco ao botão que abriu o formulário", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    const abrir = await screen.findByRole("button", { name: "Programar férias de Ana Souza" });
    abrir.focus();
    fireEvent.click(abrir);
    fireEvent.click(within(screen.getByRole("form")).getByRole("button", { name: /^Cancelar/ }));
    await waitFor(() => expect(abrir).toHaveFocus());
  });

  test("Desfazer um período já gozado o cancela depois de confirmar", async () => {
    const gozada = { id: "g1", aquisitivoInicio: "2025-03-01", gozoInicio: null, gozoFim: null, dias: 30, diasAbono: 0, status: "GOZADA" as const, observacao: null, passouDaData: false };
    vi.mocked(getFerias).mockResolvedValue(lista([periodo({ situacao: "GOZADA", diasPendentes: 0, diasGozados: 30, diasParaLimite: null, programacoes: [gozada] })]));
    render(<Ferias />, "/rh/ferias?filtro=GOZADAS");
    fireEvent.click(await screen.findByRole("button", { name: /^Desfazer férias gozadas de Ana Souza/ }));
    await waitFor(() => expect(cancelarFerias).toHaveBeenCalledWith("g1"));
    expect(await screen.findByText(/Registro desfeito/)).toBeInTheDocument();
  });

  test("período programado depois do prazo aparece em A programar (é o que o Dashboard conta)", async () => {
    const tarde = { id: "t1", aquisitivoInicio: "2025-03-01", gozoInicio: "2027-02-25", gozoFim: "2027-03-06", dias: 10, diasAbono: 0, status: "PROGRAMADA" as const, observacao: null, passouDaData: false };
    vi.mocked(getFerias).mockResolvedValue(lista([periodo({ situacao: "PROGRAMADA", nivel: "perigo", foraDoPrazo: true, diasPendentes: 0, programacoes: [tarde] })], { vencidas: 1, aVencer: 0 }));
    render(<Ferias />);
    expect(await screen.findByText("Fora do prazo")).toBeInTheDocument();
  });

  test("todo botão com nome acessível próprio começa pelo texto visível (WCAG 2.5.3)", async () => {
    vi.mocked(getFerias).mockResolvedValue(lista([periodo()]));
    render(<Ferias />);
    await screen.findByRole("button", { name: "Programar férias de Ana Souza" });
    for (const b of screen.getAllByRole("button")) {
      const rotulo = b.getAttribute("aria-label");
      const visivel = (b.textContent ?? "").trim();
      if (rotulo && visivel) expect(rotulo.toLowerCase()).toContain(visivel.toLowerCase());
    }
  });

  test("sem ninguém para listar mostra o estado vazio", async () => {
    vi.mocked(getFerias).mockResolvedValue({ hoje: "2026-10-15", pessoas: [], semDataDeAdmissao: [{ employeeId: "x", nome: "Sem Data" }], resumo: { vencidas: 0, aVencer: 0 }, feriados: {} });
    render(<Ferias />);
    expect(await screen.findByText("Nenhum período de férias")).toBeInTheDocument();
    expect(screen.getByText(/Sem Data/)).toBeInTheDocument();
  });
});
