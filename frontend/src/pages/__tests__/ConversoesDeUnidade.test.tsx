import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getRotinaDeConversoes = vi.fn();
const cadastrarConversao = vi.fn();
const conferirConversaoDoProduto = vi.fn();
const getUnits = vi.fn();

vi.mock("../../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: Record<string, unknown>) { super(message); }
  },
  getRotinaDeConversoes: (...args: unknown[]) => getRotinaDeConversoes(...args),
  cadastrarConversao: (...args: unknown[]) => cadastrarConversao(...args),
  conferirConversaoDoProduto: (...args: unknown[]) => conferirConversaoDoProduto(...args),
  getUnits: (...args: unknown[]) => getUnits(...args)
}));
// O valor monetário depende do contexto de ocultar valores do app; aqui basta o número.
vi.mock("../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

import { ConversoesDeUnidade } from "../ConversoesDeUnidade";
import { LinhaDoCatalogo } from "../requisitions/LinhaDoCatalogo";

const produto = (id: string, nome: string, extra: Record<string, unknown> = {}) => ({
  productId: id, codigo: id.toUpperCase(), nome, unidadeDeContagem: "KG", saldo: 5, sectorId: "s1", sectorName: "CAMARA FRIA",
  status: "PENDENTE", conversoes: [], pendencias: [], usosEmRequisicoes: 0, conferidoPorNome: null, conferidoEm: null, ...extra
});

const rotina = (produtos: unknown[], resumo?: Record<string, number>) => ({
  produtos,
  resumo: resumo ?? { total: 4, pendentes: 2, parciais: 1, cadastrados: 1, naoPrecisa: 0 },
  locais: [{ id: "s1", nome: "CAMARA FRIA" }, { id: "s2", nome: "FREEZER" }]
});

const todos = [
  produto("a", "BACON PEÇA", { usosEmRequisicoes: 12, pendencias: [{ unidade: "UN", origem: "NOME_PECA", linhas: 0, valor: 0, proposta: null }] }),
  produto("b", "FARINHA TRIGO 5KG", { sectorId: "s2", sectorName: "FREEZER", pendencias: [{ unidade: "PCT", origem: "COMPRA", linhas: 4, valor: 200, proposta: { factor: 5, confianca: "alta", motivo: '"5KG" no nome: 1 PCT = 5 KG.' } }] }),
  produto("c", "QUEIJO", { status: "PARCIAL", conversoes: [{ fromUnit: "SC", toUnit: "KG", factor: 25 }], pendencias: [{ unidade: "PC", origem: "COMPRA", linhas: 6, valor: 900, proposta: null }] }),
  produto("d", "AZEITE", { status: "CADASTRADO", conversoes: [{ fromUnit: "LATA", toUnit: "L", factor: 5 }] })
];

const montar = (url = "/estoque/conversoes") => render(<MemoryRouter initialEntries={[url]}><ConversoesDeUnidade /></MemoryRouter>);

describe("ConversoesDeUnidade", () => {
  beforeEach(() => {
    getRotinaDeConversoes.mockResolvedValue(rotina(todos));
    getUnits.mockResolvedValue([{ id: "1", code: "UN", isActive: true }, { id: "2", code: "CX", isActive: true }, { id: "3", code: "KG", isActive: true }, { id: "4", code: "PCT", isActive: true }]);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  test("mostra o progresso e começa pela fila 'A fazer' (pendentes e os que falta uma unidade)", async () => {
    montar();
    expect(await screen.findByText("BACON PEÇA")).toBeTruthy();
    expect(screen.getByText("QUEIJO")).toBeTruthy();
    expect(screen.queryByText("AZEITE")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Produtos resolvidos" }).getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText(/de 4 produtos resolvidos/)).toBeTruthy();
  });

  test("o produto que a cozinha mais pede vem primeiro e a unidade da peça é explicada", async () => {
    montar();
    await screen.findByText("BACON PEÇA");
    expect(screen.getByText(/O nome diz peça/)).toBeTruthy();
    expect(screen.getByText(/pedido 12× em requisições/)).toBeTruthy();
    expect(screen.getByText("1 UN (unidade ou peça) =")).toBeTruthy();
  });

  test("a sugestão do sistema vem preenchida e explicada", async () => {
    montar();
    await screen.findByText("FARINHA TRIGO 5KG");
    expect((screen.getByLabelText("Quanto vale 1 PCT em KG") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText(/Sugestão do sistema \(alta confiança\)/)).toBeTruthy();
  });

  test("cadastrar 1 peça = 3,5 kg: salva, avisa e busca a lista de novo", async () => {
    cadastrarConversao.mockResolvedValue({ criada: true, comprasConvertidas: 0, comprasEmPeriodoFechado: 0, conversao: { fromUnit: "UN", toUnit: "KG", factor: 3.5 } });
    montar();
    fireEvent.change(await screen.findByLabelText("Quanto vale 1 UN em KG"), { target: { value: "3,5" } });
    getRotinaDeConversoes.mockResolvedValue(rotina(todos.slice(1), { total: 4, pendentes: 1, parciais: 1, cadastrados: 2, naoPrecisa: 0 }));
    fireEvent.click(within(screen.getByText("BACON PEÇA").closest("li") as HTMLElement).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(cadastrarConversao).toHaveBeenCalledWith({ productId: "a", fromUnit: "UN", factor: "3,5" }));
    expect(await screen.findByText(/1 UN = 3,5 KG cadastrada/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("BACON PEÇA")).toBeNull());
    expect(getRotinaDeConversoes).toHaveBeenCalledTimes(2);
  });

  test("erro do servidor aparece no cartão, com o valor digitado ainda lá", async () => {
    cadastrarConversao.mockRejectedValue(new Error("Já existe a conversão 1 UN = 4 KG neste produto."));
    montar();
    const campo = (await screen.findByLabelText("Quanto vale 1 UN em KG")) as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "3,5" } });
    fireEvent.click(within(screen.getByText("BACON PEÇA").closest("li") as HTMLElement).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Já existe a conversão/)).toBeTruthy();
    expect(campo.value).toBe("3,5");
  });

  test("'Não precisa de conversão' marca o produto como conferido e atualiza a fila", async () => {
    conferirConversaoDoProduto.mockResolvedValue({ productId: "a", naoPrecisa: true });
    montar();
    await screen.findByText("BACON PEÇA");
    getRotinaDeConversoes.mockResolvedValue(rotina(todos.slice(1)));
    fireEvent.click(within(screen.getByText("BACON PEÇA").closest("li") as HTMLElement).getByRole("button", { name: "Não precisa de conversão" }));
    await waitFor(() => expect(conferirConversaoDoProduto).toHaveBeenCalledWith("a", true));
    expect(await screen.findByText(/BACON PEÇA: conferido, não precisa de conversão/)).toBeTruthy();
  });

  test("na visão 'Não precisa' dá para desfazer", async () => {
    getRotinaDeConversoes.mockResolvedValue(rotina([produto("z", "SAL", { status: "NAO_PRECISA", conferidoPorNome: "Eli" })], { total: 1, pendentes: 0, parciais: 0, cadastrados: 0, naoPrecisa: 1 }));
    conferirConversaoDoProduto.mockResolvedValue({ productId: "z", naoPrecisa: false });
    montar();
    fireEvent.click(await screen.findByRole("button", { name: /Não precisa/ }));
    expect(await screen.findByText(/Conferido por Eli/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar para as pendências" }));
    await waitFor(() => expect(conferirConversaoDoProduto).toHaveBeenCalledWith("z", false));
  });

  test("filtra por local do estoque e por nome", async () => {
    montar();
    await screen.findByText("BACON PEÇA");
    fireEvent.click(screen.getByRole("button", { name: "FREEZER" }));
    expect(screen.queryByText("BACON PEÇA")).toBeNull();
    expect(screen.getByText("FARINHA TRIGO 5KG")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Todos os locais" }));
    fireEvent.change(screen.getByLabelText("Buscar produto"), { target: { value: "quei" } });
    expect(screen.getByText("QUEIJO")).toBeTruthy();
    expect(screen.queryByText("BACON PEÇA")).toBeNull();
  });

  test("a visão 'Cadastradas' mostra o que já converte, com as conversões", async () => {
    montar();
    await screen.findByText("BACON PEÇA");
    fireEvent.click(screen.getByRole("button", { name: /Cadastradas/ }));
    expect(await screen.findByText("AZEITE")).toBeTruthy();
    expect(screen.getByText("1 LATA = 5 L")).toBeTruthy();
  });

  test("vindo do '+ unidade' da requisição, o produto aparece em destaque mesmo se já estiver resolvido", async () => {
    montar("/estoque/conversoes?produto=d");
    const cartao = (await screen.findByText("AZEITE")).closest("li") as HTMLElement;
    expect(cartao.className).toContain("is-destacado");
  });

  test("tudo em dia: mensagem de fila vazia", async () => {
    getRotinaDeConversoes.mockResolvedValue(rotina([todos[3]], { total: 1, pendentes: 0, parciais: 0, cadastrados: 1, naoPrecisa: 0 }));
    montar();
    expect(await screen.findByText(/Nada a fazer/)).toBeTruthy();
  });

  test("falha ao carregar oferece tentar de novo", async () => {
    getRotinaDeConversoes.mockRejectedValueOnce(new Error("x"));
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("BACON PEÇA")).toBeTruthy();
  });
});

describe("'+ unidade' na linha da requisição", () => {
  afterEach(() => cleanup());
  const item = { id: "p1", name: "BACON PEÇA", code: "366", unit: "KG", conversions: [], embalagemInferida: null, sectorId: null, balance: 0.1 };

  test("leva para as conversões deste produto, sem mudar a linha", () => {
    const onPedirUnidade = vi.fn();
    render(<ul><LinhaDoCatalogo item={item} escolha={undefined} onMudar={vi.fn()} onTirar={vi.fn()} onProxima={vi.fn()} onPedirUnidade={onPedirUnidade} /></ul>);
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar outra unidade para BACON PEÇA" }));
    expect(onPedirUnidade).toHaveBeenCalledWith(item);
  });
});
