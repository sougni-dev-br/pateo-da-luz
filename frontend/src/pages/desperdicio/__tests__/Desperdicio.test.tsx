import { act, fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../api/client", () => ({
  cancelWasteEntry: vi.fn(),
  createWasteEntry: vi.fn(),
  getWasteEntries: vi.fn(),
  getWastePhoto: vi.fn(),
  getWasteSettings: vi.fn(),
  getWasteAnalysis: vi.fn(),
  saveDishProductConversion: vi.fn(),
  saveWasteSettings: vi.fn(),
  searchWasteDishes: vi.fn(),
  searchWasteProducts: vi.fn(),
  uploadWastePhoto: vi.fn(),
}));
vi.mock("../foto", async (original) => ({ ...(await original<typeof import("../foto")>()), reduzirFoto: vi.fn() }));

import type { WasteAnalysis, WasteEntry } from "../../../api/client";
import {
  cancelWasteEntry, createWasteEntry, getWasteAnalysis, getWasteEntries, getWastePhoto, getWasteSettings,
  saveDishProductConversion, saveWasteSettings, searchWasteDishes, searchWasteProducts, uploadWastePhoto,
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { reduzirFoto } from "../foto";
import { Desperdicio } from "../Desperdicio";

const SESSAO = {
  user: { id: "u1", name: "Admin", role: "ADMIN" },
  setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined,
  canAccessSection: () => true, hasPermission: () => true,
} as unknown as SessionContextValue;
// Por padrão abre na aba de lançamento (formulário e "lançado hoje"); a análise é pedida com `?aba=analise`.
const render = (ui: ReactElement, rota = "/?aba=lancar") => renderRaw(<MemoryRouter initialEntries={[rota]}><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>);
const ANALISE = "/?aba=analise";

const periodoVazio = { from: "2026-09-14", to: "2026-10-13", truncated: false, items: [] as WasteEntry[] };
const analiseVazia: WasteAnalysis = {
  periodo: { from: "2026-09-14", to: "2026-10-13", dias: 30 },
  total: { lancamentos: 0, valor: 0, semCusto: 0 },
  anterior: { from: "2026-08-15", to: "2026-09-13", lancamentos: 0, valor: 0 },
  faturamento: null,
  porDia: [], porDiaDaSemana: [], porMotivo: [], porSetor: [], porProduto: [], produtosTotal: 0, itensPara80: null, reincidentes: [], porPessoa: [],
  qualidade: { semCusto: 0, motivoOutro: 0, retroativos: 0, semFotoNosMaiores: 0, diasSemRegistro: null, diasComVenda: null },
};

const lancamento = (parcial: Partial<WasteEntry> = {}): WasteEntry => ({
  id: "w1", kind: "INSUMO", productId: "p1", dishId: null, productName: "Arroz", productCode: null, quantity: 2, unit: "KG",
  reason: "SPOILED", reasonLabel: "Estragado", occurredOn: "2026-10-13", sectorName: null, notes: null,
  createdAt: new Date().toISOString(), cancelledAt: null, cancelReason: null, hasPhoto: false, hasCost: true, registeredById: "u1",
  enteredQuantity: null, enteredUnit: null,
  totalCost: 15, unitCost: 7.5, costSource: "ULTIMA_COMPRA", ...parcial,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWasteEntries).mockResolvedValue(periodoVazio);
  vi.mocked(getWasteAnalysis).mockResolvedValue(analiseVazia);
  vi.mocked(createWasteEntry).mockResolvedValue({ id: "w1", hasCost: true } as never);
  vi.mocked(getWasteSettings).mockResolvedValue({ dailyAlertValue: null, activeRecipients: 1 });
  vi.mocked(uploadWastePhoto).mockResolvedValue({ ok: true });
  vi.mocked(reduzirFoto).mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:previa"), revokeObjectURL: vi.fn() }));
});

async function escolher(busca: RegExp, termo: string, resultado: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: busca }), { target: { value: termo } });
  fireEvent.click(await screen.findByText(resultado));
}

async function preencherInsumo() {
  vi.mocked(searchWasteProducts).mockResolvedValue([{ id: "p1", name: "Salmão fresco", code: "S1", unit: "KG", sectorName: null, conversions: [], embalagemInferida: null }]);
  await escolher(/buscar produto/i, "salm", "Salmão fresco");
  fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
}

const registrar = () => fireEvent.click(screen.getByRole("button", { name: /registrar desperdício/i }));
const arquivoDeFoto = () => new File(["x"], "foto.jpg", { type: "image/jpeg" });

describe("Desperdicio: insumo ou prato pronto", () => {
  test("insumo vai com productId e usa a busca de produtos", async () => {
    vi.mocked(searchWasteProducts).mockResolvedValue([{ id: "p1", name: "Salmão fresco", code: "S1", unit: "KG", sectorName: "Câmara fria", conversions: [], embalagemInferida: null }]);
    render(<Desperdicio />);

    await escolher(/buscar produto/i, "salm", "Salmão fresco");
    fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: "2,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
    registrar();

    await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
    expect(vi.mocked(createWasteEntry).mock.calls[0][0]).toMatchObject({ productId: "p1", quantity: "2,5", reason: "EXPIRED" });
    expect(vi.mocked(createWasteEntry).mock.calls[0][0]).not.toHaveProperty("dishId");
    expect(searchWasteDishes).not.toHaveBeenCalled();
  });

  test("prato pronto troca a busca e envia dishId", async () => {
    vi.mocked(searchWasteDishes).mockResolvedValue([{ id: "d1", name: "Lasanha", code: null, unit: "KG", sectorName: "Massas", conversions: [], embalagemInferida: null }]);
    render(<Desperdicio />);

    fireEvent.click(screen.getByRole("button", { name: "Prato pronto" }));
    await escolher(/buscar prato/i, "las", "Lasanha");
    // A unidade do prato (KG, o rendimento da ficha) vem escolhida, ao lado da quantidade.
    expect(screen.getByLabelText("Unidade")).toHaveValue("KG");
    fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Sobra de produção" }));
    registrar();

    await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
    expect(vi.mocked(createWasteEntry).mock.calls[0][0]).toMatchObject({ dishId: "d1", reason: "PRODUCTION_LEFTOVER" });
    expect(vi.mocked(createWasteEntry).mock.calls[0][0]).not.toHaveProperty("productId");
  });

  test("o modo e o motivo escolhidos ficam marcados para quem usa leitor de tela (aria-pressed)", () => {
    render(<Desperdicio />);
    expect(screen.getByRole("button", { name: "Insumo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Prato pronto" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Estragado" }));
    expect(screen.getByRole("button", { name: "Estragado" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Vencido" })).toHaveAttribute("aria-pressed", "false");
  });

  test("trocar de modo descarta a escolha do outro tipo, inclusive as sugestões", async () => {
    vi.mocked(searchWasteProducts).mockResolvedValue([{ id: "p1", name: "Salmão fresco", code: "S1", unit: "KG", sectorName: null, conversions: [], embalagemInferida: null }]);
    render(<Desperdicio />);

    await escolher(/buscar produto/i, "salm", "Salmão fresco");
    expect(screen.getByText("Salmão fresco")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prato pronto" }));
    expect(screen.queryByText("Salmão fresco")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /buscar prato/i })).toBeInTheDocument();
  });

  test("depois de salvar a busca volta vazia, sem o texto nem as sugestões anteriores", async () => {
    vi.mocked(searchWasteDishes).mockResolvedValue([{ id: "d1", name: "Lasanha", code: null, unit: "KG", sectorName: "Massas", conversions: [], embalagemInferida: null }]);
    render(<Desperdicio />);

    fireEvent.click(screen.getByRole("button", { name: "Prato pronto" }));
    await escolher(/buscar prato/i, "las", "Lasanha");
    fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sobra de produção" }));
    registrar();

    await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
    const busca = await screen.findByRole("searchbox", { name: /buscar prato/i });
    expect(busca).toHaveValue("");
    expect(screen.queryByText("Lasanha")).not.toBeInTheDocument();
  });
});

describe("Desperdicio: validação e foco", () => {
  test("envio incompleto não chama o servidor, resume o que falta uma vez e leva o foco ao primeiro erro", async () => {
    render(<Desperdicio />);
    registrar();

    expect(createWasteEntry).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falta preencher: produto, quantidade, motivo.");
    await waitFor(() => expect(screen.getByRole("searchbox", { name: /buscar produto/i })).toHaveFocus());
    expect(screen.getByRole("searchbox", { name: /buscar produto/i })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Escolha o produto.")).toBeInTheDocument();
  });

  test("escolhido o produto, o foco vai para a quantidade", async () => {
    vi.mocked(searchWasteProducts).mockResolvedValue([{ id: "p1", name: "Salmão fresco", code: "S1", unit: "KG", sectorName: null, conversions: [], embalagemInferida: null }]);
    render(<Desperdicio />);
    await escolher(/buscar produto/i, "salm", "Salmão fresco");
    await waitFor(() => expect(screen.getByLabelText(/Quantidade/)).toHaveFocus());
  });

  test("'Trocar' devolve o foco ao campo de busca", async () => {
    vi.mocked(searchWasteProducts).mockResolvedValue([{ id: "p1", name: "Salmão fresco", code: "S1", unit: "KG", sectorName: null, conversions: [], embalagemInferida: null }]);
    render(<Desperdicio />);
    await escolher(/buscar produto/i, "salm", "Salmão fresco");
    fireEvent.click(screen.getByRole("button", { name: "Trocar produto" }));
    await waitFor(() => expect(screen.getByRole("searchbox", { name: /buscar produto/i })).toHaveFocus());
  });

  test.each([
    ["1.500", /Use vírgula para decimais/],
    ["abc", /maior que zero/],
    ["", /Informe a quantidade/],
  ])("quantidade %j mostra o motivo exato", async (valor, mensagem) => {
    render(<Desperdicio />);
    fireEvent.change(screen.getByLabelText(/Quantidade/), { target: { value: valor } });
    registrar();
    expect(await screen.findByText(mensagem)).toBeInTheDocument();
    expect(createWasteEntry).not.toHaveBeenCalled();
  });

  test("data futura é recusada antes de enviar", async () => {
    render(<Desperdicio />);
    await preencherInsumo();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2999-01-01" } });
    registrar();
    expect(await screen.findByText("Informe a data (hoje ou antes).")).toBeInTheDocument();
    expect(createWasteEntry).not.toHaveBeenCalled();
  });

  test("'Outro' exige descrever o que aconteceu", async () => {
    render(<Desperdicio />);
    await preencherInsumo();
    fireEvent.click(screen.getByRole("button", { name: "Outro" }));
    registrar();
    expect(await screen.findByText("Descreva o que aconteceu.")).toBeInTheDocument();
  });
});

describe("Desperdicio: carga do período", () => {
  test("erro de carga não vira 'Nenhum desperdício': fica um aviso persistente com 'Tentar de novo'", async () => {
    vi.mocked(getWasteEntries).mockRejectedValueOnce(new Error("sem conexão"));
    render(<Desperdicio />, ANALISE);

    expect(await screen.findByText("Não foi possível carregar o desperdício deste período.")).toBeInTheDocument();
    expect(screen.getByText("sem conexão")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum desperdício no período")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Nenhum desperdício no período")).toBeInTheDocument();
    expect(screen.queryByText("Não foi possível carregar o desperdício deste período.")).not.toBeInTheDocument();
  });

  test("resposta antiga que chega depois não sobrescreve a mais nova (digitar a data dispara várias cargas)", async () => {
    let resolverAntiga: (valor: typeof periodoVazio) => void = () => undefined;
    vi.mocked(getWasteEntries)
      .mockImplementationOnce(() => new Promise((resolver) => { resolverAntiga = resolver; }))
      .mockResolvedValue({ ...periodoVazio, items: [lancamento({ productName: "Item do período novo" })] });
    render(<Desperdicio />, ANALISE);

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    expect(await screen.findByText("Item do período novo")).toBeInTheDocument();

    await act(async () => { resolverAntiga({ ...periodoVazio, items: [lancamento({ id: "velho", productName: "Item do período velho" })] }); });
    expect(screen.getByText("Item do período novo")).toBeInTheDocument();
    expect(screen.queryByText("Item do período velho")).not.toBeInTheDocument();
  });

  test("data apagada não deixa a tela presa em 'carregando' nem mostra dados de outro período", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ productName: "Item do período" })] });
    render(<Desperdicio />, ANALISE);
    await screen.findByText("Item do período");

    fireEvent.change(screen.getByLabelText("De"), { target: { value: "" } });
    expect(await screen.findByText("Informe as duas datas para ver o período.")).toBeInTheDocument();
    expect(screen.queryByText("Item do período")).not.toBeInTheDocument();
    expect(screen.queryByText("Nenhum desperdício no período")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled();
  });

  test("enquanto carrega a primeira vez, diz que está carregando", () => {
    vi.mocked(getWasteEntries).mockReturnValue(new Promise(() => undefined));
    render(<Desperdicio />, ANALISE);
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum desperdício no período")).not.toBeInTheDocument();
  });
});

describe("Desperdicio: foto opcional", () => {
  test("com foto: registra primeiro e envia a imagem reduzida ao lançamento criado", async () => {
    render(<Desperdicio />);
    await preencherInsumo();
    fireEvent.change(screen.getByTestId("foto-desperdicio"), { target: { files: [arquivoDeFoto()] } });
    expect(await screen.findByAltText("Prévia da foto do desperdício")).toBeInTheDocument();
    registrar();

    await waitFor(() => expect(uploadWastePhoto).toHaveBeenCalled());
    expect(reduzirFoto).toHaveBeenCalled();
    expect(vi.mocked(uploadWastePhoto).mock.calls[0][0]).toBe("w1");
    expect(await screen.findByText(/Desperdício de Salmão fresco registrado\./)).toBeInTheDocument();
  });

  test("sem foto não chama o envio", async () => {
    render(<Desperdicio />);
    await preencherInsumo();
    registrar();
    await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
    expect(uploadWastePhoto).not.toHaveBeenCalled();
  });

  test("se a foto falha, o desperdício continua registrado e a pessoa é avisada e orientada", async () => {
    vi.mocked(reduzirFoto).mockRejectedValue(new Error("A foto ficou grande demais."));
    render(<Desperdicio />);
    await preencherInsumo();
    fireEvent.change(screen.getByTestId("foto-desperdicio"), { target: { files: [arquivoDeFoto()] } });
    registrar();

    expect(await screen.findByText(/registrado, mas a foto não foi enviada: A foto ficou grande demais\. Use "Anexar foto" na lista\./)).toBeInTheDocument();
    expect(createWasteEntry).toHaveBeenCalledTimes(1);
    expect(uploadWastePhoto).not.toHaveBeenCalled();
  });

  test("lançamento sem custo avisa que não entra no valor nem no aviso do dia", async () => {
    vi.mocked(createWasteEntry).mockResolvedValue({ id: "w1", hasCost: false } as never);
    render(<Desperdicio />);
    await preencherInsumo();
    registrar();
    expect(await screen.findByText(/Sem custo conhecido: não entra no valor nem no aviso do dia\./)).toBeInTheDocument();
  });

  test("lançamento do usuário sem foto oferece 'Anexar foto' e envia ao lançamento certo", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w8" })] });
    render(<Desperdicio />);

    fireEvent.change(await screen.findByLabelText("Anexar foto a Arroz"), { target: { files: [arquivoDeFoto()] } });
    await waitFor(() => expect(uploadWastePhoto).toHaveBeenCalled());
    expect(vi.mocked(uploadWastePhoto).mock.calls[0][0]).toBe("w8");
    expect(await screen.findByText("Foto anexada.")).toBeInTheDocument();
  });

  test("lançamento antigo não repete 'Anexar foto' em toda linha", async () => {
    const velho = new Date(Date.now() - 10 * 86_400_000).toISOString();
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w3", createdAt: velho })] });
    render(<Desperdicio />);
    await screen.findByText("Arroz");
    expect(screen.queryByLabelText("Anexar foto a Arroz")).not.toBeInTheDocument();
  });

  test("lançamento sem custo diz isso junto do nome, sem quebrar a linha da quantidade", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ hasCost: false, totalCost: null, sectorName: "Estoque seco" })] });
    render(<Desperdicio />);
    expect(await screen.findByText("Estoque seco · sem custo conhecido")).toBeInTheDocument();
  });

  test("lançamento de outra pessoa não oferece 'Anexar foto' a quem não é da gestão", async () => {
    const SEM_GESTAO = { ...SESSAO, user: { id: "u1", name: "Estoquista", role: "ESTOQUISTA", modulePermissions: { "inventory-waste": { view: true, create: true } } } } as unknown as SessionContextValue;
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w9", registeredById: "outra-pessoa" })] });
    renderRaw(<MemoryRouter><SessionContext.Provider value={SEM_GESTAO}><HideValuesProvider><Desperdicio /></HideValuesProvider></SessionContext.Provider></MemoryRouter>);

    await screen.findByText("Arroz");
    expect(screen.queryByLabelText("Anexar foto a Arroz")).not.toBeInTheDocument();
  });

  test("lançamento cancelado não oferece anexar foto e mostra o motivo do cancelamento", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w9", cancelledAt: "2026-10-13T11:00:00Z", cancelReason: "engano" })] });
    render(<Desperdicio />);
    expect(await screen.findByText(/Motivo do cancelamento: engano/)).toBeInTheDocument();
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(screen.queryByText("Anexar foto")).not.toBeInTheDocument();
  });

  test("lançamento com foto oferece 'Ver foto' e busca a imagem pelo id", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w7", productName: "Salmão fresco", hasPhoto: true })] });
    vi.mocked(getWastePhoto).mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    render(<Desperdicio />);

    fireEvent.click(await screen.findByRole("button", { name: /ver foto/i }));
    expect(await screen.findByAltText(/Foto do desperdício: Salmão fresco/)).toBeInTheDocument();
    expect(getWastePhoto).toHaveBeenCalledWith("w7");
  });
});

describe("Desperdicio: cancelamento", () => {
  test("o erro aparece dentro do diálogo, onde a pessoa está olhando", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento()] });
    vi.mocked(cancelWasteEntry).mockRejectedValue(new Error("Este lançamento já foi cancelado."));
    render(<Desperdicio />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar lançamento de Arroz" }));
    fireEvent.change(await screen.findByLabelText(/Motivo do cancelamento/), { target: { value: "lancei duas vezes" } });
    const chamadasAntes = vi.mocked(getWasteEntries).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Cancelar lançamento" }));

    expect(await screen.findByText("Este lançamento já foi cancelado.")).toBeInTheDocument();
    // "Já cancelado" significa que a lista na tela está velha: recarrega.
    await waitFor(() => expect(vi.mocked(getWasteEntries).mock.calls.length).toBe(chamadasAntes + 2));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("cancelar com sucesso fecha o diálogo e recarrega", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento()] });
    vi.mocked(cancelWasteEntry).mockResolvedValue({ ok: true });
    render(<Desperdicio />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar lançamento de Arroz" }));
    fireEvent.change(await screen.findByLabelText(/Motivo do cancelamento/), { target: { value: "lancei duas vezes" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar lançamento" }));

    await waitFor(() => expect(cancelWasteEntry).toHaveBeenCalledWith("w1", "lancei duas vezes"));
    expect(await screen.findByText("Lançamento cancelado.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("Desperdicio: aviso por WhatsApp", () => {
  test("quem administra salva o limite", async () => {
    vi.mocked(getWasteSettings).mockResolvedValue({ dailyAlertValue: 500, activeRecipients: 2 });
    vi.mocked(saveWasteSettings).mockResolvedValue({ dailyAlertValue: 800 });
    render(<Desperdicio />, ANALISE);

    fireEvent.click(await screen.findByText(/Aviso por WhatsApp/));
    const campo = await screen.findByLabelText(/Avisar quando o desperdício do dia chegar a/);
    // O valor volta formatado em centavos ("500,00"), como será gravado e lido.
    expect(campo).toHaveValue("500,00");
    fireEvent.change(campo, { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar limite/i }));

    await waitFor(() => expect(saveWasteSettings).toHaveBeenCalledWith("800"));
    // O resultado aparece no próprio cartão (status), não no aviso global que rola a página para o topo.
    const resultado = await screen.findByText(/Limite do aviso salvo: R\$\s?800,00 por dia\./);
    expect(resultado).toHaveAttribute("role", "status");
    expect(resultado.closest("details")).not.toBeNull();
    expect(campo).toHaveValue("800,00");
  });

  test("erro ao salvar o limite aparece no cartão, como alerta", async () => {
    vi.mocked(getWasteSettings).mockResolvedValue({ dailyAlertValue: 500, activeRecipients: 2 });
    vi.mocked(saveWasteSettings).mockRejectedValue(new Error("Informe um limite maior que zero."));
    render(<Desperdicio />, ANALISE);
    fireEvent.click(await screen.findByText(/Aviso por WhatsApp/));
    fireEvent.click(await screen.findByRole("button", { name: /salvar limite/i }));
    const erro = await screen.findByText("Informe um limite maior que zero.");
    expect(erro).toHaveAttribute("role", "alert");
    expect(erro.closest("details")).not.toBeNull();
  });

  test("'1.500' é recusado antes de gravar R$ 1,50 sem ninguém perceber", async () => {
    vi.mocked(getWasteSettings).mockResolvedValue({ dailyAlertValue: 500, activeRecipients: 2 });
    render(<Desperdicio />, ANALISE);

    fireEvent.click(await screen.findByText(/Aviso por WhatsApp/));
    fireEvent.change(await screen.findByLabelText(/Avisar quando o desperdício do dia chegar a/), { target: { value: "1.500" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar limite/i }));

    expect(await screen.findByText(/Use vírgula para os centavos/)).toBeInTheDocument();
    expect(saveWasteSettings).not.toHaveBeenCalled();
  });

  test("limite ligado sem destinatário ativo avisa que ninguém vai receber", async () => {
    vi.mocked(getWasteSettings).mockResolvedValue({ dailyAlertValue: 500, activeRecipients: 0 });
    render(<Desperdicio />, ANALISE);
    fireEvent.click(await screen.findByText(/Aviso por WhatsApp/));
    expect(await screen.findByText(/Nenhum destinatário ativo/)).toBeInTheDocument();
  });

  test("se a configuração não carrega, o administrador vê o erro e pode tentar de novo (não some em silêncio)", async () => {
    vi.mocked(getWasteSettings).mockRejectedValueOnce(new Error("fora do ar")).mockResolvedValue({ dailyAlertValue: null, activeRecipients: 1 });
    render(<Desperdicio />, ANALISE);

    expect(await screen.findByText("Não foi possível carregar a configuração do aviso por WhatsApp.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Tentar de novo" })[0]);
    expect(await screen.findByText(/Aviso por WhatsApp · desligado/)).toBeInTheDocument();
  });
});

describe("Desperdicio: unidade da quantidade (g, ml, kg...) como na ficha técnica", () => {
  // ARROZ BRANCO T1 CAMIL PACOTE 5KG, estocado em UN; o peso 5 KG é lido do nome.
  const arroz = {
    id: "p9", name: "ARROZ BRANCO T1 CAMIL PACOTE 5KG", code: "364", unit: "UN", sectorName: "ESTOQUE",
    conversions: [{ fromUnit: "KG", toUnit: "UN", factor: 0.2, inferida: true }, { fromUnit: "G", toUnit: "UN", factor: 0.0002, inferida: true }],
    embalagemInferida: "1 UN = 5 KG (lido do nome do produto)",
  };

  async function escolherArroz() {
    vi.mocked(searchWasteProducts).mockResolvedValue([arroz]);
    render(<Desperdicio />);
    await escolher(/buscar produto/i, "arroz", "ARROZ BRANCO T1 CAMIL PACOTE 5KG");
  }

  test("a unidade do estoque vem escolhida e as que convertem aparecem na lista", async () => {
    await escolherArroz();
    const unidade = screen.getByLabelText("Unidade");
    expect(unidade).toHaveValue("UN");
    expect([...(unidade as HTMLSelectElement).options].map((o) => o.value)).toEqual(["UN", "KG", "G", "ML", "L"]);
    expect([...(unidade as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["UN", "KG", "G", "ML (informar)", "L (informar)"]);
    expect(unidade).toBeEnabled();
  });

  test("500 g mostra a conta na hora e envia 500 G (o servidor converte)", async () => {
    await escolherArroz();
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "500" } });

    expect(await screen.findByText(/500 G = 0,1 UN · 1 UN = 5 KG \(lido do nome do produto\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
    registrar();

    await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
    expect(vi.mocked(createWasteEntry).mock.calls[0][0]).toMatchObject({ productId: "p9", quantity: "500", unit: "G", reason: "EXPIRED" });
  });

  test("na unidade do estoque explica de onde vem o peso, sem conta", async () => {
    await escolherArroz();
    expect(screen.getByText("1 UN = 5 KG (lido do nome do produto)")).toBeInTheDocument();
  });

  describe("item sem peso nem volume: a pessoa informa quanto vale 1 unidade, na hora", () => {
    const guardanapo = { id: "p2", name: "Guardanapo", code: "G1", unit: "UN", sectorName: null, conversions: [], embalagemInferida: null };

    async function escolherGuardanapo(contexto = SESSAO) {
      vi.mocked(searchWasteProducts).mockResolvedValue([guardanapo]);
      renderRaw(<MemoryRouter initialEntries={["/?aba=lancar"]}><SessionContext.Provider value={contexto}><HideValuesProvider><Desperdicio /></HideValuesProvider></SessionContext.Provider></MemoryRouter>);
      await escolher(/buscar produto/i, "guar", "Guardanapo");
    }

    test("a unidade fica liberada e g, kg, ml e l aparecem marcadas (informar)", async () => {
      await escolherGuardanapo();
      const unidade = screen.getByLabelText("Unidade");
      expect(unidade).toBeEnabled();
      expect(unidade).toHaveValue("UN");
      expect([...(unidade as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["UN", "G (informar)", "KG (informar)", "ML (informar)", "L (informar)"]);
      expect(screen.queryByLabelText(/Quanto pesa ou mede 1 UN/)).not.toBeInTheDocument();
    });

    test("escolher g abre o campo do peso, mostra a conta e envia perUnit", async () => {
      await escolherGuardanapo();
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
      expect(await screen.findByLabelText(/Quanto pesa ou mede 1 UN/)).toBeInTheDocument();
      expect(screen.getByLabelText("Medida")).toHaveValue("G");

      fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "300" } });
      fireEvent.change(screen.getByLabelText(/Quanto pesa ou mede 1 UN/), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("Medida"), { target: { value: "KG" } });
      expect(await screen.findByText("300 G = 0,15 UN")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
      registrar();
      await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
      expect(vi.mocked(createWasteEntry).mock.calls[0][0]).toMatchObject({ productId: "p2", quantity: "300", unit: "G", perUnit: { quantity: "2", unit: "KG" } });
    });

    test("sem informar o peso o envio é recusado, com o foco no campo", async () => {
      await escolherGuardanapo();
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "ML" } });
      fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
      expect(screen.getByLabelText("Medida")).toHaveValue("ML");
      registrar();

      expect(await screen.findByText("Informe quanto pesa ou mede 1 UN.")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText(/Quanto pesa ou mede 1 UN/)).toHaveFocus());
      expect(createWasteEntry).not.toHaveBeenCalled();
    });

    test("voltar para a unidade do estoque some com o campo e não manda perUnit", async () => {
      await escolherGuardanapo();
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
      await screen.findByLabelText(/Quanto pesa ou mede 1 UN/);
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "UN" } });
      expect(screen.queryByLabelText(/Quanto pesa ou mede 1 UN/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "3" } });
      fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
      registrar();
      await waitFor(() => expect(createWasteEntry).toHaveBeenCalled());
      expect(vi.mocked(createWasteEntry).mock.calls[0][0]).not.toHaveProperty("perUnit");
    });

    test("a gestão grava a conversão no produto e a tela avisa", async () => {
      vi.mocked(saveDishProductConversion).mockResolvedValue({ conversions: [], embalagemInferida: null });
      await escolherGuardanapo();
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
      fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "300" } });
      fireEvent.change(await screen.findByLabelText(/Quanto pesa ou mede 1 UN/), { target: { value: "500" } });
      fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
      registrar();

      await waitFor(() => expect(saveDishProductConversion).toHaveBeenCalledWith("p2", { unit: "G", amount: 500 }));
      expect(await screen.findByText(/Conversão salva no produto/)).toBeInTheDocument();
    });

    test("quem não é da gestão não grava no produto: a tela diz que valeu só para o lançamento", async () => {
      const ESTOQUISTA = { ...SESSAO, user: { id: "u2", name: "Estoquista", role: "ESTOQUISTA", modulePermissions: { "inventory-waste": { view: true, create: true } } } } as unknown as SessionContextValue;
      await escolherGuardanapo(ESTOQUISTA);
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
      fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "300" } });
      fireEvent.change(await screen.findByLabelText(/Quanto pesa ou mede 1 UN/), { target: { value: "500" } });
      fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
      registrar();

      expect(await screen.findByText(/valeu só para este lançamento/)).toBeInTheDocument();
      expect(saveDishProductConversion).not.toHaveBeenCalled();
    });

    test("se gravar no produto falha, o desperdício continua registrado e a pessoa é avisada", async () => {
      vi.mocked(saveDishProductConversion).mockRejectedValue(new Error("fora do ar"));
      await escolherGuardanapo();
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
      fireEvent.change(screen.getByLabelText("Quantidade"), { target: { value: "300" } });
      fireEvent.change(await screen.findByLabelText(/Quanto pesa ou mede 1 UN/), { target: { value: "500" } });
      fireEvent.click(screen.getByRole("button", { name: "Vencido" }));
      registrar();

      expect(await screen.findByText(/Desperdício de Guardanapo registrado\./)).toBeInTheDocument();
      expect(screen.getByText(/valeu só para este lançamento/)).toBeInTheDocument();
    });

    test("prato em porção também aceita informar: o campo fala em 1 porção", async () => {
      vi.mocked(searchWasteDishes).mockResolvedValue([{ id: "d1", name: "Lasanha", code: null, unit: "UN", sectorName: "Massas", conversions: [], embalagemInferida: null }]);
      render(<Desperdicio />);
      fireEvent.click(screen.getByRole("button", { name: "Prato pronto" }));
      await escolher(/buscar prato/i, "las", "Lasanha");
      fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
      expect(await screen.findByLabelText(/Quanto pesa ou mede 1 porção/)).toBeInTheDocument();
    });
  });

  test("trocar de produto volta para a unidade do estoque do novo (não herda o G do anterior)", async () => {
    await escolherArroz();
    fireEvent.change(screen.getByLabelText("Unidade"), { target: { value: "G" } });
    fireEvent.click(screen.getByRole("button", { name: "Trocar produto" }));

    vi.mocked(searchWasteProducts).mockResolvedValue([{ id: "p1", name: "Salmão fresco", code: "S1", unit: "KG", sectorName: null, conversions: [], embalagemInferida: null }]);
    await escolher(/buscar produto/i, "salm", "Salmão fresco");
    expect(screen.getByLabelText("Unidade")).toHaveValue("KG");
    expect([...(screen.getByLabelText("Unidade") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["KG", "G"]);
  });

  test("a lista mostra o que foi digitado e o equivalente no estoque", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w5", productName: "ARROZ BRANCO T1 CAMIL PACOTE 5KG", quantity: 0.1, unit: "UN", enteredQuantity: 500, enteredUnit: "G" })] });
    render(<Desperdicio />);
    expect(await screen.findByText(/500 G/)).toBeInTheDocument();
    expect(screen.getByText("= 0,1 UN")).toBeInTheDocument();
  });

  test("quantidade muito pequena aparece com todas as casas, não como zero", async () => {
    vi.mocked(getWasteEntries).mockResolvedValue({ ...periodoVazio, items: [lancamento({ id: "w6", productName: "Sal grosso 25 kg", quantity: 0.00004, unit: "UN", enteredQuantity: 1, enteredUnit: "G" })] });
    render(<Desperdicio />);
    expect(await screen.findByText("= 0,00004 UN")).toBeInTheDocument();
  });
});
