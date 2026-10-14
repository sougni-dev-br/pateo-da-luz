import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { LinhaPagamentoMeio, PagamentoMeio as Dados } from "../../../api/client";

// Lista do adiantamento na Folha: ver, confirmar, lançar e imprimir. Dados fictícios.
const linha = (over: Partial<LinhaPagamentoMeio>): LinhaPagamentoMeio => ({
  employeeId: "x", nome: "Fulano Exemplo", grupo: "ALFA EXEMPLO LTDA", origem: "EXTRATO", valor: 1000, situacao: "LANCADO",
  vencimento: "2026-10-20", pagoEm: null, valorPago: null, payrollItemId: "i-x", pix: "fulano@exemplo.com", pixTipo: "EMAIL",
  contaBancaria: null, aviso: null, ...over,
});
const resumo = (linhas: LinhaPagamentoMeio[], s: LinhaPagamentoMeio["situacao"]) => {
  const l = linhas.filter((x) => x.situacao === s);
  return { pessoas: l.length, total: l.reduce((a, x) => a + x.valor, 0) };
};
const dados = (linhas: LinhaPagamentoMeio[]): Dados => ({
  tipo: "ADIANTAMENTO", competencia: "10/2026", linhas, avisos: [], total: linhas.reduce((a, x) => a + x.valor, 0),
  aLancar: resumo(linhas, "A_LANCAR"), lancado: resumo(linhas, "LANCADO"), pago: resumo(linhas, "PAGO"),
});

const ANTES = dados([
  linha({ employeeId: "a", nome: "Ana Exemplo", valor: 1034 }),
  linha({ employeeId: "b", nome: "Bia Exemplo", valor: 1200, situacao: "PAGO", pagoEm: "2026-10-18", valorPago: 1200 }),
  linha({ employeeId: "c", nome: "Carla Exemplo", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 920, situacao: "A_LANCAR", payrollItemId: null, pix: null, pixTipo: null, aviso: "Ainda não está no Contas a Pagar: vence 20/10." }),
]);
const DEPOIS = dados(ANTES.linhas.map((l) => (l.employeeId === "c" ? { ...l, situacao: "LANCADO" as const, payrollItemId: "i-c", aviso: null } : l)));

const api = vi.hoisted(() => ({ getPagamentoMeio: vi.fn(), generatePayroll: vi.fn() }));
vi.mock("../../../api/client", () => api);
const pdf = vi.hoisted(() => ({ gerarPdfListaPagamento: vi.fn(async () => undefined) }));
vi.mock("../../gorjeta/pdfFolhaLiquidos", async (original) => ({ ...(await original<object>()), ...pdf }));

import { PagamentoMeio } from "../PagamentoMeio";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.getPagamentoMeio.mockResolvedValue(ANTES);
  api.generatePayroll.mockResolvedValue({ created: 1, skipped: 0, ajustados: 0, avisos: [] });
});

const montar = (canEdit = true, onLancado = vi.fn()) =>
  render(<PagamentoMeio year={2026} month={10} canEdit={canEdit} percentAdiantamento={40} versao="1" onLancado={onLancado} />);

test("mostra a situação de cada pessoa, agrupada por empresa, com o resumo", async () => {
  montar();
  expect(await screen.findByText("Carla Exemplo")).toBeInTheDocument();
  expect(api.getPagamentoMeio).toHaveBeenCalledWith(2026, 10, "ADIANTAMENTO");
  const resumoEl = screen.getByRole("list", { name: "Resumo" });
  expect(within(resumoEl).getAllByRole("listitem")[0].textContent).toMatch(/Falta lançar1R\$\s?920,00/);
  expect(screen.getAllByText("vence 20/10")).toHaveLength(2);
  expect(screen.getByText("em 18/10")).toBeInTheDocument();
  expect(screen.getAllByText("PIX (e-mail): fulano@exemplo.com").length).toBeGreaterThan(0);
  expect(screen.getByText("Sem dados bancários no cadastro")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: /ALFA EXEMPLO LTDA/ })).toBeInTheDocument();
});

test("lançar pede confirmação com nomes e valores; só grava ao confirmar", async () => {
  const onLancado = vi.fn();
  montar(true, onLancado);
  fireEvent.click(await screen.findByRole("button", { name: "Lançar no Contas a Pagar (1)" }));
  const dialogo = screen.getByRole("dialog", { name: "Confirmar lançamento" });
  expect(dialogo.textContent).toMatch(/1 título novo de adiantamento · total R\$\s?920,00/);
  expect(dialogo.textContent).toMatch(/Carla Exemplo — R\$\s?920,00 · vence 20\/10\/2026/);
  expect(api.generatePayroll).not.toHaveBeenCalled();

  api.getPagamentoMeio.mockResolvedValue(DEPOIS);
  fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar e lançar" }));
  await waitFor(() => expect(api.generatePayroll).toHaveBeenCalledWith(2026, 10, "ADIANTAMENTO_SR"));
  expect(await screen.findByText(/1 título criado no Contas a Pagar · R\$\s?920,00: Carla Exemplo\./)).toBeInTheDocument();
  expect(onLancado).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: /Lançar no Contas a Pagar/ })).toBeNull();
});

test("cancelar a confirmação não grava nada", async () => {
  montar();
  fireEvent.click(await screen.findByRole("button", { name: "Lançar no Contas a Pagar (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.generatePayroll).not.toHaveBeenCalled();
});

test("sem permissão de editar: sem botão de lançar, mas imprime", async () => {
  montar(false);
  await screen.findByText("Carla Exemplo");
  expect(screen.queryByRole("button", { name: /Lançar no Contas a Pagar/ })).toBeNull();
  expect(screen.getByRole("button", { name: "PDF para pagamento" })).toBeEnabled();
});

test("PDF: pagos à parte, quem falta lançar marcado e selo de prévia", async () => {
  montar();
  fireEvent.click(await screen.findByRole("button", { name: "PDF para pagamento" }));
  await waitFor(() => expect(pdf.gerarPdfListaPagamento).toHaveBeenCalled());
  const [lista, opcoes] = pdf.gerarPdfListaPagamento.mock.calls[0] as unknown as [
    { linhas: Array<{ nome: string; aviso: string | null }>; jaPagos: Array<{ nome: string }>; total: number },
    { titulo: string; selo: { texto: string; tom: string }; modo: string; apoio: string; arquivo: string },
  ];
  expect(lista.linhas.map((l) => l.nome)).toEqual(["Ana Exemplo", "Carla Exemplo"]);
  expect(lista.linhas[1].aviso).toBe("Ainda não lançado no Contas a Pagar");
  expect(lista.jaPagos.map((p) => p.nome)).toEqual(["Bia Exemplo"]);
  expect(lista.total).toBe(1954);
  expect(opcoes).toMatchObject({ titulo: "Adiantamento - lista de pagamento", selo: { texto: "PRÉVIA - FALTA LANÇAR 1", tom: "aviso" }, modo: "empresa", arquivo: "ADIANT-2026-10.pdf" });
  expect(opcoes.apoio).toContain("vencimento 20/10/2026");
});

test("troca para a 1ª quinzena e lembra a escolha", async () => {
  montar();
  await screen.findByText("Carla Exemplo");
  fireEvent.change(screen.getByRole("combobox", { name: "Qual pagamento" }), { target: { value: "QUINZENA" } });
  await waitFor(() => expect(api.getPagamentoMeio).toHaveBeenLastCalledWith(2026, 10, "QUINZENA"));
  expect(window.localStorage.getItem("pagamento-meio:tipo")).toBe("QUINZENA");
});

test("erro da API (sem permissão) aparece na tela", async () => {
  api.getPagamentoMeio.mockRejectedValue(new Error("A lista do adiantamento tem valores e PIX: é preciso permissão de ver Funcionários."));
  montar();
  expect(await screen.findByText(/é preciso permissão de ver Funcionários/)).toBeInTheDocument();
});
