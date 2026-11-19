import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipValeRelatorio } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipRelatorioVales: vi.fn(),
}));
vi.mock("../gorjetaUtils", async (importOriginal) => ({ ...(await importOriginal<typeof import("../gorjetaUtils")>()), baixarCsv: vi.fn() }));

import { getTipRelatorioVales } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { baixarCsv } from "../gorjetaUtils";
import { RelatorioVales } from "../RelatorioVales";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

const vale = (over: Partial<TipValeRelatorio>): TipValeRelatorio => ({
  id: "v", participantId: "p", employeeId: "e", nome: "Pessoa Ficticia", apelido: null, type: "ADIANTAMENTO", amount: 100,
  date: "2026-09-05T00:00:00.000Z", notes: null, lancadoEm: "2026-09-05T12:00:00.000Z", lancadoPor: "Operador Teste", alteradoEm: null,
  canceladoEm: null, canceladoPor: null, motivoCancelamento: null, doFundo: false, codigo: "VALE-2026-00001",
  reciboImpressoEm: null, reciboImpressoes: 0, periodo: "09/2026", competencia: "2026-09", ...over,
});

const DADOS = [
  vale({ id: "1", employeeId: "e1", nome: "Ana Ficticia", apelido: "Aninha", type: "ADIANTAMENTO", amount: 100 }),
  vale({ id: "2", employeeId: "e1", nome: "Ana Ficticia", apelido: "Aninha", type: "CREDITO", amount: 30 }),
  vale({ id: "3", employeeId: "e2", nome: "Bruno Ficticio", type: "REFEICAO", amount: 20 }),
  vale({ id: "4", employeeId: "e2", nome: "Bruno Ficticio", type: "VALE_CONSUMO", amount: 500, canceladoEm: "2026-09-06T10:00:00.000Z", canceladoPor: "Gerente Teste", motivoCancelamento: "Lançado em duplicidade" }),
];

const texto = () => document.body.textContent!.replace(/\s/g, " ");
const tabela = () => screen.getAllByRole("table")[0];
const linhaTotal = () => screen.getByTitle("Vales cancelados não entram no total").closest("tr")!;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(getTipRelatorioVales).mockReset().mockResolvedValue(DADOS);
  vi.mocked(baixarCsv).mockReset();
});

describe("Relatório de vales", () => {
  test("mostra Carregando e depois as linhas; consulta o intervalo padrão de competências", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    expect(screen.getByText("Carregando…")).toBeTruthy();
    await screen.findAllByText("Ana Ficticia");
    expect(screen.queryByText("Carregando…")).toBeNull();
    const [de, ate] = vi.mocked(getTipRelatorioVales).mock.calls[0];
    expect(de).toMatch(/^\d{4}-\d{2}$/);
    expect(ate).toMatch(/^\d{4}-\d{2}$/);
    expect(de < ate).toBe(true);
  });

  test("sem vales no intervalo mostra o estado vazio e desabilita o CSV", async () => {
    vi.mocked(getTipRelatorioVales).mockResolvedValue([]);
    render(<RelatorioVales onErro={vi.fn()} />);
    expect(await screen.findByText("Nenhum vale nesse intervalo.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Excel/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("falha da API chama onErro", async () => {
    vi.mocked(getTipRelatorioVales).mockRejectedValue(new Error("Sem permissão"));
    const onErro = vi.fn();
    render(<RelatorioVales onErro={onErro} />);
    await waitFor(() => expect(onErro).toHaveBeenCalled());
    expect((onErro.mock.calls[0][0] as Error).message).toBe("Sem permissão");
  });

  test("total: crédito soma, descontos subtraem e cancelados ficam de fora", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    // -100 + 30 - 20 = -90 (o cancelado de 500 não entra)
    expect(linhaTotal().textContent!.replace(/\s/g, " ")).toMatch(/-R\$ 90,00/);
    expect(texto()).toMatch(/Saldo -R\$ 90,00/);
  });

  test("resumo por tipo soma só os ativos", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    const t = texto();
    expect(t).toMatch(/Adiantamento R\$ 100,00/);
    expect(t).toMatch(/Crédito \(soma\) R\$ 30,00/);
    expect(t).toMatch(/Refeição R\$ 20,00/);
    expect(t).not.toMatch(/Vale consumo R\$/);
  });

  test("valores: desconto negativo, crédito positivo; cancelado aparece marcado", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    const linhaCancelada = within(tabela()).getAllByText("Bruno Ficticio")[1].closest("tr")!;
    expect(linhaCancelada.className).toContain("linha-cancelada");
    expect(within(linhaCancelada).getByText("Cancelado")).toBeTruthy();
    expect(linhaCancelada.textContent!.replace(/\s/g, " ")).toMatch(/-R\$ 500,00/);
    const credito = within(tabela()).getByText("Crédito (soma)", { selector: "td" }).closest("tr")!;
    expect(credito.textContent!.replace(/\s/g, " ")).toMatch(/R\$ 30,00/);
    expect(credito.textContent).not.toContain("-R$");
  });

  test("o cancelamento mostra autor e motivo; ocultando a coluna Descrição o selo continua junto ao nome", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    expect(texto()).toMatch(/Gerente Teste: Lançado em duplicidade/);
    fireEvent.click(screen.getByRole("button", { name: /Colunas/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Descrição/ }));
    expect(texto()).not.toMatch(/Lançado em duplicidade/);
    expect(within(tabela()).getByText("Cancelado")).toBeTruthy();
  });

  test("filtro por situação Cancelados mostra só o cancelado e o total vira 'do filtro' com saldo zero", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    fireEvent.change(screen.getByLabelText("Situação"), { target: { value: "Cancelado" } });
    expect(screen.queryByText("Ana Ficticia")).toBeNull();
    expect(texto()).toMatch(/Total do filtro \(1 de 4\)/);
    expect(linhaTotal().textContent!.replace(/\s/g, " ")).toMatch(/R\$ 0,00/);
  });

  test("filtro por tipo e por pessoa", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "CREDITO" } });
    expect(texto()).toMatch(/Total do filtro \(1 de 4\)/);
    expect(within(tabela()).queryByText("Bruno Ficticio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /limpar filtro/ }));
    fireEvent.change(screen.getByLabelText("Pessoa"), { target: { value: "e2" } });
    expect(texto()).toMatch(/Total do filtro \(2 de 4\)/);
    expect(within(tabela()).queryByText("Ana Ficticia")).toBeNull();
  });

  test("busca por texto pelo apelido e aviso quando nada bate", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "aninha" } });
    expect(texto()).toMatch(/Total do filtro \(2 de 4\)/);
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "zzzz" } });
    expect(screen.getByText("Nenhum vale com esse filtro.")).toBeTruthy();
  });

  test("trocar o mês inicial consulta de novo com a nova competência", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    fireEvent.change(screen.getByLabelText(/^De/), { target: { value: "2026-01" } });
    await waitFor(() => expect((() => { const c = vi.mocked(getTipRelatorioVales).mock.calls; return c[c.length - 1][0]; })()).toBe("2026-01"));
  });

  test("exportar CSV leva todas as linhas, inclusive o cancelado com o motivo", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    fireEvent.click(screen.getByRole("button", { name: /Excel/ }));
    expect(baixarCsv).toHaveBeenCalledTimes(1);
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toMatch(/^gorjeta-vales-\d{4}-\d{2}-a-\d{4}-\d{2}\.csv$/);
    expect(linhas).toHaveLength(5);
    const cancelada = linhas.find((l) => l[0] === "2026-09" && l[5] === "Vale consumo")!;
    expect(cancelada[7]).toBe(-500);
    expect(cancelada[9]).toBe("Cancelado por Gerente Teste");
    expect(cancelada[10]).toBe("Lançado em duplicidade");
    const credito = linhas.find((l) => l[5] === "Crédito (soma)")!;
    expect(credito[7]).toBe(30);
  });

  test("tabela tem uma linha por vale mais a linha de total", async () => {
    render(<RelatorioVales onErro={vi.fn()} />);
    await screen.findAllByText("Ana Ficticia");
    const linhas = within(screen.getAllByRole("table")[0]).getAllByRole("row");
    expect(linhas).toHaveLength(1 + 4 + 1);
  });
});
