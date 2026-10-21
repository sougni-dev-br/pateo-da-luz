import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Money lê o contexto de "ocultar valores" (que exige sessão); aqui só interessa o valor.
vi.mock("../../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

const CODIGOS_DAS = [
  { code: "1001", description: "IRPJ - SIMPLES NACIONAL" },
  { code: "1002", description: "CSLL - SIMPLES NACIONAL" },
  { code: "1004", description: "COFINS - SIMPLES NACIONAL" },
  { code: "1005", description: "PIS - SIMPLES NACIONAL" },
  { code: "1006", description: "INSS - SIMPLES NACIONAL" },
  { code: "1007", description: "ICMS - SIMPLES NACIONAL SP" },
];

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  createTaxPayment: vi.fn(async () => ({ id: "novo" })),
  updateTaxPayment: vi.fn(async () => ({ id: "g1" })),
  getCompanies: vi.fn(async () => []),
  getTaxDreCategories: vi.fn(async () => [{ id: "cat-simples", name: "Simples Nacional", dreGroup: "IMPOSTOS" }, { id: "cat-outra", name: "Taxas Municipais", dreGroup: "DESPESAS_GERAIS" }]),
  // Tipos com regra devolvem categoria; IPTU não tem categoria automática.
  getTaxCategorySuggestion: vi.fn(async (tipo: string) => (tipo === "IPTU" ? { dreCategoryId: null, nome: null } : { dreCategoryId: "cat-simples", nome: "Simples Nacional" })),
  getTaxCodes: vi.fn(async (tipo: string) => (tipo === "Simples Nacional / DAS" ? CODIGOS_DAS : [])),
  getTaxPayments: vi.fn(async () => ({ data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }, summary: {} })),
  getTaxPayment: vi.fn(),
}));

import { createTaxPayment, getCompanies, getTaxPayment, getTaxPayments } from "../../../api/client";
import { ModalGuia } from "../ModalGuia";

const VALORES_DAS = ["46971", "29890", "108803", "23571", "358689", "206087"];

function abrir(extra: Partial<Parameters<typeof ModalGuia>[0]> = {}) {
  const onSalvo = vi.fn();
  render(<ModalGuia editId={null} podeEditar podeCancelar onFechar={vi.fn()} onSalvo={onSalvo} {...extra} />);
  return { onSalvo };
}

const botaoLancar = () => screen.getByRole("button", { name: "Lançar guia" }) as HTMLButtonElement;

async function preencherDas({ numero = "07.20.26290.7165263-2" }: { numero?: string } = {}) {
  fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
  fireEvent.change(screen.getByLabelText(/Vencimento/), { target: { value: "2026-10-20" } });
  if (numero) fireEvent.change(screen.getByLabelText(/Número do documento/), { target: { value: numero } });
  VALORES_DAS.forEach((v, i) => fireEvent.change(screen.getByLabelText(`Principal da linha ${i + 1}`), { target: { value: v } }));
  // a categoria automática chega com atraso (consulta ao servidor)
  await waitFor(() => expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-simples"));
}

describe("ModalGuia: lançar pela composição", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
  });

  test("DAS: as seis linhas do documento, com a denominação travada, total somado e competência sugerida", async () => {
    abrir();
    await preencherDas();
    expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(6);
    expect((screen.getByLabelText("Denominação da linha 5") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText(/Competência/) as HTMLInputElement).value).toBe("2026-09");
    expect(screen.getByText("7740.11", { selector: "strong span" })).toBeTruthy();
  });

  test("guia incompleta: o painel lista as pendências e o botão fica desativado", () => {
    abrir();
    expect(botaoLancar().disabled).toBe(true);
    const painel = screen.getByRole("region", { name: "Pendências para lançar" });
    expect(painel.textContent).toMatch(/pendências? para lançar a guia/);
    expect(painel.textContent).toMatch(/Escolha o tipo da guia/);
    expect(painel.textContent).toMatch(/Informe o vencimento/);
    expect(painel.textContent).toMatch(/Informe a competência\. Sem ela a guia fica fora do DRE e não pode ser lançada/);
    expect(painel.textContent).toMatch(/ao menos uma linha/);
  });

  test("sem competência não lança; com ela, libera", async () => {
    abrir();
    await preencherDas();
    expect(botaoLancar().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/Competência/), { target: { value: "" } });
    expect(botaoLancar().disabled).toBe(true);
    expect(screen.getByRole("region", { name: "Pendências para lançar" }).textContent).toMatch(/Informe a competência/);
    fireEvent.change(screen.getByLabelText(/Competência/), { target: { value: "2026-09" } });
    expect(botaoLancar().disabled).toBe(false);
    expect(screen.getByText(/Tudo resolvido/)).toBeTruthy();
  });

  test("DAS sem número do documento é pendência", async () => {
    abrir();
    await preencherDas({ numero: "" });
    expect(botaoLancar().disabled).toBe(true);
    expect(screen.getByRole("region", { name: "Pendências para lançar" }).textContent).toMatch(/Informe o número do documento/);
  });

  test("clicar numa pendência leva ao campo que a resolve", () => {
    abrir();
    fireEvent.click(screen.getByRole("button", { name: /Informe o vencimento/ }));
    expect(document.activeElement).toBe(screen.getByLabelText(/Vencimento/));
  });

  test("com tudo resolvido, lançar grava as linhas (não o valor) e devolve vencimento e competência para a página", async () => {
    const { onSalvo } = abrir();
    await preencherDas();
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createTaxPayment).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createTaxPayment).mock.calls[0][0];
    expect(payload.items).toHaveLength(6);
    expect(payload.items?.[0]).toMatchObject({ code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: 469.71 });
    expect(payload.competenceDate).toBe("2026-09-01");
    expect(payload.documentNumber).toBe("07.20.26290.7165263-2");
    expect("amount" in payload).toBe(false);
    expect(onSalvo.mock.calls[0][0]).toMatch(/A baixa é feita lá/);
    expect(onSalvo.mock.calls[0][1]).toEqual({ dueDate: "2026-10-20", mes: "2026-09" });
  });

  test("não existe mais 'Lançar e lançar outra' dentro do modal", () => {
    abrir();
    expect(screen.queryByRole("button", { name: /lançar outra/i })).toBeNull();
  });

  test("Enter num campo NÃO grava a guia pela metade", async () => {
    abrir();
    await preencherDas();
    for (const campo of [screen.getByLabelText(/Vencimento/), screen.getByLabelText("Principal da linha 1"), screen.getByLabelText(/Número do documento/)]) {
      const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      campo.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(createTaxPayment).not.toHaveBeenCalled();
  });

  test("Ctrl+Enter grava quando está tudo resolvido, e não grava com pendência", async () => {
    abrir();
    fireEvent.keyDown(screen.getByLabelText(/Vencimento/), { key: "Enter", ctrlKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(createTaxPayment).not.toHaveBeenCalled();
    await preencherDas();
    fireEvent.keyDown(screen.getByLabelText(/Vencimento/), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(createTaxPayment).toHaveBeenCalledTimes(1));
  });

  test("total do papel diferente da soma vira pendência e bloqueia; igual libera", async () => {
    abrir();
    await preencherDas();
    fireEvent.change(screen.getByLabelText("Total impresso no documento, para conferir"), { target: { value: "774000" } });
    expect(botaoLancar().disabled).toBe(true);
    expect(screen.getByRole("region", { name: "Pendências para lançar" }).textContent).toMatch(/difere do total do papel/);
    fireEvent.change(screen.getByLabelText("Total impresso no documento, para conferir"), { target: { value: "774011" } });
    expect(botaoLancar().disabled).toBe(false);
  });

  test("aviso de número repetido é pendência", async () => {
    vi.mocked(getTaxPayments).mockResolvedValue({
      data: [{ id: "outra", documentNumber: "07.20.26290.7165263-2", documentType: "Simples Nacional / DAS", competenceDate: "2026-09-01T00:00:00.000Z", status: "PENDING" }],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 }, summary: {},
    } as never);
    abrir();
    await preencherDas();
    await waitFor(() => expect(botaoLancar().disabled).toBe(true));
    expect(screen.getAllByText(/Já existe a guia nº 07\.20\.26290\.7165263-2/).length).toBeGreaterThan(0);
    vi.mocked(getTaxPayments).mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }, summary: {} } as never);
  });
});

describe("ModalGuia: código traz a denominação e a categoria do DRE é automática", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
  });

  test("linha nova: o código digitado preenche a denominação, travada", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    await waitFor(() => expect(screen.getByLabelText("Código da linha 1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    const nome = screen.getByLabelText("Denominação da linha 7") as HTMLInputElement;
    expect(nome.readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText("Código da linha 7"), { target: { value: "1007" } });
    expect(nome.value).toBe("ICMS - SIMPLES NACIONAL SP");
  });

  test("categoria automática: vem sozinha e o campo fica travado", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    const select = await screen.findByLabelText(/Categoria no DRE \(automática\)/) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("cat-simples"));
    expect(select.disabled).toBe(true);
    expect(screen.getByText(/Automática: definida pelo tipo e pelas linhas/)).toBeTruthy();
  });

  test("tipo sem categoria automática: a pessoa escolhe e a falta é pendência", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    fireEvent.change(screen.getByLabelText("Outro tipo de guia"), { target: { value: "IPTU" } });
    // troca de tipo sem valores digitados: direto, sem confirmação
    await waitFor(() => expect(screen.getByRole("button", { name: /Escolha a categoria do DRE/ })).toBeTruthy());
    const select = screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(screen.getByText(/Este tipo não tem categoria automática/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "cat-outra" } });
    expect(screen.queryByRole("button", { name: /Escolha a categoria do DRE/ })).toBeNull();
  });

  test("com empresas cadastradas, escolher a empresa é obrigatório", async () => {
    vi.mocked(getCompanies).mockResolvedValue([
      { id: "e1", cnpj: "12345678000190", legalName: "Empresa Exemplo Ltda", tradeName: "Exemplo" },
    ] as never);
    abrir();
    expect(await screen.findByRole("button", { name: /Escolha a empresa/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Empresa \(CNPJ no documento\)/), { target: { value: "e1" } });
    expect(screen.queryByRole("button", { name: /Escolha a empresa/ })).toBeNull();
    expect(screen.getByRole("option", { name: "12.345.678/0001-90 — Empresa Exemplo Ltda" })).toBeTruthy();
  });
});

describe("ModalGuia: tipo, modelos e confirmações", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
  });

  test("tipos de guia são uma escolha única (radiogroup)", () => {
    abrir();
    expect(screen.getByRole("radiogroup", { name: "Tipo da guia" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    expect(screen.getByRole("radio", { name: "FGTS" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Simples Nacional / DAS" }).getAttribute("aria-checked")).toBe("false");
  });

  test("FGTS: rótulo Identificador (obrigatório) e a dica do que vai em Observações", () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    expect(screen.getByLabelText(/Identificador/)).toBeTruthy();
    expect(screen.getByText(/quantidade de trabalhadores/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Informe o identificador/ })).toBeTruthy();
  });

  test("trocar o tipo depois de digitar valores pede confirmação antes de apagar", async () => {
    abrir();
    await preencherDas();
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    expect(screen.getByText(/Trocar para FGTS\?/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Simples Nacional / DAS" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Trocar o tipo" }));
    expect(screen.getByRole("radio", { name: "FGTS" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(4);
  });

  test("trocar o tipo sem ter digitado valores troca as linhas direto", () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    expect(screen.queryByText(/Trocar para FGTS\?/)).toBeNull();
    expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(4);
  });

  test("abre já com tipo, competência e vencimento vindos do alerta ou da faixa 'Lançar outra guia'", () => {
    abrir({ inicial: { tipo: "FGTS", mes: "2026-08", dueDate: "2026-09-20" } });
    expect(screen.getByRole("radio", { name: "FGTS" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText(/Competência/) as HTMLInputElement).value).toBe("2026-08");
    expect((screen.getByLabelText(/Vencimento/) as HTMLInputElement).value).toBe("2026-09-20");
    expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(4);
  });

  test("multa e juros começam recolhidos e abrem pelo interruptor", () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    expect(screen.queryByLabelText("Multa da linha 1")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Guia com multa e juros" }));
    expect(screen.getByLabelText("Multa da linha 1")).toBeTruthy();
  });
});

describe("ModalGuia: editar guia", () => {
  const detalhe = (extra: object = {}) => ({
    id: "g1", documentType: "Simples Nacional / DAS", description: "x", documentNumber: "A-1", competenceDate: "2026-09-01T00:00:00.000Z",
    dueDate: "2026-10-20T00:00:00.000Z", amount: "1000.00", paymentDate: null, paidAmount: null, status: "PENDING", comments: null,
    companyId: null, cnpj: null, legalName: null, tradeName: null, dreCategoryId: "cat-simples",
    items: [{ id: "i1", position: 0, code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: "900.00", fine: "100.00", interest: "0.00" }],
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
  });

  test("guia com multa já mostra a coluna de multa", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe() as never);
    abrir({ editId: "g1" });
    expect(await screen.findByLabelText("Multa da linha 1")).toBeTruthy();
  });

  test("guia paga: valores travados, com o motivo e o atalho para estornar em Contas a Pagar", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe({ status: "PAID", paymentDate: "2026-10-19T00:00:00.000Z", paidAmount: "1000.00" }) as never);
    const onContasAPagar = vi.fn();
    abrir({ editId: "g1", onContasAPagar });
    const principal = await screen.findByLabelText("Principal da linha 1");
    expect((principal as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/estorne o pagamento lá/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir em Contas a Pagar para estornar" }));
    expect(onContasAPagar).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
  });

  test("o rodapé diz Fechar (cancelar a guia é outra coisa, na situação da guia)", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe() as never);
    abrir({ editId: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    expect(screen.getByRole("button", { name: "Fechar" })).toBeTruthy();
    expect(screen.getByText(/Cancelada fica no histórico/)).toBeTruthy();
  });

  test("editar uma guia sem competência (antiga) também exige a competência para salvar", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe({ competenceDate: null }) as never);
    abrir({ editId: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    expect((screen.getByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Competência/), { target: { value: "2026-09" } });
    expect((screen.getByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("a categoria de uma guia já gravada não muda sozinha e fica travada", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe() as never);
    abrir({ editId: "g1" });
    const select = await screen.findByLabelText(/Categoria no DRE/) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(true));
    expect(select.value).toBe("cat-simples");
  });
});
