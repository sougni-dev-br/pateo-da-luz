import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", () => ({
  cancelWasteEntry: vi.fn(),
  createWasteEntry: vi.fn(),
  getWasteAnalysis: vi.fn(),
  getWasteEntries: vi.fn(),
  getWastePhoto: vi.fn(),
  getWasteSettings: vi.fn(),
  saveDishProductConversion: vi.fn(),
  saveWasteSettings: vi.fn(),
  searchWasteDishes: vi.fn(),
  searchWasteProducts: vi.fn(),
  uploadWastePhoto: vi.fn(),
}));

import type { WasteAnalysis, WasteEntry } from "../../../api/client";
import { getWasteAnalysis, getWasteEntries, getWasteSettings } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { Desperdicio } from "../Desperdicio";

const sessao = (user: unknown) => ({ user, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true }) as unknown as SessionContextValue;
const ADMIN = sessao({ id: "u1", name: "Admin", role: "ADMIN" });
// Estoquista: lança e vê, mas sem "Custos do estoque".
const ESTOQUISTA = sessao({ id: "u2", name: "Estoquista", role: "ESTOQUISTA", modulePermissions: { "inventory-waste": { view: true, create: true } } });
// Só leitura (sem lançar nem custos).
const LEITOR = sessao({ id: "u3", name: "Leitor", role: "VISUALIZACAO", modulePermissions: { "inventory-waste": { view: true } } });

const render = (ui: ReactElement, rota = "/", contexto = ADMIN) =>
  renderRaw(<MemoryRouter initialEntries={[rota]}><SessionContext.Provider value={contexto}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>);

const grupo = (chave: string, nome: string, lancamentos: number, valor: number | null, anteriorValor: number | null = 0, anteriorLancamentos = 0) =>
  ({ chave, nome, lancamentos, valor, semCusto: 0, anteriorLancamentos, anteriorValor });

const dias = Array.from({ length: 14 }, (_, i) => ({ dia: `2026-10-${String(i + 1).padStart(2, "0")}`, lancamentos: i % 3 === 0 ? 2 : 0, valor: i % 3 === 0 ? 40 : 0 }));

const analise: WasteAnalysis = {
  periodo: { from: "2026-10-01", to: "2026-10-14", dias: 14 },
  total: { lancamentos: 10, valor: 450, semCusto: 0 },
  anterior: { from: "2026-09-17", to: "2026-09-30", lancamentos: 6, valor: 200 },
  faturamento: { liquido: 30000, diasComVenda: 12, pessoas: 900, anteriorLiquido: 28000, percentual: 1.5, percentualAnterior: 0.71, porPessoa: 0.5 },
  porDia: dias,
  porDiaDaSemana: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"].map((nome, i) => ({ diaDaSemana: i, nome, lancamentos: 1, valor: 20, ocorrencias: 2 })),
  porMotivo: [grupo("EXPIRED", "Vencido", 6, 300, 100, 3), grupo("SPOILED", "Estragado", 4, 150, 100, 3)],
  porSetor: [grupo("Câmara fria", "Câmara fria", 7, 350), grupo("Sem setor", "Sem setor", 3, 100)],
  porProduto: [{ ...grupo("p1", "Salmão", 6, 300, 100, 3), dias: 4, quantidade: 7.5, unidade: "KG", motivoPrincipal: "EXPIRED", motivoPrincipalRotulo: "Vencido", comprado: 50, taxaDePerda: 15 }, { ...grupo("p2", "Tomate", 4, 150), dias: 2, quantidade: 4, unidade: "KG", motivoPrincipal: "SPOILED", motivoPrincipalRotulo: "Estragado", comprado: null, taxaDePerda: null }],
  produtosTotal: 2,
  itensPara80: 2,
  reincidentes: [{ ...grupo("p1", "Salmão", 6, 300, 100, 3), dias: 4, quantidade: 7.5, unidade: "KG", motivoPrincipal: "EXPIRED", motivoPrincipalRotulo: "Vencido", comprado: 50, taxaDePerda: 15 }],
  porPessoa: [{ id: "u1", nome: "Ana", lancamentos: 7 }, { id: "u2", nome: "Beto", lancamentos: 3 }],
  qualidade: { semCusto: 0, motivoOutro: 0, retroativos: 0, semFotoNosMaiores: 4, diasSemRegistro: 3, diasComVenda: 12 },
};

const lancamento = (parcial: Partial<WasteEntry> & { id: string }): WasteEntry => ({
  kind: "INSUMO", productId: "p1", dishId: null, productName: "Salmão", productCode: null, quantity: 1, unit: "KG", enteredQuantity: null, enteredUnit: null,
  reason: "EXPIRED", reasonLabel: "Vencido", occurredOn: "2026-10-13", sectorName: "Câmara fria", notes: null, createdAt: "2026-10-13T12:00:00Z",
  cancelledAt: null, cancelReason: null, hasPhoto: false, hasCost: true, registeredById: "u1", totalCost: 50, unitCost: 50, costSource: "ULTIMA_COMPRA", ...parcial,
});

const itens = [
  lancamento({ id: "a" }),
  lancamento({ id: "b", productId: "p2", productName: "Tomate", reason: "SPOILED", reasonLabel: "Estragado", sectorName: null }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWasteAnalysis).mockResolvedValue(analise);
  vi.mocked(getWasteEntries).mockResolvedValue({ from: "2026-10-01", to: "2026-10-14", truncated: false, items: itens });
  vi.mocked(getWasteSettings).mockResolvedValue({ dailyAlertValue: null, activeRecipients: 1 });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:csv"), revokeObjectURL: vi.fn() }));
});

describe("Análise: abas e primeira tela", () => {
  test("quem vê custos abre na análise, e a aba Lançar está a um clique", async () => {
    render(<Desperdicio />);
    expect(await screen.findByRole("heading", { name: "Desperdício no período" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Análise" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("searchbox", { name: /buscar produto/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Lançar" }));
    expect(await screen.findByRole("searchbox", { name: /buscar produto/i })).toBeInTheDocument();
  });

  test("estoquista (lança, mas não vê custos) abre direto no lançamento", async () => {
    render(<Desperdicio />, "/", ESTOQUISTA);
    expect(await screen.findByRole("searchbox", { name: /buscar produto/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lançar" })).toHaveAttribute("aria-selected", "true");
  });

  test("quem só lê não tem aba nem formulário: vai direto à análise", async () => {
    render(<Desperdicio />, "/", LEITOR);
    expect(await screen.findByRole("heading", { name: "Desperdício no período" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Lançar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /registrar desperdício/i })).not.toBeInTheDocument();
  });

  test("'Registrar desperdício' na análise leva ao formulário", async () => {
    render(<Desperdicio />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar desperdício" }));
    expect(await screen.findByRole("searchbox", { name: /buscar produto/i })).toBeInTheDocument();
  });
});

describe("Análise: indicadores e leitura", () => {
  test("mostra valor, comparação com o período anterior, % do faturamento e valor por cliente", async () => {
    render(<Desperdicio />);
    const kpis = await screen.findByText("Valor desperdiçado");
    const painel = kpis.closest("dl") as HTMLElement;
    expect(within(painel).getByText(/450,00/)).toBeInTheDocument();
    expect(within(painel).getByText(/125%/)).toBeInTheDocument();
    expect(within(painel).getByText("1,50%")).toBeInTheDocument();
    expect(within(painel).getByText(/900 clientes/)).toBeInTheDocument();
    expect(within(painel).getByText(/R\$\s?0,50/)).toBeInTheDocument();
  });

  test("a leitura aponta a alta, o motivo dominante e o item reincidente com o primeiro passo", async () => {
    render(<Desperdicio />);
    const leitura = (await screen.findByRole("heading", { name: "O que fazer com estes números" })).closest("section") as HTMLElement;
    expect(within(leitura).getByText(/subiu 125%/)).toBeInTheDocument();
    expect(within(leitura).getByText(/Vencido responde por 67% do valor/)).toBeInTheDocument();
    expect(within(leitura).getByText(/Salmão foi perdido em 4 dias diferentes/)).toBeInTheDocument();
    expect(within(leitura).getAllByText("Primeiro passo:").length).toBeGreaterThanOrEqual(3);
  });

  test("'Ver só estes lançamentos' recorta a lista e mostra o recorte com opção de remover", async () => {
    render(<Desperdicio />);
    const leitura = (await screen.findByRole("heading", { name: "O que fazer com estes números" })).closest("section") as HTMLElement;
    fireEvent.click(within(leitura).getAllByRole("button", { name: "Ver só estes lançamentos" })[0]);

    const lista = (await screen.findByRole("heading", { name: "Lançamentos" })).closest("div.waste-lancamentos") as HTMLElement;
    expect(await within(lista).findByText("1 de 2 lançamentos.")).toBeInTheDocument();
    expect(within(lista).getByText("Motivo: Vencido")).toBeInTheDocument();
    expect(within(lista).queryByText("Tomate")).not.toBeInTheDocument();

    fireEvent.click(within(lista).getByRole("button", { name: "Remover recorte Motivo: Vencido" }));
    expect(await within(lista).findByText("Tomate")).toBeInTheDocument();
  });

  test("sem permissão de custo nenhum real aparece, nem indicadores de faturamento", async () => {
    vi.mocked(getWasteAnalysis).mockResolvedValue({
      ...analise,
      faturamento: null,
      total: { lancamentos: 10, valor: null, semCusto: 0 },
      anterior: { ...analise.anterior, valor: null },
      porMotivo: analise.porMotivo.map((g) => ({ ...g, valor: null, anteriorValor: null })),
      porSetor: analise.porSetor.map((g) => ({ ...g, valor: null, anteriorValor: null })),
      porProduto: analise.porProduto.map((g) => ({ ...g, valor: null, anteriorValor: null })),
      porDia: analise.porDia.map((d) => ({ ...d, valor: null })),
      porDiaDaSemana: analise.porDiaDaSemana.map((d) => ({ ...d, valor: null })),
      reincidentes: [],
      itensPara80: null,
      qualidade: { ...analise.qualidade, semFotoNosMaiores: 0, diasSemRegistro: null, diasComVenda: null },
    });
    vi.mocked(getWasteEntries).mockResolvedValue({ from: "2026-10-01", to: "2026-10-14", truncated: false, items: itens.map(({ totalCost: _c, unitCost: _u, costSource: _s, ...resto }) => resto) });
    render(<Desperdicio />, "/?aba=analise", LEITOR);

    await screen.findByText("Itens diferentes");
    expect(screen.queryByText("Valor desperdiçado")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/R\$/);
  });
});

describe("Análise: de onde vem a perda", () => {
  test("clicar numa linha do ranking filtra a lista; clicar de novo desfaz", async () => {
    render(<Desperdicio />);
    const quebra = (await screen.findByRole("heading", { name: "De onde vem a perda" })).closest("section") as HTMLElement;

    fireEvent.click(within(quebra).getByRole("button", { name: /Estragado/ }));
    expect(await screen.findByText("1 de 2 lançamentos.")).toBeInTheDocument();
    expect(within(quebra).getByRole("button", { name: /Estragado/ })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(quebra).getByRole("button", { name: /Estragado/ }));
    await waitFor(() => expect(screen.queryByText("1 de 2 lançamentos.")).not.toBeInTheDocument());
  });

  test("a aba Item mostra em quantos dias o item perde e o motivo principal", async () => {
    render(<Desperdicio />);
    const quebra = (await screen.findByRole("heading", { name: "De onde vem a perda" })).closest("section") as HTMLElement;
    fireEvent.click(within(quebra).getByRole("tab", { name: "Item" }));
    const linha = within(quebra).getByRole("button", { name: /Salmão/ });
    expect(within(linha).getByText("em 4 dias")).toBeInTheDocument();
    expect(within(linha).getByText("7,5 KG de 50 KG comprados (15%)")).toBeInTheDocument();
  });

  test("mais de quatro observações: as demais ficam a um clique", async () => {
    render(<Desperdicio />);
    const leitura = (await screen.findByRole("heading", { name: "O que fazer com estes números" })).closest("section") as HTMLElement;
    const mais = within(leitura).getByText(/^Mais \d+ observaç/);
    expect(mais.closest("details")).not.toHaveAttribute("open");
    expect(within(leitura).getAllByRole("listitem").length).toBeGreaterThan(4);
  });

  test("mostra o que mudou frente ao período anterior (▲ R$ 200,00 no Vencido)", async () => {
    render(<Desperdicio />);
    const quebra = (await screen.findByRole("heading", { name: "De onde vem a perda" })).closest("section") as HTMLElement;
    expect(within(quebra).getByRole("button", { name: /Vencido/ })).toHaveTextContent(/▲\s*R\$\s?200,00/);
  });
});

describe("Análise: período e exportação", () => {
  test("atalho de período recarrega com as datas dele", async () => {
    render(<Desperdicio />);
    await screen.findByRole("heading", { name: "Desperdício no período" });
    fireEvent.click(screen.getByRole("button", { name: "7 dias" }));
    await waitFor(() => {
      const ultima = vi.mocked(getWasteAnalysis).mock.calls.at(-1)?.[0];
      expect(ultima && new Date(`${ultima.to}T00:00:00Z`).getTime() - new Date(`${ultima.from}T00:00:00Z`).getTime()).toBe(6 * 86_400_000);
    });
    expect(screen.getByRole("button", { name: "7 dias" })).toHaveAttribute("aria-pressed", "true");
  });

  test("trocar o período limpa os recortes da lista", async () => {
    render(<Desperdicio />);
    const quebra = (await screen.findByRole("heading", { name: "De onde vem a perda" })).closest("section") as HTMLElement;
    fireEvent.click(within(quebra).getByRole("button", { name: /Estragado/ }));
    await screen.findByText("1 de 2 lançamentos.");
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    await waitFor(() => expect(screen.queryByText("1 de 2 lançamentos.")).not.toBeInTheDocument());
  });

  test("'Baixar planilha' gera o CSV do que está na tela", async () => {
    const clique = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<Desperdicio />);
    fireEvent.click(await screen.findByRole("button", { name: "Baixar planilha" }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    expect(clique).toHaveBeenCalled();
    clique.mockRestore();
  });

  test("busca na lista filtra por texto sem sair da tela", async () => {
    render(<Desperdicio />);
    fireEvent.change(await screen.findByLabelText("Buscar na lista"), { target: { value: "tomate" } });
    expect(await screen.findByText("1 de 2 lançamentos.")).toBeInTheDocument();
  });

  test("período sem lançamentos explica que perda não lançada deixa o número abaixo do real", async () => {
    vi.mocked(getWasteAnalysis).mockResolvedValue({ ...analise, total: { lancamentos: 0, valor: 0, semCusto: 0 } });
    vi.mocked(getWasteEntries).mockResolvedValue({ from: "2026-10-01", to: "2026-10-14", truncated: false, items: [] });
    render(<Desperdicio />);
    expect(await screen.findByText("Nenhum desperdício no período")).toBeInTheDocument();
    expect(screen.getByText(/os números ficam abaixo do real/)).toBeInTheDocument();
  });
});

describe("Análise: confiança do registro", () => {
  test("lista o que falta (dias sem registro, fotos) e quem registrou", async () => {
    render(<Desperdicio />);
    const cartao = (await screen.findByRole("heading", { name: "Confiança do registro" })).closest("section") as HTMLElement;
    expect(within(cartao).getByText(/3 de 12 dias com venda sem nenhum registro/)).toBeInTheDocument();
    expect(within(cartao).getByText(/4 dos 10 maiores sem foto/)).toBeInTheDocument();
    expect(within(cartao).getByText(/Ana \(7\), Beto \(3\)/)).toBeInTheDocument();
  });
});
