import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  TipComputation, TipEvolucao, TipFuncaoHistorico, TipMudanca, TipReservaMovimento,
} from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipClosings: vi.fn(),
  getTipClosing: vi.fn(),
  getTipRelatorioVales: vi.fn(),
  getTipChanges: vi.fn(),
  getTipEvolution: vi.fn(),
  getTipFunctionHistory: vi.fn(),
  getTipReserve: vi.fn(),
  addTipReserveAdjustment: vi.fn(),
  deleteTipReserveAdjustment: vi.fn(),
  distributeTipReserve: vi.fn(),
}));
vi.mock("../gorjetaUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../gorjetaUtils")>()),
  baixarCsv: vi.fn(),
}));

import {
  addTipReserveAdjustment, deleteTipReserveAdjustment, distributeTipReserve, getTipChanges, getTipClosings, getTipEvolution,
  getTipFunctionHistory, getTipRelatorioVales, getTipReserve,
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaRelatorios } from "../AbaRelatorios";
import { baixarCsv, hojeLocal, mesLocal } from "../gorjetaUtils";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>,
);
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const ANO = new Date().getFullYear();

const COMP = {
  year: 2026, month: 9, periodId: "p1", status: "OPEN", reservaPontos: 3, reservaTotal: 300, saldo: 240, saldoAoFundo: 240,
  participants: [
    { employeeId: "e1", employeeName: "Ana Teste", apelido: "Aninha", tipoCalculo: "MES", foraDaGorjeta: false },
    { employeeId: "e2", employeeName: "Bruno Teste", apelido: null, tipoCalculo: "MES", foraDaGorjeta: false },
    { employeeId: "e3", employeeName: "Carla Fora", apelido: null, tipoCalculo: "FORA_DO_PERIODO", foraDaGorjeta: false },
    { employeeId: "e4", employeeName: "Davi Salario", apelido: null, tipoCalculo: "MES", foraDaGorjeta: true },
  ],
} as unknown as TipComputation;
const COMP_FECHADA = { ...COMP, status: "CLOSED" } as unknown as TipComputation;

type Props = { comp?: TipComputation | null; canEdit?: boolean };
const abrir = ({ comp = COMP, canEdit = true }: Props = {}) => {
  const onNotice = vi.fn();
  const onChanged = vi.fn();
  render(<AbaRelatorios comp={comp} canEdit={canEdit} onNotice={onNotice} onChanged={onChanged} />);
  return { onNotice, onChanged };
};
const ir = (rotulo: string) => fireEvent.click(screen.getByRole("button", { name: rotulo }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  vi.mocked(getTipClosings).mockResolvedValue([]);
  vi.mocked(getTipRelatorioVales).mockReturnValue(new Promise(() => undefined));
  vi.mocked(getTipChanges).mockResolvedValue([]);
  vi.mocked(getTipEvolution).mockResolvedValue({ competencias: [], linhas: [] });
  vi.mocked(getTipFunctionHistory).mockResolvedValue([]);
  vi.mocked(getTipReserve).mockResolvedValue({ saldo: 0, movimentos: [] });
});

describe("Aba Relatórios: navegação", () => {
  test("abre em Fechamentos e cada botão carrega o relatório certo, marcando o botão ativo", async () => {
    abrir();
    expect(screen.getByRole("button", { name: "Fechamentos" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(getTipClosings).toHaveBeenCalled());
    expect(getTipChanges).not.toHaveBeenCalled();

    ir("Vales por período");
    expect(screen.getByRole("button", { name: "Vales por período" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Fechamentos" }).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(getTipRelatorioVales).toHaveBeenCalled());
    expect(screen.queryByText("Fechamentos registrados")).toBeNull();

    ir("Mudanças de função e pontos");
    await waitFor(() => expect(getTipChanges).toHaveBeenCalled());
    ir("Evolução mês a mês");
    await waitFor(() => expect(getTipEvolution).toHaveBeenCalled());
    ir("Fundo de reserva");
    await waitFor(() => expect(getTipReserve).toHaveBeenCalled());
    ir("Histórico das funções");
    await waitFor(() => expect(getTipFunctionHistory).toHaveBeenCalled());
  });

  test("erro de um relatório vira aviso de erro na tela raiz", async () => {
    vi.mocked(getTipClosings).mockRejectedValue(new Error("sem permissão"));
    const { onNotice } = abrir();
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "sem permissão"));
  });
});

// ─── Mudanças ───────────────────────────────────────────────────────────────
const mud = (over: Partial<TipMudanca>): TipMudanca => ({
  id: "m", employeeId: "e", employeeName: "Pessoa", validFrom: "2026-03-01T00:00:00.000Z", tipo: "PROMOCAO", funcaoAntes: null, funcaoDepois: "Atendente",
  baseAntes: 4, baseDepois: 5, diferenca: 1, participa: true, motivo: null, registradoEm: "2026-03-02T00:00:00.000Z", apelido: null, ...over,
});
const MUDANCAS: TipMudanca[] = [
  mud({ id: "m1", employeeId: "e1", employeeName: "Ana Teste", funcaoAntes: "Auxiliar", motivo: "mérito" }),
  mud({ id: "m2", employeeId: "e2", employeeName: "Bruno Teste", tipo: "REDUCAO", funcaoDepois: "Cozinheiro", baseAntes: 6, baseDepois: 4, diferenca: -2, validFrom: "2026-04-10T00:00:00.000Z" }),
  mud({ id: "m3", employeeId: "e3", employeeName: "Carla Inicial", tipo: "INICIAL", funcaoDepois: "Caixa", baseAntes: null, baseDepois: 3, diferenca: null }),
  mud({ id: "m4", employeeId: "e4", employeeName: "Davi Saiu", tipo: "SAIDA", funcaoDepois: "Atendente", participa: false, baseAntes: 5, baseDepois: 0, diferenca: -5 }),
];

async function abrirMudancas(lista: TipMudanca[] = MUDANCAS) {
  vi.mocked(getTipChanges).mockResolvedValue(lista);
  const r = abrir();
  ir("Mudanças de função e pontos");
  await waitFor(() => expect(getTipChanges).toHaveBeenCalled());
  return r;
}

describe("Aba Relatórios: mudanças de função e pontos", () => {
  test("busca de 1º de janeiro até hoje e mostra as mudanças com função, pontos e diferença", async () => {
    await abrirMudancas();
    expect(getTipChanges).toHaveBeenCalledWith(`${ANO}-01-01`, hojeLocal());
    const ana = (await screen.findByText("Ana Teste")).closest("tr")!;
    const t = txt(ana);
    expect(t).toContain("01/03/2026");
    expect(t).toContain("Promoção");
    expect(t).toContain("Auxiliar → Atendente");
    expect(t).toContain("+1");
    expect(t).toContain("mérito");
    const bruno = txt(screen.getByText("Bruno Teste").closest("tr"));
    expect(bruno).toContain("Redução");
    expect(bruno).toContain("−2");
  });

  test("situação inicial fica escondida até marcar \"Mostrar situação inicial\"", async () => {
    await abrirMudancas();
    await screen.findByText("Ana Teste");
    expect(screen.queryByText("Carla Inicial")).toBeNull();
    fireEvent.click(screen.getByLabelText("Mostrar situação inicial"));
    expect(screen.getByText("Carla Inicial")).toBeTruthy();
  });

  test("chips contam promoções, reduções, trocas, entradas e saídas", async () => {
    await abrirMudancas();
    await screen.findByText("Ana Teste");
    expect(screen.getByText("1 promoções")).toBeTruthy();
    expect(screen.getByText("1 reduções")).toBeTruthy();
    expect(screen.getByText("0 trocas de função")).toBeTruthy();
    expect(screen.getByText("0 entradas · 1 saídas")).toBeTruthy();
  });

  test("seletor de tipo filtra as linhas mas as contagens continuam detalhando todos os tipos", async () => {
    await abrirMudancas();
    await screen.findByText("Ana Teste");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "REDUCAO" } });
    expect(screen.queryByText("Ana Teste")).toBeNull();
    expect(screen.getByText("Bruno Teste")).toBeTruthy();
    expect(screen.getByText("1 promoções")).toBeTruthy();
  });

  test("filtro de texto e de \"Participa\"; as contagens acompanham o filtro", async () => {
    await abrirMudancas();
    await screen.findByText("Ana Teste");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "cozinheiro" } });
    expect(screen.queryByText("Ana Teste")).toBeNull();
    expect(screen.getByText("Total do filtro (1 de 3)")).toBeTruthy();
    expect(screen.getByText("0 promoções")).toBeTruthy();
    expect(screen.getByText("1 reduções")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Participa"), { target: { value: "Não" } });
    expect(screen.getByText("Davi Saiu")).toBeTruthy();
    expect(screen.queryByText("Bruno Teste")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "xyz" } });
    expect(screen.getByText("Nenhuma mudança bate com o filtro.")).toBeTruthy();
  });

  test("sem mudanças no período: mensagem de vazio e exportação desabilitada", async () => {
    await abrirMudancas([]);
    expect(await screen.findByText("Nenhuma mudança no período escolhido.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Excel \(CSV\)/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("mudar a data \"De\" busca de novo com o novo intervalo", async () => {
    await abrirMudancas();
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-02-01" } });
    await waitFor(() => expect(getTipChanges).toHaveBeenLastCalledWith("2026-02-01", hojeLocal()));
  });

  test("Excel (CSV) leva as linhas visíveis (sem a situação inicial), ignora o filtro de texto e nomeia com o período", async () => {
    await abrirMudancas();
    await screen.findByText("Ana Teste");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "cozinheiro" } });
    fireEvent.click(screen.getByRole("button", { name: /Excel \(CSV\)/ }));
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toBe(`gorjeta-mudancas-${ANO}-01-01-a-${hojeLocal()}.csv`);
    expect(linhas[0][0]).toBe("Vigência");
    expect(linhas).toHaveLength(4); // cabeçalho + Ana, Bruno, Davi (sem a situação inicial)
    expect(linhas.map((l) => l[1])).not.toContain("Carla Inicial");
    const ana = linhas.find((l) => l[1] === "Ana Teste")!;
    expect(ana).toEqual(["01/03/2026", "Ana Teste", "Promoção", "Auxiliar", "Atendente", 4, 5, 1, "mérito"]);
  });

  test("falha ao carregar repassa o aviso de erro", async () => {
    vi.mocked(getTipChanges).mockRejectedValue(new Error("queda"));
    const { onNotice } = abrir();
    ir("Mudanças de função e pontos");
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "queda"));
  });
});

// ─── Evolução ───────────────────────────────────────────────────────────────
const EVOLUCAO: TipEvolucao = {
  competencias: [{ ano: 2026, mes: 8, status: "CLOSED", pointValue: 100 }, { ano: 2026, mes: 9, status: "OPEN", pointValue: 0 }],
  linhas: [
    { employeeId: "e1", employeeName: "Ana Teste", apelido: null, meses: {
      "2026-08": { funcao: "Atendente", base: 5, pontos: 5, gorjeta: 500 },
      "2026-09": { funcao: "Atendente", base: 6, pontos: null, gorjeta: null },
    } },
    { employeeId: "e2", employeeName: "Bruno Teste", apelido: null, meses: {
      "2026-08": { funcao: "Cozinheiro", base: 4, pontos: 4, gorjeta: 400 },
      "2026-09": { funcao: "Chefe de cozinha", base: 4, pontos: null, gorjeta: null },
    } },
  ],
};

async function abrirEvolucao(dados: TipEvolucao = EVOLUCAO) {
  vi.mocked(getTipEvolution).mockResolvedValue(dados);
  const r = abrir();
  ir("Evolução mês a mês");
  await waitFor(() => expect(getTipEvolution).toHaveBeenCalled());
  return r;
}
const linhaDe = (nome: string) => screen.getByText(nome).closest("tr")!;
const celulas = (tr: HTMLElement) => within(tr).getAllByRole("cell").map((c) => txt(c));

describe("Aba Relatórios: evolução mês a mês", () => {
  test("busca os últimos 12 meses e mostra uma coluna por competência, marcando a que está em apuração", async () => {
    await abrirEvolucao();
    expect(getTipEvolution).toHaveBeenCalledWith(mesLocal(11), mesLocal(0));
    await screen.findByText("Ana Teste");
    expect(screen.getByText("Ago/26")).toBeTruthy();
    expect(screen.getByText("Set/26 •")).toBeTruthy();
  });

  test("em Pontos mostra os pontos do mês fechado e a base (itálico) enquanto está em apuração", async () => {
    await abrirEvolucao();
    await screen.findByText("Ana Teste");
    expect(celulas(linhaDe("Ana Teste")).slice(1)).toEqual(["5", "6"]);
    const setembro = within(linhaDe("Ana Teste")).getAllByRole("cell")[2];
    expect(setembro.style.fontStyle).toBe("italic");
    expect(within(linhaDe("Ana Teste")).getAllByRole("cell")[1].style.fontStyle).not.toBe("italic");
  });

  test("em Gorjeta R$ mostra valores, \"—\" sem valor e a linha de total por mês", async () => {
    await abrirEvolucao();
    await screen.findByText("Ana Teste");
    fireEvent.click(screen.getByRole("button", { name: "Gorjeta R$" }));
    expect(celulas(linhaDe("Ana Teste")).slice(1)).toEqual(["R$ 500,00", "—"]);
    const total = Array.from(document.querySelectorAll("tbody td")).find((td) => txt(td) === "Total")!.closest("tr")!;
    expect(celulas(total as HTMLElement).slice(1)).toEqual(["R$ 900,00", "R$ 0,00"]);
  });

  test("em Função mostra a função de cada mês e destaca em negrito a troca", async () => {
    await abrirEvolucao();
    await screen.findByText("Ana Teste");
    fireEvent.click(screen.getByRole("button", { name: "Função" }));
    const bruno = within(linhaDe("Bruno Teste")).getAllByRole("cell");
    expect(txt(bruno[1])).toBe("Cozinheiro");
    expect(txt(bruno[2])).toBe("Chefe de cozinha");
    expect(bruno[2].style.fontWeight).toBe("700");
    expect(within(linhaDe("Ana Teste")).getAllByRole("cell")[2].style.fontWeight).toBe("400");
    expect(Array.from(document.querySelectorAll("tbody td")).some((td) => txt(td) === "Total")).toBe(false);
  });

  test("filtro de texto reduz as linhas e o total de gorjeta soma só o que sobrou", async () => {
    await abrirEvolucao();
    await screen.findByText("Ana Teste");
    fireEvent.click(screen.getByRole("button", { name: "Gorjeta R$" }));
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "chefe" } });
    expect(screen.queryByText("Ana Teste")).toBeNull();
    expect(screen.getByText("Total do filtro (1 de 2)")).toBeTruthy();
    const total = screen.getByText("Total do filtro (1 de 2)").closest("tr")!;
    expect(celulas(total as HTMLElement)[1]).toBe("R$ 400,00");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "nada" } });
    expect(screen.getByText("Ninguém bate com o filtro.")).toBeTruthy();
  });

  test("sem competências no intervalo: mensagem de vazio e exportação desabilitada", async () => {
    await abrirEvolucao({ competencias: [], linhas: [] });
    expect(await screen.findByText("Nenhuma competência no intervalo.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Excel \(CSV\)/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("mudar o mês inicial busca de novo", async () => {
    await abrirEvolucao();
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-01" } });
    await waitFor(() => expect(getTipEvolution).toHaveBeenLastCalledWith("2026-01", mesLocal(0)));
  });

  test("Excel (CSV) depende da medida escolhida e leva todas as pessoas", async () => {
    await abrirEvolucao();
    await screen.findByText("Ana Teste");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "ana" } });
    fireEvent.click(screen.getByRole("button", { name: /Excel \(CSV\)/ }));
    let [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toBe(`gorjeta-evolucao-pontos-${mesLocal(11)}-a-${mesLocal(0)}.csv`);
    expect(linhas[0]).toEqual(["Funcionário", "Ago/2026", "Set/2026"]);
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toEqual(["Ana Teste", 5, 6]);

    fireEvent.click(screen.getByRole("button", { name: "Gorjeta R$" }));
    fireEvent.click(screen.getByRole("button", { name: /Excel \(CSV\)/ }));
    [nome, linhas] = vi.mocked(baixarCsv).mock.calls[1];
    expect(nome).toContain("gorjeta-evolucao-gorjeta-");
    expect(linhas[1]).toEqual(["Ana Teste", 500, null]);

    fireEvent.click(screen.getByRole("button", { name: "Função" }));
    fireEvent.click(screen.getByRole("button", { name: /Excel \(CSV\)/ }));
    linhas = vi.mocked(baixarCsv).mock.calls[2][1];
    expect(linhas[2]).toEqual(["Bruno Teste", "Cozinheiro", "Chefe de cozinha"]);
  });
});

// ─── Fundo de reserva ───────────────────────────────────────────────────────
const mov = (over: Partial<TipReservaMovimento>): TipReservaMovimento => ({
  id: "x", date: "2026-09-25T00:00:00.000Z", type: "FECHAMENTO_RESERVA", amount: 300, saldo: 300, competencia: "09/2026",
  employeeName: null, notes: null, removivel: false, employeeId: null, apelido: null, ...over,
});
const MOVIMENTOS: TipReservaMovimento[] = [
  mov({ id: "mv1" }),
  mov({ id: "mv2", type: "AJUSTE", date: "2026-10-01T00:00:00.000Z", amount: -50, saldo: 250, competencia: null, notes: "retirada para o salão", removivel: true }),
  mov({ id: "mv3", type: "DISTRIBUICAO", date: "2026-10-15T00:00:00.000Z", amount: -100, saldo: 150, competencia: "10/2026", employeeName: "Ana Teste", employeeId: "e1", apelido: "Aninha" }),
];

async function abrirReserva(p: Props = {}, saldo = 150, movimentos = MOVIMENTOS) {
  vi.mocked(getTipReserve).mockResolvedValue({ saldo, movimentos });
  const r = abrir(p);
  ir("Fundo de reserva");
  await screen.findByText("Extrato");
  await waitFor(() => expect(getTipReserve).toHaveBeenCalled());
  return r;
}

describe("Aba Relatórios: fundo de reserva", () => {
  test("mostra o saldo, a reserva do período e o extrato com valores e saldo corrido", async () => {
    await abrirReserva();
    const saldo = (await screen.findByText("Saldo do fundo de reserva")).parentElement!;
    await waitFor(() => expect(txt(saldo)).toContain("R$ 150,00"));
    const resumo = screen.getByText(/reserva de 3 pts/).closest("div")!;
    expect(txt(resumo)).toContain("Setembro/2026: reserva de 3 pts = R$ 300,00");
    expect(txt(resumo)).toContain("+ saldo de R$ 240,00");
    expect(txt(resumo)).toContain("entra no fundo ao fechar");

    const aj = txt(screen.getByText("retirada para o salão").closest("tr"));
    expect(aj).toContain("01/10/2026");
    expect(aj).toContain("Ajuste");
    expect(aj).toMatch(/[-–−]\s?R\$\s?50,00/);
    expect(aj).toMatch(/R\$\s?250,00/);
    const dist = txt(screen.getByText("Ana Teste", { selector: ".nome-pessoa-nome" }).closest("tr"));
    expect(dist).toContain("Distribuição");
    expect(dist).toContain("10/2026");
    expect(dist).toMatch(/[-–−]\s?R\$\s?100,00/);
  });

  test("período fechado: o resumo diz que a reserva já está no fundo", async () => {
    await abrirReserva({ comp: COMP_FECHADA });
    expect(txt(screen.getByText(/reserva de 3 pts/).closest("div"))).toContain("(já no fundo)");
  });

  test("saldo negativo aparece em vermelho; sem lançamentos mostra o aviso do extrato", async () => {
    await abrirReserva({}, -20, []);
    expect(await screen.findByText(/Sem lançamentos ainda/)).toBeTruthy();
    const valor = screen.getByText("Saldo do fundo de reserva").nextElementSibling as HTMLElement;
    await waitFor(() => expect(txt(valor)).toContain("-R$ 20,00"));
    expect(valor.style.color).toBe("var(--danger)");
  });

  test("filtro do extrato soma o valor do que está filtrado, sem mexer na coluna de saldo", async () => {
    await abrirReserva();
    await screen.findByText("retirada para o salão");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "aninha" } });
    expect(screen.queryByText("retirada para o salão")).toBeNull();
    expect(txt(screen.getByText(/Total do filtro \(1 de 3\)/).closest("span"))).toContain("-R$ 100,00");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "nada" } });
    expect(screen.getByText("Nenhum lançamento bate com o filtro.")).toBeTruthy();
  });

  test("falha ao carregar o fundo repassa o erro", async () => {
    vi.mocked(getTipReserve).mockRejectedValue(new Error("fundo indisponível"));
    const { onNotice } = abrir();
    ir("Fundo de reserva");
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "fundo indisponível"));
  });

  describe("ajuste manual", () => {
    test("Lançar só habilita com valor e descrição; envia o valor negativo, a descrição e a data; limpa e recarrega", async () => {
      const { onNotice } = await abrirReserva();
      const lancar = screen.getByRole("button", { name: "Lançar" }) as HTMLButtonElement;
      expect(lancar.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Valor do ajuste"), { target: { value: "-50.5" } });
      expect(lancar.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Descrição do ajuste"), { target: { value: "  correção  " } });
      fireEvent.change(screen.getByLabelText("Data do ajuste"), { target: { value: "2026-10-20" } });
      expect(lancar.disabled).toBe(false);
      vi.mocked(addTipReserveAdjustment).mockResolvedValue({ ok: true });
      fireEvent.click(lancar);
      await waitFor(() => expect(addTipReserveAdjustment).toHaveBeenCalledTimes(1));
      expect(addTipReserveAdjustment).toHaveBeenCalledWith({ amount: -50.5, notes: "  correção  ", date: "2026-10-20" });
      await waitFor(() => expect(onNotice).toHaveBeenCalledWith("success", "Ajuste lançado no fundo."));
      expect(getTipReserve).toHaveBeenCalledTimes(2);
      expect((screen.getByLabelText("Valor do ajuste") as HTMLInputElement).value).toBe("");
      expect((screen.getByLabelText("Data do ajuste") as HTMLInputElement).value).toBe(hojeLocal());
    });

    test("valor zero não é enviado: avisa que precisa informar o valor", async () => {
      const { onNotice } = await abrirReserva();
      fireEvent.change(screen.getByLabelText("Valor do ajuste"), { target: { value: "0" } });
      fireEvent.change(screen.getByLabelText("Descrição do ajuste"), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
      expect(onNotice).toHaveBeenCalledWith("warning", expect.stringContaining("Informe o valor do ajuste"));
      expect(addTipReserveAdjustment).not.toHaveBeenCalled();
    });

    test("erro do servidor ao lançar avisa e mantém o formulário preenchido", async () => {
      const { onNotice } = await abrirReserva();
      vi.mocked(addTipReserveAdjustment).mockRejectedValue(new Error("recusado"));
      fireEvent.change(screen.getByLabelText("Valor do ajuste"), { target: { value: "10" } });
      fireEvent.change(screen.getByLabelText("Descrição do ajuste"), { target: { value: "saldo" } });
      fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
      await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "recusado"));
      expect((screen.getByLabelText("Valor do ajuste") as HTMLInputElement).value).toBe("10");
    });

    test("sem permissão de editar: sem formulário de ajuste e sem botão de apagar", async () => {
      await abrirReserva({ canEdit: false });
      await screen.findByText("retirada para o salão");
      expect(screen.queryByLabelText("Valor do ajuste")).toBeNull();
      expect(screen.queryByRole("button", { name: "Apagar ajuste" })).toBeNull();
    });

    test("só ajustes removíveis têm o botão de apagar; apagar pede confirmação e chama a exclusão", async () => {
      await abrirReserva();
      await screen.findByText("retirada para o salão");
      const botoes = screen.getAllByRole("button", { name: "Apagar ajuste" });
      expect(botoes).toHaveLength(1);
      expect(botoes[0].closest("tr")!.textContent).toContain("retirada para o salão");

      vi.mocked(deleteTipReserveAdjustment).mockResolvedValue({ ok: true });
      fireEvent.click(botoes[0]);
      const caixa = await screen.findByRole("alertdialog");
      expect(within(caixa).getByText("Apagar este ajuste do fundo?")).toBeTruthy();
      fireEvent.click(within(caixa).getByRole("button", { name: "Voltar" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(deleteTipReserveAdjustment).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Apagar ajuste" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Apagar ajuste" }));
      await waitFor(() => expect(deleteTipReserveAdjustment).toHaveBeenCalledWith("mv2"));
      await waitFor(() => expect(getTipReserve).toHaveBeenCalledTimes(2));
    });
  });

  describe("distribuição da reserva", () => {
    const escolher = (linha: number, id: string, valor: string, descricao = "") => {
      const select = screen.getByLabelText(`Funcionário da linha ${linha}`);
      fireEvent.change(select, { target: { value: id } });
      const barra = select.closest(".barra-lista") as HTMLElement;
      fireEvent.change(within(barra).getByPlaceholderText("Valor R$"), { target: { value: valor } });
      if (descricao) fireEvent.change(within(barra).getByPlaceholderText("Descrição (opcional)"), { target: { value: descricao } });
    };

    test("período fechado ou ausente: não deixa distribuir e explica por quê", async () => {
      await abrirReserva({ comp: COMP_FECHADA });
      expect(screen.getByText(/Abra \(ou reabra\) a competência na Apuração/)).toBeTruthy();
      expect(screen.queryByLabelText("Funcionário da linha 1")).toBeNull();
    });

    test("sem permissão de editar não distribui, mesmo com período aberto", async () => {
      await abrirReserva({ canEdit: false });
      expect(screen.getByText(/Abra \(ou reabra\) a competência/)).toBeTruthy();
    });

    test("a lista de funcionários só tem quem participa da gorjeta (sem fora do período e sem só-salário)", async () => {
      await abrirReserva();
      const select = screen.getByLabelText("Funcionário da linha 1");
      const opcoes = within(select).getAllByRole("option").map((o) => o.textContent);
      expect(opcoes).toEqual(["Funcionário…", "Ana Teste (Aninha)", "Bruno Teste"]);
    });

    test("distribuir confirma o total, envia as linhas válidas e avisa o sucesso", async () => {
      const { onNotice, onChanged } = await abrirReserva();
      vi.mocked(distributeTipReserve).mockResolvedValue({ total: 150, saldoDepois: 0 });
      escolher(1, "e1", "100", "bônus");
      fireEvent.click(screen.getByRole("button", { name: /Mais uma pessoa/ }));
      escolher(2, "e2", "50");
      expect(txt(screen.getByText(/^Total:/))).toContain("R$ 150,00 de R$ 150,00");

      fireEvent.click(screen.getByRole("button", { name: "Distribuir" }));
      const caixa = await screen.findByRole("alertdialog");
      expect(txt(caixa)).toMatch(/Distribuir R\$ 150,00 do fundo\?/);
      expect(txt(caixa)).toContain("Setembro/2026 de 2 pessoa(s)");
      fireEvent.click(within(caixa).getByRole("button", { name: "Distribuir" }));

      await waitFor(() => expect(distributeTipReserve).toHaveBeenCalledTimes(1));
      expect(distributeTipReserve).toHaveBeenCalledWith("p1", [
        { employeeId: "e1", amount: 100, notes: "bônus" },
        { employeeId: "e2", amount: 50, notes: undefined },
      ]);
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
      expect(onNotice).toHaveBeenCalledWith("success", expect.stringContaining("Reserva distribuída"));
      // formulário volta a uma linha em branco
      expect((screen.getByLabelText("Funcionário da linha 1") as HTMLSelectElement).value).toBe("");
      expect(screen.queryByLabelText("Funcionário da linha 2")).toBeNull();
    });

    test("linha com problema fica de fora do total e do envio, e a confirmação avisa", async () => {
      await abrirReserva();
      vi.mocked(distributeTipReserve).mockResolvedValue({ total: 100, saldoDepois: 50 });
      escolher(1, "e1", "100");
      fireEvent.click(screen.getByRole("button", { name: /Mais uma pessoa/ }));
      fireEvent.change(screen.getByLabelText("Valor da linha 2"), { target: { value: "30" } });
      expect(screen.getByText("falta escolher o funcionário")).toBeTruthy();
      expect(txt(screen.getByText(/^Total:/))).toContain("R$ 100,00 de R$ 150,00");
      expect(screen.getByText("1 pessoa(s); 1 linha(s) marcada(s) ficam de fora")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Distribuir" }));
      const caixa = await screen.findByRole("alertdialog");
      expect(txt(caixa)).toContain("1 linha(s) com problema ficam de fora.");
      fireEvent.click(within(caixa).getByRole("button", { name: "Distribuir" }));
      await waitFor(() => expect(distributeTipReserve).toHaveBeenCalled());
      expect(vi.mocked(distributeTipReserve).mock.calls[0][1]).toEqual([{ employeeId: "e1", amount: 100, notes: undefined }]);
    });

    test("total acima do saldo ou zero desabilita Distribuir; cancelar na confirmação não envia", async () => {
      await abrirReserva();
      const botao = screen.getByRole("button", { name: "Distribuir" }) as HTMLButtonElement;
      expect(botao.disabled).toBe(true);
      escolher(1, "e1", "150.01");
      expect(botao.disabled).toBe(true);
      escolher(1, "e1", "150");
      expect(botao.disabled).toBe(false);
      fireEvent.click(botao);
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Voltar" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(distributeTipReserve).not.toHaveBeenCalled();
    });

    test("remover linha tira só aquela; a linha única não tem botão de remover", async () => {
      await abrirReserva();
      expect(screen.queryByRole("button", { name: /Remover linha/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Mais uma pessoa/ }));
      fireEvent.click(screen.getByRole("button", { name: "Remover linha 2" }));
      expect(screen.queryByLabelText("Funcionário da linha 2")).toBeNull();
    });

    test("erro do servidor ao distribuir avisa e não limpa o formulário", async () => {
      const { onNotice } = await abrirReserva();
      vi.mocked(distributeTipReserve).mockRejectedValue(new Error("saldo insuficiente"));
      escolher(1, "e1", "10");
      fireEvent.click(screen.getByRole("button", { name: "Distribuir" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Distribuir" }));
      await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "saldo insuficiente"));
      expect((screen.getByLabelText("Funcionário da linha 1") as HTMLSelectElement).value).toBe("e1");
    });
  });
});

// ─── Histórico das funções ──────────────────────────────────────────────────
const hist = (over: Partial<TipFuncaoHistorico>): TipFuncaoHistorico => ({
  id: "h", tipFunctionId: "f", name: "Funcao", pointsBefore: 4, pointsAfter: 5, minPoints: null, maxPoints: null, createdAt: "2026-05-10T15:00:00.000Z", ...over,
});
const HISTORICO: TipFuncaoHistorico[] = [
  hist({ id: "h1", name: "Atendente Teste", pointsBefore: 4, pointsAfter: 5, minPoints: 3, maxPoints: 6 }),
  hist({ id: "h2", name: "Cozinheiro Teste", pointsBefore: 8, pointsAfter: 7 }),
  hist({ id: "h3", name: "Chefe Teste", pointsBefore: null, pointsAfter: 10 }),
  hist({ id: "h4", name: "Caixa Teste", pointsBefore: 3, pointsAfter: 3 }),
];

const linhaHist = (nome: string) =>
  screen.getAllByRole("row").find((r) => r.querySelector("td")?.textContent === nome) as HTMLElement;

describe("Aba Relatórios: histórico das funções", () => {
  async function abrirHistorico(lista = HISTORICO) {
    vi.mocked(getTipFunctionHistory).mockResolvedValue(lista);
    const r = abrir();
    ir("Histórico das funções");
    await waitFor(() => expect(getTipFunctionHistory).toHaveBeenCalled());
    return r;
  }

  test("mostra pontos antes e depois (\"nova\" quando não havia), a faixa e a data", async () => {
    await abrirHistorico();
    await screen.findAllByText("Atendente Teste");
    const atendente = txt(linhaHist("Atendente Teste"));
    expect(atendente).toContain("10/05/2026");
    expect(atendente).toContain("4");
    expect(atendente).toContain("5");
    expect(atendente).toContain("3 a 6");
    expect(txt(linhaHist("Chefe Teste"))).toContain("nova");
    expect(txt(linhaHist("Cozinheiro Teste"))).toContain("—");
  });

  test("sobe em verde, desce em vermelho, igual sem cor", async () => {
    await abrirHistorico();
    await screen.findAllByText("Atendente Teste");
    const depois = (nome: string) => within(linhaHist(nome)).getAllByRole("cell")[3];
    expect(depois("Atendente Teste").style.color).toBe("var(--success)");
    expect(depois("Cozinheiro Teste").style.color).toBe("var(--danger)");
    expect(depois("Caixa Teste").style.color).toBe("");
    expect(depois("Chefe Teste").style.color).toBe("");
  });

  test("filtro \"Mudança\" separa Subiu, Desceu, Nova e Pontos iguais", async () => {
    await abrirHistorico();
    await screen.findAllByText("Atendente Teste");
    const nomes = () => screen.getAllByRole("row").slice(1).map((r) => txt(r.querySelector("td")));
    fireEvent.change(screen.getByLabelText("Mudança"), { target: { value: "Desceu" } });
    expect(nomes()).toEqual(["Cozinheiro Teste"]);
    fireEvent.change(screen.getByLabelText("Mudança"), { target: { value: "Pontos iguais" } });
    expect(nomes()).toEqual(["Caixa Teste"]);
    fireEvent.change(screen.getByLabelText("Mudança"), { target: { value: "Nova" } });
    expect(nomes()).toEqual(["Chefe Teste"]);
    fireEvent.change(screen.getByLabelText("Mudança"), { target: { value: "Subiu" } });
    expect(nomes()).toEqual(["Atendente Teste"]);
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhuma alteração bate com o filtro.")).toBeTruthy();
  });

  test("sem alterações registradas: mensagem de vazio e sem barra de filtro", async () => {
    await abrirHistorico([]);
    expect(await screen.findByText("Nenhuma alteração registrada na tabela de funções.")).toBeTruthy();
    expect(screen.queryByRole("search")).toBeNull();
  });

  test("falha ao carregar repassa o erro", async () => {
    vi.mocked(getTipFunctionHistory).mockRejectedValue(new Error("histórico fora"));
    const { onNotice } = abrir();
    ir("Histórico das funções");
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "histórico fora"));
  });
});
