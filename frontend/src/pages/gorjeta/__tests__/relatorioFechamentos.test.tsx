import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipFechamentoDetalhe, TipFechamentoResumo } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipClosings: vi.fn(),
  getTipClosing: vi.fn(),
}));
vi.mock("../gorjetaUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../gorjetaUtils")>()),
  baixarCsv: vi.fn(),
}));

import { getTipClosing, getTipClosings } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { baixarCsv } from "../gorjetaUtils";
import { ApelidosContext } from "../NomePessoa";
import { RelatorioFechamentos } from "../RelatorioFechamentos";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement, apelidos: ReadonlyMap<string, string> = new Map()) => renderRaw(
  <SessionContext.Provider value={SESSAO}>
    <HideValuesProvider><ApelidosContext.Provider value={apelidos}>{ui}</ApelidosContext.Provider></HideValuesProvider>
  </SessionContext.Provider>,
);
// Moeda do pt-BR usa espaço não separável: normaliza para comparar.
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const ANO = new Date().getFullYear();

const resumo = (over: Partial<TipFechamentoResumo>): TipFechamentoResumo => ({
  id: "c1", code: "GOR-2026-0001/v1", version: 1, competenceYear: 2026, competenceMonth: 9,
  periodStart: "2026-08-26T00:00:00.000Z", periodEnd: "2026-09-25T00:00:00.000Z", closedAt: "2026-10-05T15:00:00.000Z", closedByName: "Gestora Teste",
  reopenedAt: null, reopenedByName: null, reopenReason: null, pessoas: 12, liquido: 9240, distribuido: 9000, saldo: 240, valorPonto: 100, integro: true, ...over,
});
const LISTA: TipFechamentoResumo[] = [
  resumo({}),
  resumo({ id: "c2", code: "GOR-2026-0002/v2", version: 2, competenceMonth: 10, pessoas: 8, liquido: 5000, distribuido: 4800, saldo: 200, valorPonto: 80,
    closedByName: "Outro Gestor", reopenedAt: "2026-11-02T10:00:00.000Z", reopenedByName: "Gestora Teste", reopenReason: "erro no serviço" }),
];

const abrirLista = (lista: TipFechamentoResumo[] = LISTA) => {
  vi.mocked(getTipClosings).mockResolvedValue(lista);
  const onErro = vi.fn();
  render(<RelatorioFechamentos onErro={onErro} />);
  return { onErro };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("Relatório de fechamentos: lista", () => {
  test("mostra carregando e depois cada fechamento com competência, quem fechou, valores e situação", async () => {
    abrirLista();
    expect(screen.getByText("Carregando…")).toBeTruthy();
    const linha1 = (await screen.findByText("GOR-2026-0001/v1")).closest("tr")!;
    expect(screen.queryByText("Carregando…")).toBeNull();
    const t1 = txt(linha1);
    expect(t1).toContain("Setembro/2026");
    expect(t1).toContain("05/10/2026");
    expect(t1).toContain("Gestora Teste");
    expect(t1).toContain("12");
    expect(t1).toContain("R$ 9.240,00");
    expect(t1).toContain("R$ 100,00");
    expect(t1).toContain("R$ 9.000,00");
    expect(t1).toContain("R$ 240,00");
    expect(t1).toContain("Vigente");

    const linha2 = screen.getByText("GOR-2026-0002/v2").closest("tr")!;
    expect(txt(linha2)).toContain("Outubro/2026");
    expect(txt(linha2)).toContain("Reaberto 02/11");
    expect(within(linha2).getByText(/Reaberto 02\/11/).getAttribute("title")).toBe("erro no serviço");
  });

  test("busca o ano corrente e, ao escolher outro ano ou \"Todos\", busca de novo (todos = sem ano)", async () => {
    abrirLista();
    await screen.findByText("GOR-2026-0001/v1");
    expect(getTipClosings).toHaveBeenLastCalledWith(ANO);
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: String(ANO - 1) } });
    await waitFor(() => expect(getTipClosings).toHaveBeenLastCalledWith(ANO - 1));
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: "todos" } });
    await waitFor(() => expect(getTipClosings).toHaveBeenLastCalledWith(undefined));
  });

  test("sem fechamentos no ano: estado vazio com o ano e exportação desabilitada", async () => {
    abrirLista([]);
    expect(await screen.findByText(`Nenhum fechamento registrado em ${ANO}.`)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Excel \(CSV\)/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("search")).toBeNull();
  });

  test("sem fechamentos em \"Todos\": o estado vazio não cita ano", async () => {
    abrirLista([]);
    await screen.findByText(/Nenhum fechamento registrado/);
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: "todos" } });
    await waitFor(() => expect(screen.getByText("Nenhum fechamento registrado .")).toBeTruthy());
  });

  test("falha ao carregar: repassa o erro e continua mostrando carregando", async () => {
    vi.mocked(getTipClosings).mockRejectedValue(new Error("falhou"));
    const onErro = vi.fn();
    render(<RelatorioFechamentos onErro={onErro} />);
    await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.objectContaining({ message: "falhou" })));
    expect(screen.getByText("Carregando…")).toBeTruthy();
  });

  test("registro com conteúdo divergente: alerta no topo e selo na linha", async () => {
    abrirLista([resumo({ integro: false }), LISTA[1]]);
    const alerta = await screen.findByRole("alert");
    expect(txt(alerta)).toContain("1 registro(s) com conteúdo diferente do que foi gravado");
    const linha = screen.getByText("GOR-2026-0001/v1").closest("tr")!;
    expect(within(linha).getByText("Conteúdo divergente")).toBeTruthy();
    expect(within(screen.getByText("GOR-2026-0002/v2").closest("tr")!).queryByText("Conteúdo divergente")).toBeNull();
  });

  test("todos íntegros: sem alerta", async () => {
    abrirLista();
    await screen.findByText("GOR-2026-0001/v1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("filtro por texto (quem fechou) e por situação; mostra \"x de y\" e a mensagem de nenhum resultado", async () => {
    abrirLista();
    await screen.findByText("GOR-2026-0001/v1");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "outro gestor" } });
    expect(screen.queryByText("GOR-2026-0001/v1")).toBeNull();
    expect(screen.getByText("GOR-2026-0002/v2")).toBeTruthy();
    expect(txt(document.querySelector(".barra-filtro-contagem"))).toContain("1 de 2");
    expect(screen.getByText(/leva todas as linhas, sem o filtro/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "Vigente" } });
    expect(screen.getByText("GOR-2026-0001/v1")).toBeTruthy();
    expect(screen.queryByText("GOR-2026-0002/v2")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum fechamento bate com o filtro.")).toBeTruthy();
  });

  test("filtro \"Versão\" separa v1 de v2", async () => {
    abrirLista();
    await screen.findByText("GOR-2026-0001/v1");
    fireEvent.change(screen.getByLabelText("Versão"), { target: { value: "v2" } });
    expect(screen.queryByText("GOR-2026-0001/v1")).toBeNull();
    expect(screen.getByText("GOR-2026-0002/v2")).toBeTruthy();
  });

  test("Excel (CSV) chama o gerador com o ano no nome e a tabela inteira, mesmo com filtro ligado", async () => {
    abrirLista();
    await screen.findByText("GOR-2026-0001/v1");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "outro gestor" } });
    fireEvent.click(screen.getByRole("button", { name: /Excel \(CSV\)/ }));
    expect(baixarCsv).toHaveBeenCalledTimes(1);
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toBe(`gorjeta-fechamentos-${ANO}.csv`);
    expect(linhas).toHaveLength(3); // cabeçalho + 2 fechamentos, apesar do filtro
    expect(linhas[0][0]).toBe("Registro");
    const v1 = linhas.find((l) => l[0] === "GOR-2026-0001/v1")!;
    expect(v1[1]).toBe("Setembro/2026");
    expect(v1.slice(4, 8)).toEqual([12, 9240, 100, 9000]);
    expect(v1[12]).toBe("sim");
    const v2 = linhas.find((l) => l[0] === "GOR-2026-0002/v2")!;
    expect(v2[10]).toBe("Gestora Teste");
    expect(v2[11]).toBe("erro no serviço");
  });

  test("com \"Todos\" o arquivo se chama gorjeta-fechamentos-todos.csv; divergente sai como NÃO", async () => {
    abrirLista([resumo({ integro: false })]);
    await screen.findByText("GOR-2026-0001/v1");
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: "todos" } });
    await waitFor(() => expect(getTipClosings).toHaveBeenLastCalledWith(undefined));
    fireEvent.click(await screen.findByRole("button", { name: /Excel \(CSV\)/ }));
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toBe("gorjeta-fechamentos-todos.csv");
    expect(linhas[1][12]).toBe("NÃO");
  });
});

// ─── Detalhe ────────────────────────────────────────────────────────────────
const pessoa = (over: Record<string, unknown>) => ({
  employeeId: "e", nome: "Pessoa", funcao: "Atendente", empresa: "Casa A", semRegistro: false, pontosBase: 5, ajuste: 0,
  fatorPresenca: 1, pontos: 5, valorPonto: 100, gorjeta: 500, descontos: 0, creditos: 0, liquido: 500, salarioProporcional: 0, totalAPagar: 500,
  tipoCalculo: "MES", ...over,
});
const ANA = pessoa({ employeeId: "e1", nome: "Ana Teste", ajuste: 1, pontos: 6, gorjeta: 600, descontos: 50, liquido: 550, totalAPagar: 550, apelido: null });
const BRUNO = pessoa({
  employeeId: "e2", nome: "Bruno Teste", funcao: "Cozinheiro", empresa: "Casa B", semRegistro: true, pontosBase: 4, fatorPresenca: 0.5, pontos: 2,
  gorjeta: 200, creditos: 30, liquido: 230, salarioProporcional: 1000, totalAPagar: 1230, desligamento: "2026-09-10T00:00:00.000Z", tipoCalculo: "RESCISAO",
});

const detalhe = (over: Partial<TipFechamentoDetalhe> = {}): TipFechamentoDetalhe => ({
  id: "c1", code: "GOR-2026-0001/v1", version: 1, competenceYear: 2026, competenceMonth: 9,
  periodStart: "2026-08-26T00:00:00.000Z", periodEnd: "2026-09-25T00:00:00.000Z", closedAt: "2026-10-05T15:00:00.000Z", closedByName: "Gestora Teste",
  reopenedAt: null, reopenedByName: null, reopenReason: null, integro: true, closedById: "u1", payloadHash: "abc123def456",
  params: {
    servicoFaturamento: 10000, ajusteServico: 500, ajusteServicoMotivo: "gorjeta extra", grossPool: 10500, deductionPercent: 10, quebraPercent: 2,
    reservaPontos: 3, destinoSobra: "LIVRE", sobraRescisaoParaSaldo: true,
  },
  totals: {
    netPool: 9240, fixedTotal: 0, rescisoes: { valor: 400, pontos: 2 }, pontosDisponiveis: 30, pointValue: 100, distribuido: 9000, saldo: 240, totalAPagar: 9400,
  },
  participants: [ANA, BRUNO],
  reserve: { lancamentos: [{ type: "FECHAMENTO_RESERVA", amount: 300, notes: null }, { type: "FECHAMENTO_SALDO", amount: 240, notes: null }], saldoDoFundoAposFechar: 1540 },
  ...over,
});

async function abrirDetalhe(d: TipFechamentoDetalhe = detalhe(), apelidos?: ReadonlyMap<string, string>) {
  vi.mocked(getTipClosings).mockResolvedValue([resumo({})]);
  vi.mocked(getTipClosing).mockResolvedValue(d);
  const onErro = vi.fn();
  render(<RelatorioFechamentos onErro={onErro} />, apelidos);
  fireEvent.click((await screen.findByText("GOR-2026-0001/v1")).closest("tr")!);
  await screen.findByText(/Nomes como foram gravados no fechamento/);
  return { onErro };
}
const grade = () => within(document.querySelector("dl.fechamento-grade") as HTMLElement);
const valorDe = (rotulo: string) => txt(grade().getByText(rotulo).closest("div")!.querySelector("dd"));
const linhaTotal = () => Array.from(document.querySelectorAll("tbody td")).find((td) => /^Total( do filtro.*)?$/.test(txt(td)))!.closest("tr")!;

describe("Relatório de fechamentos: detalhe do registro", () => {
  test("clicar na linha abre o retrato (busca pelo id) e Fechamentos volta para a lista", async () => {
    await abrirDetalhe();
    expect(getTipClosing).toHaveBeenCalledWith("c1");
    expect(screen.getByText("Setembro/2026")).toBeTruthy();
    expect(screen.getByText("Íntegro")).toBeTruthy();
    expect(screen.getByText(/Fechado em 05\/10\/2026.* por Gestora Teste\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fechamentos/ }));
    expect(await screen.findByText("Fechamentos registrados")).toBeTruthy();
  });

  test("enquanto carrega o registro mostra o aviso de carregando", async () => {
    vi.mocked(getTipClosings).mockResolvedValue([resumo({})]);
    vi.mocked(getTipClosing).mockReturnValue(new Promise(() => undefined));
    render(<RelatorioFechamentos onErro={vi.fn()} />);
    fireEvent.click((await screen.findByText("GOR-2026-0001/v1")).closest("tr")!);
    expect(await screen.findByText("Carregando o registro…")).toBeTruthy();
  });

  test("falha ao abrir o registro repassa o erro", async () => {
    vi.mocked(getTipClosings).mockResolvedValue([resumo({})]);
    vi.mocked(getTipClosing).mockRejectedValue(new Error("sumiu"));
    const onErro = vi.fn();
    render(<RelatorioFechamentos onErro={onErro} />);
    fireEvent.click((await screen.findByText("GOR-2026-0001/v1")).closest("tr")!);
    await waitFor(() => expect(onErro).toHaveBeenCalledWith(expect.objectContaining({ message: "sumiu" })));
    expect(screen.getByText("Carregando o registro…")).toBeTruthy();
  });

  test("parâmetros e totais do fechamento aparecem na grade", async () => {
    await abrirDetalhe();
    expect(valorDe("Serviço (faturamento)")).toBe("R$ 10.000,00");
    expect(valorDe("Ajuste do serviço")).toBe("R$ 500,00 — gorjeta extra");
    expect(valorDe("Serviço bruto")).toBe("R$ 10.500,00");
    expect(valorDe("Retenção")).toBe("10%");
    expect(valorDe("Quebra")).toBe("2%");
    expect(valorDe("Líquido")).toBe("R$ 9.240,00");
    expect(valorDe("Rescisões")).toBe("R$ 400,00 (2 pts)");
    expect(valorDe("Parte de quem saiu")).toBe("Foi para o livre");
    expect(valorDe("Pontos disponíveis")).toBe("30");
    expect(valorDe("Valor do ponto")).toBe("R$ 100,00");
    expect(valorDe("Pontos da reserva")).toBe("3");
    expect(valorDe("Distribuído")).toBe("R$ 9.000,00");
    expect(valorDe("Saldo não distribuído")).toBe("R$ 240,00");
    expect(valorDe("Destino da sobra")).toBe("Livre no período (não foi ao fundo)");
    expect(valorDe("Total a pagar")).toBe("R$ 9.400,00");
  });

  test("sem ajuste, sem quebra e sem rescisão: essas linhas não aparecem e o destino padrão é o fundo", async () => {
    await abrirDetalhe(detalhe({
      params: { servicoFaturamento: 1000, ajusteServico: 0, grossPool: 1000, deductionPercent: 10, quebraPercent: 0, reservaPontos: 0 },
      totals: { netPool: 900, fixedTotal: 0, pontosDisponiveis: 9, pointValue: 100, distribuido: 900, saldo: 0, totalAPagar: 900 },
    }));
    expect(grade().queryByText("Ajuste do serviço")).toBeNull();
    expect(grade().queryByText("Quebra")).toBeNull();
    expect(grade().queryByText("Parte de quem saiu")).toBeNull();
    expect(valorDe("Rescisões")).toBe("—");
    expect(valorDe("Destino da sobra")).toBe("Fundo de reserva");
  });

  test("parte de quem saiu sem o campo (retrato antigo) = ficou com quem continua; REDISTRIBUIR tem texto próprio", async () => {
    await abrirDetalhe(detalhe({
      params: { servicoFaturamento: 1000, grossPool: 1000, deductionPercent: 10, destinoSobra: "REDISTRIBUIR" },
    }));
    expect(valorDe("Parte de quem saiu")).toBe("Ficou com quem continua");
    expect(valorDe("Destino da sobra")).toBe("Redistribuída entre quem participa");
  });

  test("tabela de pessoas: valores por pessoa, ajuste de pontos, presença, vales, selos e linha de total", async () => {
    await abrirDetalhe();
    expect(screen.getByText("Pessoas (2)")).toBeTruthy();
    const ana = txt(screen.getByText("Ana Teste").closest("tr"));
    expect(ana).toContain("Atendente");
    expect(ana).toContain("Casa A");
    expect(ana).toContain("5+1"); // base ± ajuste
    expect(ana).toContain("100%");
    expect(ana).toContain("R$ 600,00");
    expect(ana).toContain("-R$ 50,00"); // desconto de vale
    expect(ana).toContain("R$ 550,00");

    const bruno = screen.getByText("Bruno Teste").closest("tr")!;
    expect(within(bruno).getByText("Sem registro")).toBeTruthy();
    expect(within(bruno).getByText("Saída 10/09")).toBeTruthy();
    expect(txt(bruno)).toContain("50%");
    expect(txt(bruno)).toContain("R$ 30,00"); // crédito
    expect(txt(bruno)).toContain("R$ 1.230,00");

    const total = txt(linhaTotal());
    expect(total).toContain("R$ 800,00"); // gorjeta
    expect(total).toContain("R$ 780,00"); // líquido
    expect(total).toContain("R$ 1.000,00"); // salário
    expect(total).toContain("R$ 1.780,00"); // total a pagar
    expect(total).toContain("-R$ 20,00"); // vales: 50 de desconto - 30 de crédito
  });

  test("coluna Salário só existe quando alguém tem salário no retrato", async () => {
    await abrirDetalhe(detalhe({ participants: [ANA] }));
    expect(screen.queryByText("Salário")).toBeNull();
    expect(txt(linhaTotal())).not.toContain("R$ 1.000,00");
  });

  test("retrato antigo (sem a chave apelido) usa o apelido do cadastro; apelido gravado como vazio vale", async () => {
    // Bruno não tem a chave "apelido": vale o do cadastro. Ana tem apelido: null gravado: não usa o do cadastro.
    await abrirDetalhe(detalhe(), new Map([["e1", "Aninha"], ["e2", "Brunão"]]));
    expect(screen.getByText("“Brunão”")).toBeTruthy();
    expect(screen.queryByText("“Aninha”")).toBeNull();
  });

  test("filtro de pessoas recalcula o total e mostra \"Total do filtro\"; sem resultado avisa", async () => {
    await abrirDetalhe();
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "cozinheiro" } });
    expect(screen.queryByText("Ana Teste")).toBeNull();
    expect(screen.getByText("Total do filtro (1 de 2)")).toBeTruthy();
    expect(txt(linhaTotal())).toContain("R$ 230,00");
    expect(txt(linhaTotal())).not.toContain("R$ 780,00");

    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "ninguem" } });
    expect(screen.getByText("Ninguém bate com o filtro.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Vínculo"), { target: { value: "Sem registro" } });
    expect(screen.queryByText("Ana Teste")).toBeNull();
    expect(screen.getByText("Bruno Teste")).toBeTruthy();
  });

  test("reaberto: mostra quem reabriu e o motivo", async () => {
    await abrirDetalhe(detalhe({ reopenedAt: "2026-11-02T10:00:00.000Z", reopenedByName: "Gestora Teste", reopenReason: "erro no serviço" }));
    const faixa = document.querySelector(".fechamento-reaberto")!;
    expect(txt(faixa)).toContain("Reaberto em 02/11/2026");
    expect(txt(faixa)).toContain("por Gestora Teste");
    expect(txt(faixa)).toContain("Motivo: erro no serviço");
  });

  test("conteúdo divergente: selo de alerta no cabeçalho", async () => {
    await abrirDetalhe(detalhe({ integro: false }));
    expect(screen.getByText("Conteúdo divergente")).toBeTruthy();
    expect(screen.queryByText("Íntegro")).toBeNull();
  });

  test("fundo de reserva: lançamentos, saldo após fechar e a assinatura SHA-256", async () => {
    await abrirDetalhe();
    const caixa = screen.getByText("Fundo de reserva neste fechamento").closest("div")!;
    const itens = within(caixa).getAllByRole("listitem").map((li) => txt(li.querySelector("span")) + "|" + txt(li.querySelector("strong")));
    expect(itens).toEqual(["Pontos da reserva|R$ 300,00", "Saldo não distribuído|R$ 240,00"]);
    expect(txt(caixa)).toContain("Saldo do fundo logo após o fechamento: R$ 1.540,00");
    expect(within(caixa).getByText("abc123def456")).toBeTruthy();
  });

  test("sem lançamentos no fundo: avisa que nada foi lançado", async () => {
    await abrirDetalhe(detalhe({ reserve: { saldoDoFundoAposFechar: 0 } }));
    expect(screen.getByText("Nada foi lançado no fundo.")).toBeTruthy();
  });

  test("Excel (CSV) do retrato: nome com o código, cabeçalho do registro e todas as pessoas, mesmo com filtro", async () => {
    await abrirDetalhe();
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "cozinheiro" } });
    fireEvent.click(screen.getByRole("button", { name: /Excel \(CSV\)/ }));
    expect(baixarCsv).toHaveBeenCalledTimes(1);
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toBe("gorjeta-GOR-2026-0001-v1.csv");
    expect(linhas[0]).toEqual(["Registro", "GOR-2026-0001/v1"]);
    expect(linhas[1]).toEqual(["Competência", "Setembro/2026"]);
    expect(linhas[3]).toEqual(["Fechado por", "Gestora Teste"]);
    expect(linhas[4]).toEqual(["SHA-256", "abc123def456"]);
    const pessoas = linhas.slice(7);
    expect(pessoas).toHaveLength(2);
    expect(pessoas[0].slice(0, 5)).toEqual(["Ana Teste", "Atendente", "Casa A", "não", 5]);
    expect(pessoas[1][3]).toBe("sim");
    expect(pessoas[1][14]).toBe(1230);
  });
});
