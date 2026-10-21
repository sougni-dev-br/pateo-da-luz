import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TaxPanorama, TaxPayment } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTaxPayment: vi.fn(),
}));
import { getTaxPayment } from "../../../api/client";

// Money lê o contexto de "ocultar valores" (que exige sessão); aqui só interessa o valor.
vi.mock("../../../design-system/components/Money", () => ({ Money: ({ value }: { value: number }) => <span>{String(value)}</span> }));

import { useState } from "react";
import { ListaGuias } from "../ListaGuias";
import { ComposicaoDaGuia } from "../ComposicaoDaGuia";
import { LinhasDaGuia } from "../LinhasDaGuia";
import { diferencaComOPapel, linhasDoModelo, novaLinha } from "../formularioGuia";
import { ResumoImpostos } from "../ResumoImpostos";

const hoje = "2026-10-20";

// Códigos conhecidos do DAS (o sistema guarda): o código digitado traz a denominação.
const CATALOGO_DAS = [
  { code: "1001", description: "IRPJ - SIMPLES NACIONAL" },
  { code: "1002", description: "CSLL - SIMPLES NACIONAL" },
  { code: "1004", description: "COFINS - SIMPLES NACIONAL" },
  { code: "1005", description: "PIS - SIMPLES NACIONAL" },
  { code: "1006", description: "INSS - SIMPLES NACIONAL" },
  { code: "1007", description: "ICMS - SIMPLES NACIONAL SP" },
];
const catalogoDo = (tipo: string) => (tipo === "Simples Nacional / DAS" ? CATALOGO_DAS : []);


const guia = (extra: Partial<TaxPayment> = {}): TaxPayment => ({
  id: "g1", companyId: null, cnpj: "00000000000100", legalName: "Empresa Exemplo Ltda", tradeName: "Exemplo",
  documentType: "FGTS", description: "FGTS mensal", documentNumber: null, competenceDate: "2026-09-01T00:00:00.000Z", dueDate: "2026-10-07T00:00:00.000Z",
  amount: "1980.00", paymentDate: null, paidAmount: null, status: "PENDING", comments: null, source: "MANUAL", importBatchId: null,
  dreCategoryId: null, dreCategoryName: null, createdById: "u1", deletedAt: null, createdAt: "", updatedAt: "", ...extra,
});

const acoes = {
  onEditar: vi.fn(), onDuplicar: vi.fn(), onExcluir: vi.fn(), onContasAPagar: vi.fn(), onLimparFiltros: vi.fn(),
};

const lista = (guias: TaxPayment[], extra: Record<string, unknown> = {}) =>
  render(<ListaGuias guias={guias} hoje={hoje} carregando={false} podeEditar podeVerContasAPagar podeLancar podeExcluir filtrando={false} {...acoes} {...extra} />);

describe("ListaGuias", () => {
  beforeEach(() => vi.clearAllMocks());

  test("guia vencida mostra o prazo em atraso; Pagar leva para Contas a Pagar, onde a baixa é feita", () => {
    lista([guia()]);
    expect(screen.getAllByText("venceu há 13 dias").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Pagar FGTS em Contas a Pagar" })[0]);
    expect(acoes.onContasAPagar).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
  });

  test("guia paga e guia cancelada não têm botão Pagar", () => {
    lista([
      guia({ id: "p", paymentDate: "2026-10-05T00:00:00.000Z", paidAmount: "1980.00" }),
      guia({ id: "c", status: "CANCELED" }),
    ]);
    expect(screen.queryAllByRole("button", { name: /^Pagar/ })).toHaveLength(0);
    expect(screen.getAllByText("Paga").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelada").length).toBeGreaterThan(0);
  });

  test("quem só consulta impostos ainda chega a Contas a Pagar pela guia em aberto", () => {
    lista([guia()], { podeEditar: false });
    expect(screen.getAllByRole("button", { name: /^Pagar FGTS/ }).length).toBeGreaterThan(0);
  });

  test("quem não tem acesso a Contas a Pagar não recebe o atalho Pagar (cairia numa tela negada)", () => {
    lista([guia()], { podeVerContasAPagar: false });
    expect(screen.queryAllByRole("button", { name: /^Pagar/ })).toHaveLength(0);
  });

  test("guia sem competência avisa que fica fora do DRE", () => {
    lista([guia({ competenceDate: null })]);
    expect(screen.getAllByText("sem competência").length).toBeGreaterThan(0);
  });

  test("lista vazia com filtros oferece limpar; sem filtros oferece lançar", () => {
    const { unmount } = lista([], { filtrando: true });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(acoes.onLimparFiltros).toHaveBeenCalled();
    unmount();
    lista([], { onLancar: vi.fn() });
    expect(screen.getByRole("button", { name: "Lançar guia" })).toBeTruthy();
  });
});

describe("ResumoImpostos", () => {
  const z = { qtd: 0, valor: 0 };
  const base: TaxPanorama = {
    hoje, situacoes: { todas: 0, vencidas: 0, aVencer: 0, pagas: 0, canceladas: 0 },
    aPagar: { vencido: z, ate7: z, ate30: z, depois: z }, meses: ["2026-08", "2026-09", "2026-10"], cobertura: [], semCompetencia: 0,
  };
  const props = { podeLancar: true, onLancar: vi.fn(), onVerSituacao: vi.fn(), onVerMes: vi.fn() };

  test("nada pendente: diz que está tudo em dia", () => {
    render(<ResumoImpostos panorama={base} {...props} />);
    expect(screen.getByText("Tudo em dia")).toBeTruthy();
  });

  test("vencidas e guias sem competência aparecem como atenção, e Ver vencidas filtra", () => {
    const p: TaxPanorama = { ...base, aPagar: { ...base.aPagar, vencido: { qtd: 2, valor: 4060 } }, semCompetencia: 3 };
    render(<ResumoImpostos panorama={p} {...props} />);
    expect(screen.getByText("2 guias vencidas")).toBeTruthy();
    expect(screen.getByText("3 guias sem competência")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver vencidas" }));
    expect(props.onVerSituacao).toHaveBeenCalledWith("OVERDUE");
  });

  test("falta de guia de um imposto vira alerta mesmo que outro esteja em dia, e a célula em falta é marcada", () => {
    const meses = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const fgts = ["2026-05", "2026-06", "2026-07"].map((mes) => ({ mes, grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: 100 }));
    const das = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((mes) => ({ mes, grupo: "Simples Nacional", qtd: 1, pagas: 1, vencidas: 0, valor: 100 }));
    render(<ResumoImpostos panorama={{ ...base, meses, cobertura: [...fgts, ...das] }} {...props} />);
    expect(screen.getByText("Falta lançar guia de FGTS")).toBeTruthy();
    expect(screen.queryByText("Tudo em dia")).toBeNull();
    expect(screen.getByRole("button", { name: "FGTS, ago/26: falta lançar a guia" })).toBeTruthy();
    // Falta um imposto só: o botão já diz qual e o modal abre com o tipo e o primeiro mês em falta.
    fireEvent.click(screen.getByRole("button", { name: "Lançar FGTS de ago/26" }));
    expect(props.onLancar).toHaveBeenCalledWith({ tipo: "FGTS", mes: "2026-08" });
  });

  test("clicar numa célula pede a lista daquele mês", () => {
    const cobertura = [{ mes: "2026-09", grupo: "FGTS", qtd: 1, pagas: 1, vencidas: 0, valor: 100 }];
    render(<ResumoImpostos panorama={{ ...base, cobertura }} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "FGTS, set/26: 1 guia, pago" }));
    expect(props.onVerMes).toHaveBeenCalledWith("2026-09");
  });
});

describe("LinhasDaGuia", () => {
  function Editor({ tipo = "Simples Nacional / DAS", somenteLeitura = false, multaJuros = true }: { tipo?: string; somenteLeitura?: boolean; multaJuros?: boolean }) {
    const [linhas, setLinhas] = useState(linhasDoModelo(tipo));
    const [papel, setPapel] = useState("");
    return (
      <LinhasDaGuia
        linhas={linhas} tipo={tipo} catalogo={catalogoDo(tipo)} onChange={setLinhas} somenteLeitura={somenteLeitura} mostrarMultaJuros={multaJuros}
        totalDoPapel={papel} onTotalDoPapel={setPapel} diferenca={diferencaComOPapel({ linhas, totalDoPapel: papel })}
      />
    );
  }

  test("digitar os valores das linhas do DAS soma o total da guia", () => {
    render(<Editor />);
    const principais = screen.getAllByLabelText(/^Principal da linha/);
    expect(principais).toHaveLength(6);
    const valores = ["46971", "29890", "108803", "23571", "358689", "206087"];
    valores.forEach((v, i) => fireEvent.change(principais[i], { target: { value: v } }));
    expect(screen.getByText("7740.11")).toBeTruthy();
  });

  test("multa e juros entram no total da linha", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Principal da linha 1"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Multa da linha 1"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("Juros da linha 1"), { target: { value: "50" } });
    expect(screen.getByLabelText("Total da linha 1").textContent).toBe("102.5");
  });

  test("o código digitado traz a denominação do catálogo, travada (não se digita)", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    const nome = screen.getByLabelText("Denominação da linha 7") as HTMLInputElement;
    expect(nome.readOnly).toBe(true);
    expect(nome.placeholder).toMatch(/Digite o código/);
    fireEvent.change(screen.getByLabelText("Código da linha 7"), { target: { value: "1004" } });
    expect(nome.value).toBe("COFINS - SIMPLES NACIONAL");
    expect(nome.readOnly).toBe(true);
    expect(nome.getAttribute("tabindex")).toBe("-1");
  });

  test("as linhas do modelo já vêm com a denominação travada", () => {
    render(<Editor />);
    const nome = screen.getByLabelText("Denominação da linha 1") as HTMLInputElement;
    expect(nome.value).toBe("IRPJ - SIMPLES NACIONAL");
    expect(nome.readOnly).toBe(true);
  });

  test("código novo libera a denominação para ser informada e avisa que o sistema guarda", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    fireEvent.change(screen.getByLabelText("Código da linha 7"), { target: { value: "9999" } });
    const nome = screen.getByLabelText("Denominação da linha 7") as HTMLInputElement;
    expect(nome.readOnly).toBe(false);
    expect(nome.placeholder).toMatch(/Código novo/);
    expect(screen.getByText(/a denominação fica guardada no sistema/)).toBeTruthy();
    fireEvent.change(nome, { target: { value: "ISS - SIMPLES NACIONAL" } });
    expect(nome.value).toBe("ISS - SIMPLES NACIONAL");
  });

  test("trocar o código de uma linha travada por um desconhecido apaga a denominação anterior", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Código da linha 1"), { target: { value: "100" } });
    const nome = screen.getByLabelText("Denominação da linha 1") as HTMLInputElement;
    expect(nome.value).toBe("");
    expect(nome.readOnly).toBe(false);
  });

  test("trocar o código por outro conhecido troca a denominação", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Código da linha 1"), { target: { value: "1007" } });
    expect((screen.getByLabelText("Denominação da linha 1") as HTMLInputElement).value).toBe("ICMS - SIMPLES NACIONAL SP");
  });

  test("tipo sem catálogo (IPTU): a denominação é digitada, sem código", () => {
    render(<Editor tipo="IPTU" />);
    const nome = screen.getByLabelText("Denominação da linha 1") as HTMLInputElement;
    expect(nome.readOnly).toBe(false);
    fireEvent.change(nome, { target: { value: "IPTU 2026 - parcela 1" } });
    expect(nome.value).toBe("IPTU 2026 - parcela 1");
  });

  test("adicionar e remover linhas; remover a última deixa uma linha em branco", () => {
    render(<Editor tipo="IPTU" />);
    expect(screen.getAllByLabelText(/^Denominação da linha/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar linha" }));
    expect(screen.getAllByLabelText(/^Denominação da linha/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remover a linha 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover a linha 1" }));
    expect(screen.getAllByLabelText(/^Denominação da linha/)).toHaveLength(1);
  });

  test("guia paga: linhas somente leitura, sem adicionar nem remover", () => {
    render(<Editor somenteLeitura />);
    expect((screen.getByLabelText("Principal da linha 1") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Adicionar linha" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remover a linha/ })).toBeNull();
  });

  test("linha pendente fica destacada (aria-invalid) na denominação", () => {
    const linha = novaLinha({ principal: "10,00" });
    render(<LinhasDaGuia linhas={[linha]} tipo="IPTU" catalogo={[]} onChange={vi.fn()} somenteLeitura={false} mostrarMultaJuros={false} totalDoPapel="" onTotalDoPapel={vi.fn()} diferenca={null} linhasPendentes={[linha.chave]} />);
    expect(screen.getByLabelText("Denominação da linha 1").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("LinhasDaGuia: digitação rápida", () => {
  function Editor({ multaJuros = false }: { multaJuros?: boolean }) {
    const [linhas, setLinhas] = useState(linhasDoModelo("Simples Nacional / DAS"));
    const [papel, setPapel] = useState("");
    return (
      <LinhasDaGuia
        linhas={linhas} tipo="Simples Nacional / DAS" catalogo={CATALOGO_DAS} onChange={setLinhas} somenteLeitura={false} mostrarMultaJuros={multaJuros}
        totalDoPapel={papel} onTotalDoPapel={setPapel} diferenca={diferencaComOPapel({ linhas, totalDoPapel: papel })}
      />
    );
  }

  test("sem multa e juros as colunas somem: só o principal por linha", () => {
    render(<Editor />);
    expect(screen.queryByLabelText("Multa da linha 1")).toBeNull();
    expect(screen.queryByLabelText("Juros da linha 1")).toBeNull();
    expect(screen.getByLabelText("Principal da linha 1")).toBeTruthy();
  });

  test("Enter no principal pula para o principal da linha de baixo, sem gravar nada", () => {
    render(<Editor />);
    const primeiro = screen.getByLabelText("Principal da linha 1");
    primeiro.focus();
    fireEvent.keyDown(primeiro, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("Principal da linha 2"));
  });

  test("Enter na última linha abre uma linha nova e leva o foco para ela", async () => {
    render(<Editor />);
    const ultima = screen.getByLabelText("Principal da linha 6");
    ultima.focus();
    fireEvent.keyDown(ultima, { key: "Enter" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Principal da linha 7")));
  });

  test("Enter no código ou na denominação vai para o valor da própria linha", () => {
    render(<Editor />);
    const codigo = screen.getByLabelText("Código da linha 3");
    codigo.focus();
    fireEvent.keyDown(codigo, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("Principal da linha 3"));
  });

  test("o Tab pula código e denominação que já vêm do modelo (clique corrige)", () => {
    render(<Editor />);
    expect(screen.getByLabelText("Código da linha 1").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByLabelText("Denominação da linha 1").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByLabelText("Principal da linha 1").getAttribute("tabindex")).toBeNull();
  });

  test("colar um valor com milhar e vírgula entra certo (a máscara de digitação erraria)", () => {
    render(<Editor />);
    const campo = screen.getByLabelText("Principal da linha 1") as HTMLInputElement;
    fireEvent.paste(campo, { clipboardData: { getData: () => "R$ 1.234,56" } });
    expect(campo.value).toBe("1.234,56");
  });

  test("linha sem valor mostra traço no total, não R$ 0,00", () => {
    render(<Editor />);
    expect(screen.getByLabelText("Total da linha 1").textContent).toBe("—");
  });

  test("total do papel: confere, ou diz a diferença", () => {
    render(<Editor />);
    ["46971", "29890", "108803", "23571", "358689", "206087"].forEach((v, i) =>
      fireEvent.change(screen.getByLabelText(`Principal da linha ${i + 1}`), { target: { value: v } }));
    const papel = screen.getByLabelText("Total impresso no documento, para conferir");
    fireEvent.change(papel, { target: { value: "774011" } });
    expect(screen.getByText("Confere com o papel")).toBeTruthy();
    fireEvent.change(papel, { target: { value: "774000" } });
    expect(screen.getByText(/Diferença de/)).toBeTruthy();
    expect(screen.queryByText("Confere com o papel")).toBeNull();
  });

  test("Enter no total do papel também não grava", () => {
    render(<Editor />);
    const papel = screen.getByLabelText("Total impresso no documento, para conferir");
    const evento = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    papel.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
  });
});

describe("ComposicaoDaGuia", () => {
  test("mostra as linhas da guia com o total de cada uma", async () => {
    vi.mocked(getTaxPayment).mockResolvedValueOnce({
      items: [
        { id: "i1", position: 0, code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: "469.71", fine: "0.00", interest: "0.00" },
        { id: "i2", position: 1, code: null, description: "FGTS Mensal", principal: "100.00", fine: "2.00", interest: "1.00" },
      ],
    } as never);
    render(<ComposicaoDaGuia guiaId="g1" />);
    expect(await screen.findByText("IRPJ - SIMPLES NACIONAL")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Multa" })).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
  });

  test("guia sem composição explica e aponta para Editar", async () => {
    vi.mocked(getTaxPayment).mockResolvedValueOnce({ items: [] } as never);
    render(<ComposicaoDaGuia guiaId="g2" />);
    expect(await screen.findByText(/lançada sem composição/)).toBeTruthy();
  });

  test("falha de rede vira aviso, não tela em branco", async () => {
    vi.mocked(getTaxPayment).mockRejectedValueOnce(new Error("x"));
    render(<ComposicaoDaGuia guiaId="g3" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Não consegui carregar a composição/);
  });
});

describe("ListaGuias: número do documento e composição", () => {
  test("mostra o número do documento e a quantidade de linhas no lugar da lista de denominações", () => {
    lista([guia({ documentNumber: "07.20.26290.7165263-2", itemsCount: 6, description: "IRPJ · CSLL · COFINS" })]);
    expect(screen.getAllByText(/nº 07\.20\.26290\.7165263-2/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /6 linhas/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText("IRPJ · CSLL · COFINS")).toBeNull();
  });

  test("clicar em 'N linhas' abre a composição da guia", async () => {
    // A tabela e os cartões do celular existem ao mesmo tempo no DOM: as duas composições buscam a guia.
    vi.mocked(getTaxPayment).mockResolvedValue({
      items: [{ id: "i1", position: 0, code: "1001", description: "IRPJ - SIMPLES NACIONAL", principal: "469.71", fine: "0.00", interest: "0.00" }],
    } as never);
    lista([guia({ itemsCount: 1 })]);
    fireEvent.click(screen.getAllByRole("button", { name: /1 linha/ })[0]);
    expect((await screen.findAllByText("IRPJ - SIMPLES NACIONAL")).length).toBeGreaterThan(0);
  });

  test("guia sem número e sem linhas segue mostrando a descrição", () => {
    lista([guia({ description: "GPS de setembro", itemsCount: 0 })]);
    expect(screen.getAllByText("GPS de setembro").length).toBeGreaterThan(0);
  });
});
