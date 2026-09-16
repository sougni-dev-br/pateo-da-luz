import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Company, DocIntakeTitulo, PaymentMethod, Product, Supplier } from "../../api/client";
import { SessionContext, type SessionContextValue } from "../../context/SessionContext";
import { HideValuesProvider } from "../../design-system";
import { DocIntakeTituloCard } from "../DocIntakeTitulo";

// Nada de rede: o objetivo e provar o que a tela ENVIARIA, sem gravar nada.
const createPurchase = vi.fn();
const getProducts = vi.fn();
vi.mock("../../api/client", () => ({
  createPurchase: (...args: unknown[]) => createPurchase(...args),
  getProducts: (...args: unknown[]) => getProducts(...args),
}));

const SESSAO = {
  user: null,
  setUser: () => undefined,
  hideSensitiveValues: false,
  toggleSensitiveValues: () => undefined,
  canAccessSection: () => true,
  hasPermission: () => true,
} as unknown as SessionContextValue;

const FORNECEDORES = [{ id: "sup-1", name: "CONTROLID INDUSTRIA" }] as unknown as Supplier[];
const EMPRESAS = [{ id: "emp-1", tradeName: "Pateo da Luz Frei" }] as unknown as Company[];
const FORMAS = [{ id: "pm-1", name: "BOLETO" }, { id: "pm-pix", name: "PIX" }] as unknown as PaymentMethod[];

// Produto real de despesa, com a categoria que o ERP usa no DRE.
const PRODUTO_TI = {
  id: "prod-1",
  name: "Despesas com Serviços de TI / Hospedagem de Site",
  externalCode: "TI-001",
  unit: "UN",
  unitMeasureId: "um-1",
  category: { id: "cat-1", name: "Despesas Administrativas" },
  subcategory: { id: "sub-1", name: "Tecnologia" },
} as unknown as Product;

/** Titulo consolidado da nota + boleto reais da CONTROLID (R$ 209,00, venc. 15/09/2026). */
function titulo(over: Partial<DocIntakeTitulo> = {}): DocIntakeTitulo {
  return {
    chave: "08238299000129|209.00|2026-09-15",
    documentos: ["1454727.pdf", "1454727_PATEO_6149419_1_icjb7713.pdf"],
    tipoPrincipal: "NFSE",
    fornecedor: { cadastrado: true, id: "sup-1", nome: "CONTROLID INDUSTRIA" },
    fornecedorNome: "CONTROLID INDUSTRIA",
    empresa: { id: "emp-1", nome: "Pateo da Luz Frei" },
    numeroDocumento: "01454727",
    dataEmissao: "2026-08-17T00:00:00.000Z",
    dataVencimento: "2026-09-15T00:00:00.000Z",
    valorTotal: 209,
    parcelas: [{ numero: 1, dataVencimento: "2026-09-15T00:00:00.000Z", valor: 209, origem: "1454727_PATEO_6149419_1_icjb7713.pdf", linhaDigitavel: null, rotuloLido: null }],
    sugestoesItens: [],
    rubricas: [{ descricao: "SUPORTE TECNICO DE INFORMATICA", valor: 209, valorRaw: "209,00" }],
    linhaDigitavel: "34191.09065 14941.918956",
    duplicatas: [],
    lidoPorImagem: false,
    avisos: [],
    podeConfirmar: true,
    ...over,
  };
}

function montar(over: Partial<DocIntakeTitulo> = {}) {
  const onLancado = vi.fn();
  const onErro = vi.fn();
  render(
    <SessionContext.Provider value={SESSAO}>
      <HideValuesProvider>
        <DocIntakeTituloCard
          titulo={titulo(over)}
          arquivos={[]}
          fornecedores={FORNECEDORES}
          empresas={EMPRESAS}
          formasPagamento={FORMAS}
          onLancado={onLancado}
          onErro={onErro}
        />
      </HideValuesProvider>
    </SessionContext.Provider>,
  );
  return { onLancado, onErro };
}

const botaoLancar = () => screen.getByRole("button", { name: /Lançar em Contas a Pagar/i });

/** Busca e escolhe o produto, como a pessoa faria. */
async function escolherProduto(nome = PRODUTO_TI.name) {
  fireEvent.change(screen.getByLabelText(/Buscar produto/i), { target: { value: "suporte" } });
  const opcao = await screen.findByRole("button", { name: new RegExp(nome.slice(0, 20), "i") }, { timeout: 3000 });
  fireEvent.click(opcao);
}

beforeEach(() => {
  createPurchase.mockReset();
  createPurchase.mockResolvedValue({ id: "compra-1", purchaseNumber: "C-001" });
  getProducts.mockReset();
  getProducts.mockResolvedValue({ items: [PRODUTO_TI], total: 1, page: 1, pageSize: 12, totalPages: 1 });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Conferência — o que a leitura preencheu", () => {
  test("mostra que dois arquivos viraram um título só", () => {
    montar();
    expect(screen.getByText(/2 arquivos = 1 título/i)).toBeInTheDocument();
  });

  test("traz os campos do título já preenchidos", () => {
    montar();
    expect(screen.getByLabelText(/Número da nota/i)).toHaveValue("01454727");
    expect(screen.getByLabelText(/Emissão/i)).toHaveValue("2026-08-17");
    expect(screen.getByLabelText(/Vencimento da parcela 1/i)).toHaveValue("2026-09-15");
    expect(screen.getByLabelText(/Fornecedor/i)).toHaveValue("sup-1");
    expect(screen.getByLabelText(/Empresa/i)).toHaveValue("emp-1");
  });

  test("cria uma linha de item por rubrica lida, já com o valor", () => {
    montar();
    expect(screen.getByText(/lido: SUPORTE TECNICO DE INFORMATICA/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Preço unitário da linha 1/i)).toHaveValue("209");
  });

  test("avisa quando o documento foi lido da imagem", () => {
    montar({ lidoPorImagem: true });
    expect(screen.getByText(/lido da imagem/i)).toBeInTheDocument();
  });
});

describe("Conferência — a categoria vem do produto, nunca é digitada", () => {
  test("não existe campo de categoria para preencher", () => {
    montar();
    expect(screen.queryByLabelText(/Categoria da despesa/i)).not.toBeInTheDocument();
  });

  test("ao escolher o produto, a categoria dele aparece sozinha", async () => {
    montar();
    await escolherProduto();
    expect(await screen.findByText(/Despesas Administrativas/i)).toBeInTheDocument();
    expect(screen.getByText(/Tecnologia/i)).toBeInTheDocument();
  });
});

describe("Conferência — travas antes de gravar", () => {
  test("não deixa lançar enquanto falta o produto da linha", () => {
    montar();
    expect(botaoLancar()).toBeDisabled();
    expect(screen.getByText(/Falta preencher:.*produto de cada linha/i)).toBeInTheDocument();
  });

  test("não deixa lançar se o total dos itens não bate com o do documento", async () => {
    montar();
    await escolherProduto();
    fireEvent.change(screen.getByLabelText(/Forma de pagamento/i), { target: { value: "pm-1" } });
    // Mexe no unitário: a nota diz 209,00 e o item passa a somar 150,00.
    fireEvent.change(screen.getByLabelText(/Preço unitário da linha 1/i), { target: { value: "150" } });

    expect(screen.getByText(/diferença de/i)).toBeInTheDocument();
    expect(botaoLancar()).toBeDisabled();
  });

  test("um BLOQUEIO trava o lançamento", async () => {
    montar({
      avisos: [{ nivel: "BLOQUEIO", codigo: "SOMA_NAO_CONFERE", mensagem: "Soma das rubricas difere do total." }],
      podeConfirmar: false,
    });
    await escolherProduto();
    fireEvent.change(screen.getByLabelText(/Forma de pagamento/i), { target: { value: "pm-1" } });

    expect(botaoLancar()).toBeDisabled();
    expect(screen.getByText(/Corrija o bloqueio acima/i)).toBeInTheDocument();
  });
});

describe("Conferência — sugestão de produto", () => {
  const SUGERIDO = {
    id: "prod-1",
    nome: PRODUTO_TI.name,
    unidade: "UN",
    codigoExterno: "TI-001",
    categoria: "Despesas Administrativas",
    subcategoria: "Tecnologia",
  };

  test("confiança ALTA já vem preenchida e o botão libera sem busca", () => {
    // É o que torna viável uma nota com muitos itens: o que o sistema tem prova
    // de saber já vem pronto.
    montar({
      sugestoesItens: [{
        descricaoLida: "SUPORTE TECNICO DE INFORMATICA",
        sugestao: SUGERIDO,
        confianca: "ALTA",
        motivo: "já lançado antes com este fornecedor, com a mesma descrição",
        alternativas: [],
      }],
    });

    expect(screen.getByText(PRODUTO_TI.name)).toBeInTheDocument();
    expect(screen.queryByText(/Falta preencher:.*produto de cada linha/i)).not.toBeInTheDocument();
  });

  test("confiança BAIXA NÃO vem preenchida — palpite não entra sozinho", () => {
    // A trava que impede o erro silencioso: semelhança de nome é palpite, e
    // aceitar palpite sem olhar contamina o CMV.
    montar({
      sugestoesItens: [{
        descricaoLida: "SUPORTE TECNICO DE INFORMATICA",
        sugestao: SUGERIDO,
        confianca: "BAIXA",
        motivo: "nome parecido (61%)",
        alternativas: [],
      }],
    });

    expect(botaoLancar()).toBeDisabled();
    expect(screen.getByText(/Falta preencher:.*produto de cada linha/i)).toBeInTheDocument();
  });

  test("confiança MEDIA também não entra sozinha", () => {
    montar({
      sugestoesItens: [{
        descricaoLida: "SUPORTE TECNICO DE INFORMATICA",
        sugestao: SUGERIDO,
        confianca: "MEDIA",
        motivo: "nome parecido (88%)",
        alternativas: [],
      }],
    });
    expect(screen.getByText(/Falta preencher:.*produto de cada linha/i)).toBeInTheDocument();
  });
});

describe("Conferência — título parcelado", () => {
  /** Nota de R$ 3.000 paga em 3 boletos de R$ 1.000. */
  const PARCELADO: Partial<DocIntakeTitulo> = {
    valorTotal: 3000,
    sugestoesItens: [],
    rubricas: [{ descricao: "SERVICO", valor: 3000, valorRaw: "3.000,00" }],
    parcelas: [
      { numero: 1, dataVencimento: "2026-10-15T00:00:00.000Z", valor: 1000, origem: "b1.pdf", linhaDigitavel: null, rotuloLido: "1/3" },
      { numero: 2, dataVencimento: "2026-11-15T00:00:00.000Z", valor: 1000, origem: "b2.pdf", linhaDigitavel: null, rotuloLido: "2/3" },
      { numero: 3, dataVencimento: "2026-12-15T00:00:00.000Z", valor: 1000, origem: "b3.pdf", linhaDigitavel: null, rotuloLido: "3/3" },
    ],
  };

  test("mostra uma linha por boleto, com o arquivo de origem", () => {
    montar(PARCELADO);
    expect(screen.getByText(/3 parcelas/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Vencimento da parcela 3/i)).toHaveValue("2026-12-15");
    expect(screen.getByText("b2.pdf")).toBeInTheDocument();
  });

  test("envia as três parcelas ao lançar, não uma só", async () => {
    // A falha que este teste existe para impedir: gravar uma parcela de R$ 3.000
    // quando a compra tem três boletos de R$ 1.000.
    montar(PARCELADO);
    await escolherProduto();
    fireEvent.change(screen.getByLabelText(/Forma de pagamento/i), { target: { value: "pm-1" } });
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));

    expect(createPurchase.mock.calls[0][0].installments).toEqual([
      { installment: 1, dueDate: "2026-10-15", amount: 1000, paymentMethodId: "pm-1" },
      { installment: 2, dueDate: "2026-11-15", amount: 1000, paymentMethodId: "pm-1" },
      { installment: 3, dueDate: "2026-12-15", amount: 1000, paymentMethodId: "pm-1" },
    ]);
  });

  test("trava o lançamento se a soma das parcelas não fecha com a compra", async () => {
    montar(PARCELADO);
    await escolherProduto();
    fireEvent.change(screen.getByLabelText(/Forma de pagamento/i), { target: { value: "pm-1" } });
    fireEvent.change(screen.getByLabelText(/Valor da parcela 2/i), { target: { value: "500" } });

    expect(screen.getByText(/faltam/i)).toBeInTheDocument();
    expect(botaoLancar()).toBeDisabled();
  });

  test("mudar a quantidade refaz a grade, como no lançamento normal", () => {
    // Na tela de Compras é assim que se ajusta: a quantidade manda, e o valor
    // é redividido. Não há lixeira por parcela.
    montar(PARCELADO);
    fireEvent.change(screen.getByLabelText(/Quantidade de parcelas/i), { target: { value: "2" } });

    expect(screen.getByLabelText(/Valor da parcela 1/i)).toHaveValue("1500");
    expect(screen.getByLabelText(/Valor da parcela 2/i)).toHaveValue("1500");
    expect(screen.queryByLabelText(/Valor da parcela 3/i)).not.toBeInTheDocument();
  });

  test("os vencimentos são espaçados a partir do primeiro", () => {
    montar(PARCELADO);
    fireEvent.change(screen.getByLabelText(/Quantidade de parcelas/i), { target: { value: "2" } });

    expect(screen.getByLabelText(/Vencimento da parcela 1/i)).toHaveValue("2026-10-15");
    expect(screen.getByLabelText(/Vencimento da parcela 2/i)).toHaveValue("2026-11-14");
  });

  test("forma que não parcela volta para parcela única", () => {
    // PIX com 3 parcelas seria recusado pelo backend: a tela corrige antes.
    montar(PARCELADO);
    fireEvent.change(screen.getByLabelText(/Forma de pagamento/i), { target: { value: "pm-pix" } });

    expect(screen.queryByLabelText(/Valor da parcela 2/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Quantidade de parcelas/i)).toBeDisabled();
  });
});

describe("Conferência — o que seria gravado", () => {
  async function preencherTudo() {
    montar();
    await escolherProduto();
    fireEvent.change(screen.getByLabelText(/Forma de pagamento/i), { target: { value: "pm-1" } });
  }

  test("envia o payload no mesmo formato do lançamento de compra", async () => {
    await preencherTudo();
    expect(botaoLancar()).toBeEnabled();
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));

    const payload = createPurchase.mock.calls[0][0];
    expect(payload).toMatchObject({
      supplierId: "sup-1",
      companyId: "emp-1",
      invoiceNumber: "01454727",
      purchaseDate: "2026-08-17",
      totalAmount: 209,
      paymentMethodId: "pm-1",
    });
    expect(payload.installments).toEqual([
      { installment: 1, dueDate: "2026-09-15", amount: 209, paymentMethodId: "pm-1" },
    ]);
  });

  test("o item carrega a categoria e a unidade DO PRODUTO, não digitadas", async () => {
    await preencherTudo();
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));

    expect(createPurchase.mock.calls[0][0].items[0]).toMatchObject({
      productId: "prod-1",
      rawProductCode: "TI-001",
      rawProductName: PRODUTO_TI.name,
      unit: "UN",
      unitMeasureId: "um-1",
      quantity: 1,
      unitPrice: 209,
      totalPrice: 209,
      rawCategory: "Despesas Administrativas",
      rawSubcategory: "Tecnologia",
    });
  });

  test("marca a origem do lançamento, para dar para auditar e reverter depois", async () => {
    await preencherTudo();
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createPurchase).toHaveBeenCalledTimes(1));

    const { sourceFile } = createPurchase.mock.calls[0][0];
    // O prefixo é o que permite listar tudo que entrou por este caminho.
    expect(sourceFile).toMatch(/^doc-intake:/);
    expect(sourceFile).toContain("1454727.pdf");
  });

  test("pede confirmação e respeita o cancelamento", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await preencherTudo();
    fireEvent.click(botaoLancar());
    expect(createPurchase).not.toHaveBeenCalled();
  });

  test("não grava duas vezes: depois de lançar, o botão some", async () => {
    await preencherTudo();
    fireEvent.click(botaoLancar());
    await screen.findByText(/Lançado — compra C-001/i);
    expect(screen.queryByRole("button", { name: /Lançar em Contas a Pagar/i })).not.toBeInTheDocument();
  });
});
