import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BuffetAnalysis, BuffetAnalysisItem } from "../../../../api/client";

vi.mock("../../../../api/client", () => ({ getBuffetAnalysis: vi.fn() }));

import { getBuffetAnalysis } from "../../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../../context/SessionContext";
import { HideValuesProvider } from "../../../../design-system";
import { ResultadoBuffet } from "../ResultadoBuffet";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const m = <T extends (...a: never[]) => unknown>(f: T) => vi.mocked(f);

const prato = (o: Partial<BuffetAnalysisItem>): BuffetAnalysisItem => ({
  itemId: "a", name: "Arroz branco", category: null, days: 5, daysWithLeftover: 5, daysForPerPerson: 5, producedG: 50000, leftoverG: 10000, consumedG: 40000, leftoverPct: 0.2,
  gPerPerson: 160, costPerKg: 8, leftoverCost: 80, consumedCost: 320, costPerPerson: 1.28, signals: [], ...o,
});
const dia = { date: "2026-11-18", people: 50, revenue: 4500, producedG: 10000, leftoverG: 2000, consumedG: 8000, itemsProduced: 1, itemsWithLeftover: 1, producedCost: 80, leftoverCost: 16, consumedCost: 64, itemsWithCost: 1, gPerPerson: 160, costPerPerson: 1.6, revenuePerPerson: 90, marginPerPerson: 88.4 };
const resumo = { days: 12, daysWithPeople: 12, daysWithFullCost: 12, people: 600, producedG: 120000, leftoverG: 24000, consumedG: 96000, leftoverPct: 0.2, producedCost: 960, leftoverCost: 192, consumedCost: 768, revenue: 54000, costPerPerson: 1.6, revenuePerPerson: 90, marginPerPerson: 88.4, gPerPerson: 160 };
const analise = (o: Partial<BuffetAnalysis> = {}): BuffetAnalysis => ({
  from: "2026-10-20", to: "2026-11-18", kind: "BUFFET", costVisible: true, days: [dia], items: [prato({})], summary: resumo, lastDayItemIds: ["a"], ...o,
});

beforeEach(() => { vi.clearAllMocks(); m(getBuffetAnalysis).mockResolvedValue(analise()); });

describe("resultado do buffet", () => {
  test("mostra o resumo com custo, receita e margem por pessoa", async () => {
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText("Margem por pessoa")).toBeInTheDocument();
    expect(screen.getByText("Custo por pessoa")).toBeInTheDocument();
    expect(screen.getByText("Receita por pessoa")).toBeInTheDocument();
    expect(screen.getByText("600")).toBeInTheDocument();
    expect(screen.getByText("96 kg")).toBeInTheDocument();
    expect(screen.getAllByText("160 g").length).toBeGreaterThan(0);
  });

  test("pede o período e o tipo escolhidos", async () => {
    render(<ResultadoBuffet ativa />);
    await screen.findByText("Margem por pessoa");
    const [from, to, kind] = m(getBuffetAnalysis).mock.calls[0];
    expect(kind).toBe("BUFFET");
    expect(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)).toBe(29 * 86_400_000);
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 dias" }));
    await waitFor(() => expect(m(getBuffetAnalysis).mock.calls.length).toBe(2));
    const [f2, t2] = m(getBuffetAnalysis).mock.calls[1];
    expect(Date.parse(`${t2}T00:00:00Z`) - Date.parse(`${f2}T00:00:00Z`)).toBe(6 * 86_400_000);
  });

  test("sem permissão de custos some tudo que é R$: só quilos, pessoas e sobra", async () => {
    m(getBuffetAnalysis).mockResolvedValue(analise({ costVisible: false }));
    render(<ResultadoBuffet ativa />);
    await screen.findByText("Dias pesados");
    expect(screen.queryByText("Custo por pessoa")).not.toBeInTheDocument();
    expect(screen.queryByText("Margem por pessoa")).not.toBeInTheDocument();
    expect(screen.queryByText("R$/kg")).not.toBeInTheDocument();
    expect(screen.queryByText("Sobra em R$")).not.toBeInTheDocument();
    expect(screen.getAllByText("Sobra").length).toBeGreaterThan(0);
  });

  test("avisa quando há poucos dias pesados e quando há prato sem sobra pesada", async () => {
    m(getBuffetAnalysis).mockResolvedValue(analise({ summary: { ...resumo, days: 2 }, items: [prato({ daysWithLeftover: 0, leftoverPct: null, gPerPerson: null, signals: ["POUCOS_DIAS"] })] }));
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText(/Só 2 dias pesados/)).toBeInTheDocument();
    expect(screen.getByText(/1 prato sem sobra pesada/)).toBeInTheDocument();
  });

  test("mostra os sinais do prato: sobra alta e quase não sobra", async () => {
    m(getBuffetAnalysis).mockResolvedValue(analise({ items: [prato({ itemId: "x", name: "Lasanha", signals: ["SOBRA_ALTA"] }), prato({ itemId: "y", name: "Farofa", signals: ["PODE_FALTAR"] })] }));
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText(/Sobra alta: fazer menos/)).toBeInTheDocument();
    expect(screen.getByText(/Quase não sobra: pode ter acabado/)).toBeInTheDocument();
  });

  test("sem pesagem no período mostra orientação em vez de números", async () => {
    m(getBuffetAnalysis).mockResolvedValue(analise({ days: [], items: [], summary: { ...resumo, days: 0, people: 0, daysWithPeople: 0 } }));
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText("Nenhuma pesagem neste período")).toBeInTheDocument();
    expect(screen.queryByText("Margem por pessoa")).not.toBeInTheDocument();
  });

  test("erro da API aparece na tela", async () => {
    m(getBuffetAnalysis).mockRejectedValue(new Error("Escolha um período de no máximo 366 dias."));
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText("Escolha um período de no máximo 366 dias.")).toBeInTheDocument();
  });

  test("aba inativa não consulta o servidor", () => {
    render(<ResultadoBuffet ativa={false} />);
    expect(getBuffetAnalysis).not.toHaveBeenCalled();
  });

  test("planejar: sugere a média de pessoas e calcula quilos e custo", async () => {
    render(<ResultadoBuffet ativa />);
    const total = await screen.findByTestId("res-plano-total");
    // média 600 / 12 = 50 pessoas; 160 g × 50 × 1,10 = 8,8 kg; × R$ 8 = R$ 70,40
    expect(screen.getByLabelText(/Pessoas esperadas/)).toHaveValue("50");
    expect(total).toHaveTextContent(/Para 50 pessoas, com 1 prato: 8,8 kg/);
    expect(total).toHaveTextContent(/70,40/);
    fireEvent.change(screen.getByLabelText(/Pessoas esperadas/), { target: { value: "100" } });
    expect(screen.getByTestId("res-plano-total")).toHaveTextContent(/Para 100 pessoas, com 1 prato: 17,6 kg/);
  });

  test("planejar: pessoas inválidas não geram plano", async () => {
    render(<ResultadoBuffet ativa />);
    await screen.findByTestId("res-plano-total");
    fireEvent.change(screen.getByLabelText(/Pessoas esperadas/), { target: { value: "0" } });
    expect(screen.queryByTestId("res-plano-total")).not.toBeInTheDocument();
    expect(screen.getByText(/Informe de 1 a 5000/)).toBeInTheDocument();
  });

  test("planejar: sem pratos com histórico explica o que falta", async () => {
    m(getBuffetAnalysis).mockResolvedValue(analise({ items: [prato({ daysWithLeftover: 1, daysForPerPerson: 1, signals: ["POUCOS_DIAS"] })] }));
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText(/Ainda não há pratos com histórico suficiente/)).toBeInTheDocument();
  });

  const rodizio = () => analise({
    lastDayItemIds: ["a"],
    items: [prato({ itemId: "a", name: "Arroz branco" }), prato({ itemId: "b", name: "Feijão", gPerPerson: 100, costPerKg: 10 }), prato({ itemId: "c", name: "Lasanha", gPerPerson: 200, costPerKg: 20 })],
  });

  test("planejar: só o último cardápio vem marcado — o rodízio do período não é somado", async () => {
    m(getBuffetAnalysis).mockResolvedValue(rodizio());
    render(<ResultadoBuffet ativa />);
    const total = await screen.findByTestId("res-plano-total");
    // só o arroz: 160 g × 50 × 1,10 = 8,8 kg (e não os 3 pratos juntos)
    expect(total).toHaveTextContent(/com 1 prato: 8,8 kg/);
    expect(screen.getByLabelText("Servir Arroz branco")).toBeChecked();
    expect(screen.getByLabelText("Servir Feijão")).not.toBeChecked();
  });

  test("planejar: marcar mais pratos soma só os marcados; Todos e Nenhum", async () => {
    m(getBuffetAnalysis).mockResolvedValue(rodizio());
    render(<ResultadoBuffet ativa />);
    await screen.findByTestId("res-plano-total");
    fireEvent.click(screen.getByLabelText("Servir Feijão"));
    // arroz 8,8 + feijão 100 g × 50 × 1,10 = 5,5 → 14,3 kg
    expect(screen.getByTestId("res-plano-total")).toHaveTextContent(/com 2 pratos: 14,3 kg/);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(screen.getByTestId("res-plano-total")).toHaveTextContent(/com 3 pratos: 25,3 kg/);
    fireEvent.click(screen.getByRole("button", { name: "Nenhum" }));
    expect(screen.queryByTestId("res-plano-total")).not.toBeInTheDocument();
    expect(screen.getByTestId("res-plano-vazio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Só o último cardápio" }));
    expect(screen.getByTestId("res-plano-total")).toHaveTextContent(/com 1 prato/);
  });

  test("voltar para a aba com o mesmo filtro mantém o que foi digitado no planejamento", async () => {
    const { rerender } = render(<ResultadoBuffet ativa />);
    await screen.findByTestId("res-plano-total");
    fireEvent.change(screen.getByLabelText(/Pessoas esperadas/), { target: { value: "120" } });
    rerender(<SessionContext.Provider value={SESSAO}><HideValuesProvider><ResultadoBuffet ativa={false} /></HideValuesProvider></SessionContext.Provider>);
    rerender(<SessionContext.Provider value={SESSAO}><HideValuesProvider><ResultadoBuffet ativa /></HideValuesProvider></SessionContext.Provider>);
    await waitFor(() => expect(m(getBuffetAnalysis).mock.calls.length).toBe(2));
    expect(screen.getByLabelText(/Pessoas esperadas/)).toHaveValue("120");
  });

  test("mudar o período limpa o resultado e recomeça o planejamento", async () => {
    render(<ResultadoBuffet ativa />);
    await screen.findByTestId("res-plano-total");
    fireEvent.change(screen.getByLabelText(/Pessoas esperadas/), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 dias" }));
    await waitFor(() => expect(m(getBuffetAnalysis).mock.calls.length).toBe(2));
    await waitFor(() => expect(screen.getByLabelText(/Pessoas esperadas/)).toHaveValue("50"));
  });

  test("avisa quantos dias entram no custo e na margem por pessoa", async () => {
    m(getBuffetAnalysis).mockResolvedValue(analise({ summary: { ...resumo, daysWithPeople: 12, daysWithFullCost: 4 } }));
    render(<ResultadoBuffet ativa />);
    expect(await screen.findByText(/4 de 12 dias com pessoas no PDV/)).toBeInTheDocument();
  });

  test("folga inválida explica o erro certo (não pede pessoas)", async () => {
    render(<ResultadoBuffet ativa />);
    await screen.findByTestId("res-plano-total");
    fireEvent.change(screen.getByLabelText(/Folga de segurança/), { target: { value: "" } });
    expect(screen.getByText("Informe a folga de 0 a 100%.")).toBeInTheDocument();
  });
});

