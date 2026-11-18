import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const CODIGOS_MEI = [
  { code: "0151", description: "INSS - MEI" },
  { code: "0083", description: "ICMS - MEI" },
];

const CODIGOS_DARF = [
  { code: "1082", description: "CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO" },
  { code: "1099", description: "CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL" },
  { code: "0561", description: "IRRF - RENDIMENTO DO TRABALHO ASSALARIADO" },
];

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  createTaxPayment: vi.fn(async () => ({ id: "novo" })),
  updateTaxPayment: vi.fn(async () => ({ id: "g1" })),
  getCompanies: vi.fn(async () => []),
  getEmployees: vi.fn(async () => []),
  getTaxDreCategories: vi.fn(async () => [{ id: "cat-simples", name: "Simples Nacional", dreGroup: "IMPOSTOS" }, { id: "cat-outra", name: "Taxas Municipais", dreGroup: "DESPESAS_GERAIS" }]),
  // Tipos com regra devolvem categoria; IPTU não tem categoria automática.
  getTaxCategorySuggestion: vi.fn(async (tipo: string) => (tipo === "IPTU" ? { dreCategoryId: null, nome: null } : { dreCategoryId: "cat-simples", nome: "Simples Nacional" })),
  updateTaxCode: vi.fn(async (_tipo: string, code: string, description: string) => ({ code, description })),
  getTaxCodes: vi.fn(async (tipo: string) => (tipo === "Simples Nacional / DAS" ? CODIGOS_DAS : tipo === "DAS MEI" ? CODIGOS_MEI : tipo === "DARF" ? CODIGOS_DARF : [])),
  getTaxPayments: vi.fn(async () => ({ data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }, summary: {} })),
  getTaxPayment: vi.fn(),
}));

import { createTaxPayment, getCompanies, getEmployees, getTaxCategorySuggestion, getTaxCodes, getTaxDreCategories, getTaxPayment, getTaxPayments, updateTaxCode } from "../../../api/client";
import { EVENTO_SESSAO_EXPIRADA } from "../../../api/client";
import { FORM_VAZIO } from "../formularioGuia";
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

  test("DAS MEI: INSS (0151) e ICMS (0083) já vêm como linhas e a guia pode ser lançada", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DAS MEI" }));
    fireEvent.change(screen.getByLabelText(/Vencimento/), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText(/Número do documento/), { target: { value: "07.20.26290.0000001-1" } });
    expect((screen.getByLabelText("Código da linha 1") as HTMLInputElement).value).toBe("0151");
    expect((screen.getByLabelText("Denominação da linha 1") as HTMLInputElement).value).toBe("INSS - MEI");
    expect((screen.getByLabelText("Código da linha 2") as HTMLInputElement).value).toBe("0083");
    fireEvent.change(screen.getByLabelText("Principal da linha 1"), { target: { value: "8190" } });
    fireEvent.change(screen.getByLabelText("Principal da linha 2"), { target: { value: "100" } });
    await waitFor(() => expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-simples"));
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createTaxPayment).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createTaxPayment).mock.calls[0][0];
    expect(payload.documentType).toBe("DAS MEI");
    expect(payload.items).toEqual([
      expect.objectContaining({ code: "0151", description: "INSS - MEI", principal: 81.9 }),
      expect.objectContaining({ code: "0083", description: "ICMS - MEI", principal: 1 }),
    ]);
    expect(payload.competenceDate).toBe("2026-10-01");
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

  test("DARF com código fora do catálogo (1506): a denominação se abre para digitar", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    await waitFor(() => expect(screen.getByLabelText("Código da linha 1")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    const nome = screen.getByLabelText("Denominação da linha 3") as HTMLInputElement;
    fireEvent.change(screen.getByLabelText("Código da linha 3"), { target: { value: "1506" } });
    expect(nome.readOnly).toBe(false);
    expect(nome.placeholder).toMatch(/Código novo/);
    fireEvent.change(nome, { target: { value: "CP SEGURADOS" } });
    expect(nome.value).toBe("CP SEGURADOS");
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
    expect(screen.getByLabelText(/quantidade de trabalhadores/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Informe o identificador/ })).toBeTruthy();
  });

  test("FGTS de rescisão: lista só funcionários desligados e exige a escolha quando há verba de rescisão", async () => {
    vi.mocked(getEmployees).mockResolvedValue([
      { id: "ativo", firstName: "Ana", lastName: "Ativa", displayName: null, terminationDate: null, isActive: true },
      { id: "saiu", firstName: "Bruno", lastName: "Saiu", displayName: null, terminationDate: "2026-09-03T00:00:00.000Z", isActive: false },
    ] as never);
    abrir({ podeVerFuncionarios: true });
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    const campo = await screen.findByLabelText(/Funcionário desligado/);
    await waitFor(() => expect(screen.getByRole("option", { name: /Bruno Saiu — saiu em 03\/09\/2026/ })).toBeTruthy());
    expect(screen.queryByRole("option", { name: /Ana Ativa/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /escolha o funcionário desligado/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("Principal da linha 2"), { target: { value: "90000" } });
    expect(screen.getByRole("button", { name: /escolha o funcionário desligado/i })).toBeTruthy();
    fireEvent.change(campo, { target: { value: "saiu" } });
    expect(screen.queryByRole("button", { name: /escolha o funcionário desligado/i })).toBeNull();
  });

  test("sem permissão para ver Funcionários o campo não aparece", () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    expect(screen.queryByLabelText(/Funcionário desligado/)).toBeNull();
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

  test("FGTS não tem multa e juros separados: sem interruptor e sem as colunas (encargos é uma linha)", () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    expect(screen.queryByRole("switch", { name: "Guia com multa e juros" })).toBeNull();
    expect(screen.queryByLabelText("Multa da linha 1")).toBeNull();
    expect(screen.getByLabelText("Denominação da linha 4")).toBeTruthy();
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

  test("guia gravada que troca de tipo recalcula a categoria do DRE (a antiga não vale mais)", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe() as never);
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async (tipo: string) => (tipo === "FGTS" ? { dreCategoryId: "cat-outra", nome: "Taxas Municipais" } : { dreCategoryId: "cat-simples", nome: "Simples Nacional" }));
    abrir({ editId: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-simples");
    fireEvent.click(screen.getByRole("radio", { name: "FGTS" }));
    await waitFor(() => expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-outra"));
  });

  test("duplicar recalcula a categoria pelas linhas da cópia (não copia a da guia de origem)", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe({ dreCategoryId: "cat-outra" }) as never);
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async () => ({ dreCategoryId: "cat-simples", nome: "Simples Nacional" }));
    abrir({ duplicarDe: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    await waitFor(() => expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-simples"));
  });

  test("duplicar tipo sem categoria automática mantém a categoria escolhida à mão na guia de origem", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe({ documentType: "IPTU", dreCategoryId: "cat-outra" }) as never);
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async () => ({ dreCategoryId: null, nome: null }));
    abrir({ duplicarDe: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    await waitFor(() => expect(screen.getByText(/Este tipo não tem categoria automática/)).toBeTruthy());
    expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-outra");
    expect(screen.queryByRole("button", { name: /Escolha a categoria do DRE/ })).toBeNull();
  });

  test("duplicar e depois trocar para outro tipo sem regra automática: a categoria da origem sai e vira pendência", async () => {
    vi.mocked(getTaxPayment).mockResolvedValue(detalhe({ documentType: "IPTU", dreCategoryId: "cat-outra" }) as never);
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async () => ({ dreCategoryId: null, nome: null }));
    abrir({ duplicarDe: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    await waitFor(() => expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe("cat-outra"));
    fireEvent.change(screen.getByLabelText("Outro tipo de guia"), { target: { value: "ISS" } });
    fireEvent.click(await screen.findByRole("button", { name: "Trocar o tipo" }));
    await waitFor(() => expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).value).toBe(""));
    expect(screen.getByRole("button", { name: /Escolha a categoria do DRE/ })).toBeTruthy();
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


describe("ModalGuia: lançamento repetível e rascunho da sessão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
    // testes anteriores trocam a implementação da sugestão: volta ao padrão (tipos com regra devolvem a categoria do Simples)
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async (tipo: string) => (tipo === "IPTU" ? { dreCategoryId: null, nome: null } : { dreCategoryId: "cat-simples", nome: "Simples Nacional" }));
    sessionStorage.clear();
  });

  test("salvar de novo depois de uma falha reenvia o MESMO identificador (o servidor não cria a guia duas vezes)", async () => {
    vi.mocked(createTaxPayment).mockRejectedValueOnce(new Error("tempo esgotado"));
    abrir();
    await preencherDas();
    fireEvent.click(botaoLancar());
    expect(await screen.findByText("tempo esgotado")).toBeTruthy();
    await waitFor(() => expect(botaoLancar().disabled).toBe(false));
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createTaxPayment).toHaveBeenCalledTimes(2));
    const [primeira, segunda] = vi.mocked(createTaxPayment).mock.calls.map((c) => (c[0] as { clientId?: string }).clientId);
    expect(primeira).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(segunda).toBe(primeira);
  });

  test("cada modal novo gera o seu identificador", async () => {
    abrir();
    await preencherDas();
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createTaxPayment).toHaveBeenCalledTimes(1));
    cleanup();
    abrir();
    await preencherDas({ numero: "07.20.26290.0000000-1" });
    fireEvent.click(botaoLancar());
    await waitFor(() => expect(createTaxPayment).toHaveBeenCalledTimes(2));
    const ids = vi.mocked(createTaxPayment).mock.calls.map((c) => (c[0] as { clientId?: string }).clientId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  function abrirParaRascunho() {
    return render(<ModalGuia editId={null} podeEditar podeCancelar onFechar={vi.fn()} onSalvo={vi.fn()} />);
  }

  test("sessão expirada no meio do lançamento: guarda o rascunho e, depois do login, oferece restaurar", async () => {
    const primeira = abrirParaRascunho();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    fireEvent.change(await screen.findByLabelText("Principal da linha 1"), { target: { value: "442851" } });
    fireEvent.change(screen.getByLabelText(/Número do documento/), { target: { value: "07.16.26253.0501136-1" } });
    window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    expect(sessionStorage.getItem("impostos:rascunho:v1")).not.toBeNull();
    primeira.unmount();

    abrirParaRascunho();
    expect(await screen.findByText(/Recuperei o que você estava lançando/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));
    expect((await screen.findByLabelText("Principal da linha 1") as HTMLInputElement).value).toBe("4.428,51");
    expect((screen.getByLabelText(/Número do documento/) as HTMLInputElement).value).toBe("07.16.26253.0501136-1");
    expect(screen.queryByText(/Recuperei o que você estava lançando/)).toBeNull();
    expect(sessionStorage.getItem("impostos:rascunho:v1")).toBeNull();
  });

  test("descartar o rascunho apaga e o aviso some", async () => {
    const primeira = abrirParaRascunho();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    fireEvent.change(await screen.findByLabelText("Principal da linha 1"), { target: { value: "100" } });
    window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    primeira.unmount();
    abrirParaRascunho();
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    expect(screen.queryByText(/Recuperei o que você estava lançando/)).toBeNull();
    expect(sessionStorage.getItem("impostos:rascunho:v1")).toBeNull();
  });

  test("modal em que nada foi digitado não guarda rascunho", () => {
    abrirParaRascunho();
    window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    expect(sessionStorage.getItem("impostos:rascunho:v1")).toBeNull();
  });

  test("editar guia gravada não guarda nem oferece rascunho", async () => {
    sessionStorage.setItem("impostos:rascunho:v1", JSON.stringify({ salvoEm: Date.now(), form: { ...FORM_VAZIO, documentType: "DARF" } }));
    vi.mocked(getTaxPayment).mockResolvedValue({
      id: "g1", documentType: "FGTS", description: "x", documentNumber: "A-1", competenceDate: "2026-09-01T00:00:00.000Z",
      dueDate: "2026-10-20T00:00:00.000Z", amount: "100.00", paymentDate: null, paidAmount: null, status: "PENDING", comments: null,
      companyId: null, cnpj: null, legalName: null, tradeName: null, dreCategoryId: "cat-simples",
      items: [{ id: "i1", position: 0, code: null, description: "FGTS Mensal", principal: "100.00", fine: "0.00", interest: "0.00" }],
    } as never);
    abrir({ editId: "g1" });
    await screen.findByLabelText("Principal da linha 1");
    expect(screen.queryByText(/Recuperei o que você estava lançando/)).toBeNull();
  });
});

describe("ModalGuia: acabamentos do teclado e do FGTS de rescisão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async (tipo: string) => (tipo === "IPTU" ? { dreCategoryId: null, nome: null } : { dreCategoryId: "cat-simples", nome: "Simples Nacional" }));
  });

  test("guia de FGTS ligada a um funcionário readmitido: ele continua na lista e o campo não fica em branco", async () => {
    vi.mocked(getEmployees).mockResolvedValue([
      { id: "voltou", firstName: "Carla", lastName: "Voltou", displayName: null, terminationDate: null, isActive: true },
      { id: "saiu", firstName: "Bruno", lastName: "Saiu", displayName: null, terminationDate: "2026-09-03T00:00:00.000Z", isActive: false },
      { id: "ativo", firstName: "Ana", lastName: "Ativa", displayName: null, terminationDate: null, isActive: true },
    ] as never);
    vi.mocked(getTaxPayment).mockResolvedValue({
      id: "g1", documentType: "FGTS", description: "x", documentNumber: "A-1", competenceDate: "2026-09-01T00:00:00.000Z",
      dueDate: "2026-10-20T00:00:00.000Z", amount: "100.00", paymentDate: null, paidAmount: null, status: "PENDING", comments: null,
      companyId: null, cnpj: null, legalName: null, tradeName: null, dreCategoryId: "cat-simples", employeeId: "voltou", workersCount: 1,
      items: [{ id: "i1", position: 0, code: null, description: "FGTS Rescisório", principal: "100.00", fine: "0.00", interest: "0.00" }],
    } as never);
    abrir({ editId: "g1", podeVerFuncionarios: true });
    const campo = await screen.findByLabelText(/Funcionário desligado/) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: /Carla Voltou — hoje ativo\(a\)/ })).toBeTruthy());
    await waitFor(() => expect(campo.value).toBe("voltou"));
    expect(screen.getByRole("option", { name: /Bruno Saiu — saiu em 03\/09\/2026/ })).toBeTruthy();
    // quem não tem relação com a guia e está ativo continua fora da lista
    expect(screen.queryByRole("option", { name: /Ana Ativa/ })).toBeNull();
  });

  test("Ctrl+Delete NÃO remove a linha (no campo de texto ele apaga a próxima palavra)", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(6));
    fireEvent.keyDown(screen.getByLabelText("Principal da linha 3"), { key: "Delete", ctrlKey: true });
    expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(6);
  });

  test("Alt+Delete numa linha remove a linha e leva o foco para o valor de uma vizinha", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(6));
    const terceira = screen.getByLabelText("Principal da linha 3") as HTMLInputElement;
    terceira.focus();
    fireEvent.keyDown(terceira, { key: "Delete", altKey: true });
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(5));
    expect(screen.queryByDisplayValue("1004")).toBeNull(); // o código da linha removida
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Principal da linha 3")));
  });

  test("Alt+Delete na única linha deixa uma linha em branco (nunca zero linhas)", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(2));
    fireEvent.keyDown(screen.getByLabelText("Principal da linha 2"), { key: "Delete", altKey: true });
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(1));
    fireEvent.keyDown(screen.getByLabelText("Principal da linha 1"), { key: "Delete", altKey: true });
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(1));
    expect((screen.getByLabelText("Código da linha 1") as HTMLInputElement).value).toBe("");
  });

  test("o X do mouse e Alt+Delete fazem a mesma coisa", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(6));
    fireEvent.click(screen.getByRole("button", { name: "Remover a linha 2" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(5));
    expect(screen.queryByDisplayValue("1002")).toBeNull();
  });

  test("Enter nos campos do cabeçalho anda para o próximo campo (não grava)", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    const vencimento = await screen.findByLabelText(/Vencimento/) as HTMLInputElement;
    vencimento.focus();
    fireEvent.keyDown(vencimento, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText(/Competência/));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText(/Número do documento/));
    expect(createTaxPayment).not.toHaveBeenCalled();
  });
});

describe("ModalGuia: corrigir a denominação de um código do catálogo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
    vi.mocked(getTaxCategorySuggestion).mockImplementation(async (tipo: string) => (tipo === "IPTU" ? { dreCategoryId: null, nome: null } : { dreCategoryId: "cat-simples", nome: "Simples Nacional" }));
  });

  async function abrirDarf() {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    return await screen.findByRole("button", { name: "Corrigir a denominação do código 1082" });
  }

  test("o lápis corrige o texto no catálogo e já atualiza a linha da guia", async () => {
    const lapis = await abrirDarf();
    fireEvent.click(lapis);
    expect(await screen.findByText("Corrigir o código 1082")).toBeTruthy();
    expect(screen.getByText(/As guias já lançadas guardam o texto que tinham/)).toBeTruthy();
    const campo = screen.getByLabelText(/^Denominação\s*\*?$/) as HTMLInputElement;
    expect(campo.value).toBe("CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO");
    const salvar = screen.getByRole("button", { name: "Salvar correção" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true); // sem mudança, nada a salvar
    fireEvent.change(campo, { target: { value: "  CP SEGURADOS - EMPREGADOS  " } });
    expect(salvar.disabled).toBe(false);
    fireEvent.click(salvar);
    await waitFor(() => expect(updateTaxCode).toHaveBeenCalledWith("DARF", "1082", "CP SEGURADOS - EMPREGADOS"));
    await waitFor(() => expect(screen.queryByText("Corrigir o código 1082")).toBeNull());
    expect((screen.getByLabelText("Denominação da linha 1") as HTMLInputElement).value).toBe("CP SEGURADOS - EMPREGADOS");
    // a linha 2 (outro código) não mudou
    expect((screen.getByLabelText("Denominação da linha 2") as HTMLInputElement).value).toBe("CP DESCONTADA SEGURADO - CONTRIB INDIVIDUAL");
  });

  test("falha ao gravar: mostra o motivo e mantém o diálogo aberto", async () => {
    vi.mocked(updateTaxCode).mockRejectedValueOnce(new Error("Esse código não está no catálogo deste tipo de guia."));
    fireEvent.click(await abrirDarf());
    fireEvent.change(await screen.findByLabelText(/^Denominação\s*\*?$/), { target: { value: "outro texto" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar correção" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/não está no catálogo/)).toBeTruthy();
    expect(screen.getByText("Corrigir o código 1082")).toBeTruthy();
  });

  test("cancelar não grava nada", async () => {
    fireEvent.click(await abrirDarf());
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(updateTaxCode).not.toHaveBeenCalled();
    expect(screen.queryByText("Corrigir o código 1082")).toBeNull();
  });

  test("código novo (que ainda não está no catálogo) não tem o lápis", async () => {
    await abrirDarf();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    fireEvent.change(screen.getByLabelText("Código da linha 3"), { target: { value: "9999" } });
    expect(screen.queryByRole("button", { name: "Corrigir a denominação do código 9999" })).toBeNull();
  });
});

describe("ModalGuia: robustez do lançamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCompanies).mockResolvedValue([]);
  });

  const ultimoFechar = () => { const todos = screen.getAllByRole("button", { name: "Fechar" }); return todos[todos.length - 1]; };

  test("fechar sem ter digitado nada fecha direto", () => {
    const onFechar = vi.fn();
    abrir({ onFechar });
    fireEvent.click(ultimoFechar());
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  test("fechar com valor digitado pergunta antes de descartar; só a confirmação fecha", async () => {
    const onFechar = vi.fn();
    abrir({ onFechar });
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    fireEvent.change(await screen.findByLabelText("Principal da linha 1"), { target: { value: "442851" } });
    fireEvent.click(ultimoFechar());
    expect(onFechar).not.toHaveBeenCalled();
    expect(await screen.findByText("Descartar o que foi digitado?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Descartar e fechar" }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  test("escolher só o tipo (sem digitar nada) não conta como trabalho a perder", async () => {
    const onFechar = vi.fn();
    abrir({ onFechar });
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    await waitFor(() => expect(screen.getByLabelText("Código da linha 1")).toBeTruthy());
    fireEvent.click(ultimoFechar());
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  test("trocar o tipo sem valores digitados traz as linhas do novo tipo, não as do anterior", async () => {
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(6));
    // mexer nas linhas (linha nova) sem digitar valor
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Principal da linha/)).toHaveLength(2));
    expect((screen.getByLabelText("Código da linha 1") as HTMLInputElement).value).toBe("1082");
  });

  test("código digitado antes de o catálogo chegar recebe a denominação quando ele chega", async () => {
    let entregar: (c: { code: string; description: string }[]) => void = () => undefined;
    vi.mocked(getTaxCodes).mockImplementationOnce(() => new Promise((resolve) => { entregar = resolve; }));
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar linha" }));
    fireEvent.change(screen.getByLabelText("Código da linha 3"), { target: { value: "9001" } });
    expect((screen.getByLabelText("Denominação da linha 3") as HTMLInputElement).value).toBe("");
    entregar([{ code: "9001", description: "CODIGO DE TESTE" }]);
    await waitFor(() => expect((screen.getByLabelText("Denominação da linha 3") as HTMLInputElement).value).toBe("CODIGO DE TESTE"));
  });

  test("falha na consulta da categoria: avisa e deixa escolher (vira pendência), em vez de seguir sem categoria", async () => {
    vi.mocked(getTaxCategorySuggestion).mockRejectedValueOnce(new Error("rede"));
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "Simples Nacional / DAS" }));
    expect(await screen.findByText(/Não consegui sugerir a categoria do DRE/)).toBeTruthy();
    expect((screen.getByLabelText(/Categoria no DRE/) as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: /Escolha a categoria do DRE/ })).toBeTruthy();
  });

  test("lançar a partir do alerta de empresa: a empresa pedida já vem escolhida", async () => {
    vi.mocked(getCompanies).mockResolvedValue([
      { id: "c1", cnpj: "00000000000100", legalName: "Empresa A Ltda", tradeName: "Empresa A" },
      { id: "c2", cnpj: "00000000000200", legalName: "Empresa B Ltda", tradeName: "Empresa B" },
    ] as never);
    abrir({ inicial: { tipo: "FGTS", mes: "2026-10", empresaId: "c2" } });
    const select = await screen.findByLabelText(/Empresa \(CNPJ no documento\)/) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("c2"));
  });

  test("Esc com a confirmação de descarte aberta cancela a pergunta, sem fechar o modal", async () => {
    const onFechar = vi.fn();
    abrir({ onFechar });
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    fireEvent.change(await screen.findByLabelText("Principal da linha 1"), { target: { value: "442851" } });
    fireEvent.click(ultimoFechar());
    expect(await screen.findByText("Descartar o que foi digitado?")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Descartar o que foi digitado?")).toBeNull());
    expect(onFechar).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Principal da linha 1") as HTMLInputElement).value).toBe("4.428,51");
  });

  test("lista de empresas que falha ao carregar bloqueia o lançamento e deixa tentar de novo", async () => {
    vi.mocked(getCompanies).mockRejectedValueOnce(new Error("rede"));
    abrir();
    expect(await screen.findByText(/Não consegui carregar a lista de empresas\./, { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Não consegui carregar a lista de empresas\. Tente de novo/ })).toBeTruthy();
    vi.mocked(getCompanies).mockResolvedValueOnce([{ id: "c1", cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: "Exemplo" }] as never);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.queryByText(/Não consegui carregar a lista de empresas\./, { selector: "p" })).toBeNull());
    expect(getCompanies).toHaveBeenCalledTimes(2);
  });

  test("DARF com categoria automática de INSS explica que o DRE divide por linha", async () => {
    vi.mocked(getTaxDreCategories).mockResolvedValueOnce([{ id: "cat-inss", name: "INSS", dreGroup: "PESSOAL" }, { id: "cat-irrf", name: "IRRF / DARF", dreGroup: "IMPOSTOS" }] as never);
    vi.mocked(getTaxCategorySuggestion).mockResolvedValueOnce({ dreCategoryId: "cat-inss", nome: "INSS" });
    abrir();
    fireEvent.click(screen.getByRole("radio", { name: "DARF" }));
    expect(await screen.findByText(/o DARF é dividido por linha: 1082 e 1099 vão para INSS, 0561 para IRRF/)).toBeTruthy();
  });

  test("Ctrl+Enter com pendências leva ao campo que falta e não grava", async () => {
    abrir();
    fireEvent.keyDown(screen.getByLabelText(/Número do documento|Identificador/, { selector: "input" }) ?? document.body, { key: "Enter", ctrlKey: true });
    expect(createTaxPayment).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("role")).toBe("radio");
  });
});
