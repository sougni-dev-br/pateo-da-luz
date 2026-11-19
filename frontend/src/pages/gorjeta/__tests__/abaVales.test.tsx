import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipValeLancado, TipValesPeriodo } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipVales: vi.fn(),
  getTipValeDescricoes: vi.fn(),
  getTipCompanies: vi.fn(),
  addTipVale: vi.fn(),
  editarTipVale: vi.fn(),
  cancelarTipVale: vi.fn(),
  emitirReciboVale: vi.fn(),
}));
vi.mock("../reciboVale", () => ({ imprimirReciboVale: vi.fn(async () => "blob:recibo-teste") }));
vi.mock("../gorjetaUtils", async (importOriginal) => ({ ...(await importOriginal<typeof import("../gorjetaUtils")>()), baixarCsv: vi.fn() }));

import {
  addTipVale, cancelarTipVale, editarTipVale, emitirReciboVale, getTipCompanies, getTipValeDescricoes, getTipVales,
} from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaVales } from "../AbaVales";
import { baixarCsv } from "../gorjetaUtils";
import { imprimirReciboVale } from "../reciboVale";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <MemoryRouter><SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider></MemoryRouter>,
);

const vale = (over: Partial<TipValeLancado>): TipValeLancado => ({
  id: "v", participantId: "pa1", employeeId: "e1", nome: "Ana Ficticia", apelido: null, type: "ADIANTAMENTO", amount: 100,
  date: "2026-09-05", notes: null, lancadoEm: "2026-09-05T12:00:00.000Z", lancadoPor: "Operador Teste", alteradoEm: null,
  canceladoEm: null, canceladoPor: null, motivoCancelamento: null, doFundo: false, codigo: "VALE-2026-00001",
  reciboImpressoEm: null, reciboImpressoes: 0, ...over,
});

type PessoaP = TipValesPeriodo["pessoas"][number];
const pessoa = (over: Partial<PessoaP>): PessoaP => ({
  participantId: "pa1", employeeId: "e1", nome: "Ana Ficticia", apelido: null, semRegistro: false, foraDaGorjeta: false, funcao: "Garçom",
  empresaId: "c1", empresa: "Empresa Alfa", gorjeta: 500, descontos: 100, creditos: 30, liquida: 430, pagoNaRescisao: false, ...over,
});

function periodo(over: Partial<TipValesPeriodo> = {}): TipValesPeriodo {
  return {
    code: "2026-09", status: "OPEN",
    vales: [
      vale({ id: "v1", notes: "Transporte", type: "ADIANTAMENTO", amount: 100, codigo: "VALE-2026-00001" }),
      vale({ id: "v2", type: "CREDITO", amount: 30, doFundo: true, codigo: "VALE-2026-00002" }),
      vale({ id: "v3", participantId: "pa2", employeeId: "e2", nome: "Bruno Ficticio", type: "REFEICAO", amount: 20, codigo: "VALE-2026-00003" }),
      vale({ id: "v4", participantId: "pa2", employeeId: "e2", nome: "Bruno Ficticio", type: "VALE_CONSUMO", amount: 500, codigo: "VALE-2026-00004",
        canceladoEm: "2026-09-06T10:00:00.000Z", canceladoPor: "Gerente Teste", motivoCancelamento: "Lançado em duplicidade" }),
    ],
    pessoas: [
      pessoa({}),
      pessoa({ participantId: "pa2", employeeId: "e2", nome: "Bruno Ficticio", semRegistro: true, empresaId: null, empresa: null, funcao: "Cozinha", gorjeta: 300, descontos: 20, creditos: 0, liquida: 280 }),
    ],
    ...over,
  };
}

function montar(over: Partial<React.ComponentProps<typeof AbaVales>> = {}) {
  const props = { year: 2026, month: 9, canEdit: true, onNotice: vi.fn(), onChanged: vi.fn(), ...over };
  render(<AbaVales {...props} />);
  return props;
}
const texto = (el: Element = document.body) => el.textContent!.replace(/\s/g, " ");
const digitar = (campo: HTMLElement, v: string) => fireEvent.change(campo, { target: { value: v } });
const tabelas = () => screen.getAllByRole("table");
const tabelaLancamentos = () => tabelas()[tabelas().length - 1];
const tabelaPessoas = () => tabelas()[0];
const cartao = (rotulo: string) => screen.getByText(rotulo, { selector: ".card-total span" }).closest(".card-total") as HTMLElement;
const linhaDoAdiantamento = () => within(tabelaLancamentos()).getByText("Transporte").closest("tr") as HTMLElement;
const esperarCarga = () => screen.findByText(/Lançamentos 2026-09/);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(getTipVales).mockReset().mockResolvedValue(periodo());
  vi.mocked(getTipValeDescricoes).mockReset().mockResolvedValue([]);
  vi.mocked(getTipCompanies).mockReset().mockResolvedValue([{ id: "c1", tradeName: "Empresa Alfa" }, { id: "c2", tradeName: "Empresa Beta" }] as never);
  vi.mocked(addTipVale).mockReset().mockResolvedValue({ id: "novo", codigo: "VALE-2026-00099" });
  vi.mocked(editarTipVale).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(cancelarTipVale).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(emitirReciboVale).mockReset().mockResolvedValue({ codigo: "VALE-2026-00001", vez: 1 } as never);
  vi.mocked(imprimirReciboVale).mockClear();
  vi.mocked(baixarCsv).mockReset();
});

describe("Aba Vales: carga e totais", () => {
  test("mostra Carregando e depois consulta o período certo", async () => {
    montar();
    expect(screen.getByText("Carregando os vales…")).toBeTruthy();
    await esperarCarga();
    expect(getTipVales).toHaveBeenCalledWith(2026, 9);
  });

  test("falha ao carregar avisa o erro e não quebra a tela", async () => {
    vi.mocked(getTipVales).mockRejectedValue(new Error("Servidor fora do ar"));
    const props = montar();
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("error", "Servidor fora do ar"));
    expect(screen.getByText("Carregando os vales…")).toBeTruthy();
  });

  test("cartões: gorjeta do rateio, descontos só dos ativos, créditos e gorjeta líquida", async () => {
    montar();
    await esperarCarga();
    expect(texto(cartao("Gorjeta do rateio"))).toMatch(/R\$ 800,00.*2 pessoas/);
    // 100 + 20 de descontos ativos; o cancelado de 500 fica de fora
    expect(texto(cartao("Vales (descontos)"))).toMatch(/-R\$ 120,00.*2 lançamentos/);
    expect(texto(cartao("Créditos"))).toMatch(/R\$ 30,00/);
    expect(texto(cartao("Gorjeta líquida"))).toMatch(/R\$ 710,00/);
  });

  test("cabeçalho conta ativos e cancelados", async () => {
    montar();
    await esperarCarga();
    expect(texto()).toMatch(/3 ativo\(s\) · 1 cancelado\(s\)/);
  });

  test("total da lista soma créditos e subtrai descontos, ignorando cancelados", async () => {
    montar();
    await esperarCarga();
    const total = within(tabelaLancamentos()).getByTitle("Vales cancelados não entram no total").closest("tr")!;
    // -100 + 30 - 20 = -90
    expect(texto(total)).toMatch(/-R\$ 90,00/);
  });

  test("Por pessoa lista só quem tem vale, com avisos de gorjeta negativa e de fora da gorjeta", async () => {
    vi.mocked(getTipVales).mockResolvedValue(periodo({
      pessoas: [
        pessoa({ liquida: -20 }),
        pessoa({ participantId: "pa2", employeeId: "e2", nome: "Bruno Ficticio", foraDaGorjeta: true, empresaId: null, empresa: null, descontos: 20, creditos: 0, liquida: 0 }),
        pessoa({ participantId: "pa3", employeeId: "e3", nome: "Carla Ficticia", descontos: 0, creditos: 0 }),
      ],
    }));
    montar();
    await esperarCarga();
    const t = tabelaPessoas();
    expect(within(t).getByText("vales maiores que a gorjeta")).toBeTruthy();
    expect(within(t).getByText(/fora da gorjeta · desconta do salário/)).toBeTruthy();
    expect(within(t).queryByText("Carla Ficticia")).toBeNull();
  });
});

describe("Aba Vales: estados vazios e bloqueios", () => {
  test("período sem vales mostra o estado vazio e desabilita o CSV", async () => {
    vi.mocked(getTipVales).mockResolvedValue(periodo({ vales: [], pessoas: [] }));
    montar();
    expect(await screen.findByText("Nenhum vale lançado neste período.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Excel/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("search")).toBeNull();
  });

  test("período fechado: avisa, esconde o formulário e as ações de corrigir e cancelar", async () => {
    vi.mocked(getTipVales).mockResolvedValue(periodo({ status: "CLOSED" }));
    montar();
    await esperarCarga();
    expect(screen.getByText("Período fechado.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Lançar vale" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Corrigir vale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancelar vale de/ })).toBeNull();
    // o recibo continua disponível
    expect(screen.getByRole("button", { name: "Imprimir recibo do vale de Ana Ficticia" })).toBeTruthy();
  });

  test("sem permissão de editar: sem formulário nem ações, e sem aviso de período fechado", async () => {
    montar({ canEdit: false });
    await esperarCarga();
    expect(screen.queryByRole("button", { name: "Lançar vale" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Corrigir vale/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cancelar vale de/ })).toBeNull();
    expect(screen.queryByText("Período fechado.")).toBeNull();
  });

  test("vale cancelado mostra selo, autor e motivo e não oferece ações", async () => {
    montar();
    await esperarCarga();
    const linha = within(tabelaLancamentos()).getAllByText("Bruno Ficticio")[1].closest("tr")!;
    expect(linha.className).toContain("linha-cancelada");
    expect(within(linha).getByText("Cancelado")).toBeTruthy();
    expect(texto(linha)).toContain("Cancelado por Gerente Teste");
    expect(texto(linha)).toContain("Lançado em duplicidade");
    expect(within(linha).queryByRole("button")).toBeNull();
  });

  test("vale do fundo (distribuição) não pode ser corrigido, só cancelado", async () => {
    montar();
    await esperarCarga();
    const linha = within(tabelaLancamentos()).getByText("distribuição do fundo").closest("tr")!;
    expect(within(linha).queryByRole("button", { name: /Corrigir vale/ })).toBeNull();
    expect(within(linha).getByRole("button", { name: /Cancelar vale de/ })).toBeTruthy();
    // crédito não tem recibo
    expect(within(linha).queryByRole("button", { name: /Imprimir recibo/ })).toBeNull();
  });
});

describe("Aba Vales: lançar", () => {
  test("lança com o payload certo, avisa, recarrega e pede atualização da apuração", async () => {
    const props = montar({ pedidoPessoa: { pessoa: "pa1", n: 1 } });
    await esperarCarga();
    digitar(screen.getByLabelText("Valor (R$)"), "50");
    fireEvent.click(screen.getByRole("button", { name: "Lançar vale" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("success", "Vale VALE-2026-00099 lançado."));
    expect(addTipVale).toHaveBeenCalledWith("pa1", { type: "ADIANTAMENTO", amount: 50, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), notes: undefined });
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(getTipVales).toHaveBeenCalledTimes(2);
    expect(emitirReciboVale).not.toHaveBeenCalled();
  });

  test("erro da API avisa e mantém o valor digitado", async () => {
    vi.mocked(addTipVale).mockRejectedValue(new Error("Período fechado no financeiro"));
    const props = montar({ pedidoPessoa: { pessoa: "pa1", n: 1 } });
    await esperarCarga();
    digitar(screen.getByLabelText("Valor (R$)"), "50");
    fireEvent.click(screen.getByRole("button", { name: "Lançar vale" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("error", "Período fechado no financeiro"));
    expect((screen.getByLabelText("Valor (R$)") as HTMLInputElement).value).toBe("50");
    expect(props.onChanged).not.toHaveBeenCalled();
  });

  test("com imprimir marcado e pessoa com empresa, emite e imprime o recibo do vale novo", async () => {
    window.localStorage.setItem("gorjeta-vales-imprimir", "sim");
    montar({ pedidoPessoa: { pessoa: "pa1", n: 1 } });
    await esperarCarga();
    digitar(screen.getByLabelText("Valor (R$)"), "50");
    fireEvent.click(screen.getByRole("button", { name: "Lançar vale" }));
    await waitFor(() => expect(emitirReciboVale).toHaveBeenCalledWith("novo", "c1"));
    await waitFor(() => expect(imprimirReciboVale).toHaveBeenCalled());
    expect(await screen.findByText(/enviado para impressão/)).toBeTruthy();
  });

  test("com imprimir marcado e pessoa sem empresa (sem registro), pede para escolher a empresa do recibo", async () => {
    window.localStorage.setItem("gorjeta-vales-imprimir", "sim");
    montar({ pedidoPessoa: { pessoa: "pa2", n: 1 } });
    await esperarCarga();
    digitar(screen.getByLabelText("Valor (R$)"), "50");
    fireEvent.click(screen.getByRole("button", { name: "Lançar vale" }));
    expect(await screen.findByText("Recibo de Bruno Ficticio")).toBeTruthy();
    expect(emitirReciboVale).not.toHaveBeenCalled();
  });
});

describe("Aba Vales: corrigir", () => {
  const abrirCorrecao = async () => {
    const props = montar();
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir vale de Ana Ficticia" }));
    return props;
  };

  test("salva a correção com os campos editados e avisa que ficou registrada", async () => {
    const props = await abrirCorrecao();
    digitar(screen.getByLabelText("Valor do vale"), "80,5".replace(",", "."));
    digitar(screen.getByLabelText("Descrição do vale"), "  Transporte ajustado ");
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo do vale" }), { target: { value: "REFEICAO" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar correção" }));
    await waitFor(() => expect(editarTipVale).toHaveBeenCalledWith("v1", { type: "REFEICAO", amount: 80.5, date: "2026-09-05", notes: "Transporte ajustado" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("success", "Vale corrigido. A alteração ficou registrada."));
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText("Valor do vale")).toBeNull());
  });

  test("não deixa salvar valor zero ou vazio", async () => {
    await abrirCorrecao();
    const salvar = () => screen.getByRole("button", { name: "Salvar correção" }) as HTMLButtonElement;
    digitar(screen.getByLabelText("Valor do vale"), "0");
    expect(salvar().disabled).toBe(true);
    digitar(screen.getByLabelText("Valor do vale"), "");
    expect(salvar().disabled).toBe(true);
    digitar(screen.getByLabelText("Valor do vale"), "10");
    expect(salvar().disabled).toBe(false);
  });

  test("descrição apagada vai como nulo", async () => {
    await abrirCorrecao();
    digitar(screen.getByLabelText("Descrição do vale"), "   ");
    fireEvent.click(screen.getByRole("button", { name: "Salvar correção" }));
    await waitFor(() => expect(editarTipVale).toHaveBeenCalledWith("v1", expect.objectContaining({ notes: null })));
  });

  test("desistir da correção fecha os campos sem chamar a API", async () => {
    await abrirCorrecao();
    fireEvent.click(screen.getByRole("button", { name: "Desistir da correção" }));
    expect(screen.queryByLabelText("Valor do vale")).toBeNull();
    expect(editarTipVale).not.toHaveBeenCalled();
  });

  test("erro da API ao corrigir avisa e mantém a edição aberta", async () => {
    vi.mocked(editarTipVale).mockRejectedValue(new Error("Vale já cancelado"));
    const props = await abrirCorrecao();
    fireEvent.click(screen.getByRole("button", { name: "Salvar correção" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("error", "Vale já cancelado"));
    expect(screen.getByLabelText("Valor do vale")).toBeTruthy();
    expect(props.onChanged).not.toHaveBeenCalled();
  });
});

describe("Aba Vales: cancelar", () => {
  const abrirCancelamento = async () => {
    const props = montar();
    await esperarCarga();
    fireEvent.click(within(linhaDoAdiantamento()).getByRole("button", { name: "Cancelar vale de Ana Ficticia" }));
    return props;
  };
  const botao = () => screen.getByRole("button", { name: "Cancelar vale" }) as HTMLButtonElement;

  test("exige motivo de pelo menos 5 letras e conta quantas faltam", async () => {
    await abrirCancelamento();
    expect(botao().disabled).toBe(true);
    expect(screen.getByText("faltam 5 letra(s) no motivo")).toBeTruthy();
    digitar(screen.getByLabelText("Motivo do cancelamento"), "abc");
    expect(screen.getByText("faltam 2 letra(s) no motivo")).toBeTruthy();
    digitar(screen.getByLabelText("Motivo do cancelamento"), "     ab");
    expect(botao().disabled).toBe(true);
    digitar(screen.getByLabelText("Motivo do cancelamento"), "abcde");
    expect(botao().disabled).toBe(false);
    expect(screen.queryByText(/faltam/)).toBeNull();
  });

  test("cancela com o motivo sem espaços nas pontas e avisa que continua no histórico", async () => {
    const props = await abrirCancelamento();
    digitar(screen.getByLabelText("Motivo do cancelamento"), "  Lançado na pessoa errada ");
    fireEvent.click(botao());
    await waitFor(() => expect(cancelarTipVale).toHaveBeenCalledWith("v1", "Lançado na pessoa errada"));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("success", "Vale cancelado. Ele continua no histórico, mas não desconta mais."));
    expect(props.onChanged).toHaveBeenCalledTimes(1);
  });

  test("voltar fecha o motivo sem cancelar", async () => {
    await abrirCancelamento();
    fireEvent.click(screen.getByRole("button", { name: "voltar" }));
    expect(screen.queryByLabelText("Motivo do cancelamento")).toBeNull();
    expect(cancelarTipVale).not.toHaveBeenCalled();
  });

  test("erro da API ao cancelar avisa e mantém o motivo digitado", async () => {
    vi.mocked(cancelarTipVale).mockRejectedValue(new Error("Período fechado"));
    const props = await abrirCancelamento();
    digitar(screen.getByLabelText("Motivo do cancelamento"), "Motivo válido");
    fireEvent.click(botao());
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("error", "Período fechado"));
    expect((screen.getByLabelText("Motivo do cancelamento") as HTMLInputElement).value).toBe("Motivo válido");
  });

  test("abrir corrigir fecha o cancelamento e vice-versa", async () => {
    await abrirCancelamento();
    fireEvent.click(screen.getByRole("button", { name: "Corrigir vale de Ana Ficticia" }));
    expect(screen.queryByLabelText("Motivo do cancelamento")).toBeNull();
    expect(screen.getByLabelText("Valor do vale")).toBeTruthy();
  });
});

describe("Aba Vales: recibo", () => {
  test("pessoa com empresa no cadastro: emite com a empresa dela, imprime e avisa com link do PDF", async () => {
    montar();
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir recibo do vale de Ana Ficticia" }));
    await waitFor(() => expect(emitirReciboVale).toHaveBeenCalledWith("v1", "c1"));
    expect(imprimirReciboVale).toHaveBeenCalled();
    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toContain("Recibo VALE-2026-00001 enviado para impressão.");
    expect(within(aviso).getByRole("link", { name: "Abrir o PDF" }).getAttribute("href")).toBe("blob:recibo-teste");
    expect(window.localStorage.getItem("gorjeta-vales-empresa-recibo")).toBe("c1");
    // recarrega para mostrar o contador de impressões
    await waitFor(() => expect(getTipVales).toHaveBeenCalledTimes(2));
    fireEvent.click(within(aviso).getByRole("button", { name: "fechar" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("sem empresa no cadastro: pede a empresa emitente e emite com a escolhida", async () => {
    montar();
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir recibo do vale de Bruno Ficticio" }));
    expect(emitirReciboVale).not.toHaveBeenCalled();
    expect(await screen.findByText("Recibo de Bruno Ficticio")).toBeTruthy();
    const select = screen.getByLabelText("Empresa do recibo") as HTMLSelectElement;
    expect(select.value).toBe("c1");
    fireEvent.change(select, { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: "Imprimir recibo" }));
    await waitFor(() => expect(emitirReciboVale).toHaveBeenCalledWith("v3", "c2"));
    expect(screen.queryByText("Recibo de Bruno Ficticio")).toBeNull();
  });

  test("a empresa usada por último é a sugerida da próxima vez; agora não fecha o painel", async () => {
    window.localStorage.setItem("gorjeta-vales-empresa-recibo", "c2");
    montar();
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir recibo do vale de Bruno Ficticio" }));
    expect((await screen.findByLabelText("Empresa do recibo") as HTMLSelectElement).value).toBe("c2");
    fireEvent.click(screen.getByRole("button", { name: "agora não" }));
    expect(screen.queryByLabelText("Empresa do recibo")).toBeNull();
    expect(emitirReciboVale).not.toHaveBeenCalled();
  });

  test("falha ao emitir recibo avisa o erro", async () => {
    vi.mocked(emitirReciboVale).mockRejectedValue(new Error("Recibo indisponível"));
    const props = montar();
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: "Imprimir recibo do vale de Ana Ficticia" }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("error", "Recibo indisponível"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("vale já impresso mostra quantas vezes e oferece imprimir de novo", async () => {
    vi.mocked(getTipVales).mockResolvedValue(periodo({
      vales: [vale({ id: "v1", reciboImpressoEm: "2026-09-06T10:00:00.000Z", reciboImpressoes: 2 })],
    }));
    montar();
    await esperarCarga();
    expect(screen.getByText(/imprimir de novo \(2×\)/)).toBeTruthy();
  });
});

describe("Aba Vales: filtros e atalho da Apuração", () => {
  test("clicar numa pessoa em Por pessoa filtra os lançamentos; clicar de novo limpa", async () => {
    montar();
    await esperarCarga();
    const linhaAna = within(tabelaPessoas()).getByText("Ana Ficticia").closest("tr")!;
    fireEvent.click(linhaAna);
    expect(within(tabelaLancamentos()).queryByText("Bruno Ficticio")).toBeNull();
    expect(texto()).toMatch(/Total do filtro \(2 de 4\)/);
    fireEvent.click(within(tabelaPessoas()).getByText("Ana Ficticia").closest("tr")!);
    expect(within(tabelaLancamentos()).getAllByText("Bruno Ficticio").length).toBeGreaterThan(0);
  });

  test("filtro por situação Cancelados e por tipo", async () => {
    montar();
    await esperarCarga();
    fireEvent.change(screen.getAllByLabelText("Situação")[0], { target: { value: "Cancelado" } });
    expect(texto()).toMatch(/Total do filtro \(1 de 4\)/);
    fireEvent.click(screen.getAllByRole("button", { name: /limpar filtro/ })[0]);
    fireEvent.change(screen.getAllByLabelText("Tipo")[0], { target: { value: "REFEICAO" } });
    expect(texto()).toMatch(/Total do filtro \(1 de 4\)/);
  });

  test("busca sem resultado mostra a mensagem de filtro vazio", async () => {
    montar();
    await esperarCarga();
    fireEvent.change((() => { const l = screen.getAllByLabelText("Filtrar a tabela"); return l[l.length - 1]; })(), { target: { value: "zzzz" } });
    expect(screen.getByText("Nenhum vale com esse filtro.")).toBeTruthy();
  });

  test("pedidoPessoa (atalho da Apuração) já abre filtrado nessa pessoa e preenche o formulário", async () => {
    montar({ pedidoPessoa: { pessoa: "pa2", n: 1 } });
    await esperarCarga();
    expect(within(tabelaLancamentos()).queryByText("Ana Ficticia")).toBeNull();
    expect(texto()).toMatch(/Total do filtro \(2 de 4\)/);
    expect(texto()).toMatch(/Bruno: gorjeta líquida R\$\s*280,00/);
  });

  test("pessoa do filtro que não existe no período sai do filtro (não esconde todos os vales)", async () => {
    montar({ pedidoPessoa: { pessoa: "pa-inexistente", n: 1 } });
    await esperarCarga();
    await waitFor(() => expect(texto()).not.toMatch(/Total do filtro/));
    expect(within(tabelaLancamentos()).getAllByText("Ana Ficticia").length).toBeGreaterThan(0);
  });
});

describe("Aba Vales: exportar", () => {
  test("CSV leva todos os vales do período, com sinal do crédito e situação do cancelado", async () => {
    montar();
    await esperarCarga();
    fireEvent.click(screen.getByRole("button", { name: /Excel/ }));
    const [nome, linhas] = vi.mocked(baixarCsv).mock.calls[0];
    expect(nome).toBe("gorjeta-vales-2026-09.csv");
    expect(linhas).toHaveLength(5);
    const credito = linhas.find((l) => l[3] === "Crédito (soma)")!;
    expect(credito[5]).toBe(30);
    const cancelado = linhas.find((l) => l[3] === "Vale consumo")!;
    expect(cancelado[5]).toBe(-500);
    expect(String(cancelado[8])).toContain("Cancelado por Gerente Teste");
    expect(cancelado[9]).toBe("Lançado em duplicidade");
    expect(linhas.find((l) => l[3] === "Refeição")![8]).toBe("Ativo");
  });
});
