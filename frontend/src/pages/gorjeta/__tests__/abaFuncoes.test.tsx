import { fireEvent, render as renderRaw, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipFunction, TipTeamMember } from "../../../api/client";

vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getTipFunctionsTable: vi.fn(),
  getTipTeam: vi.fn(),
  saveTipFunctions: vi.fn(),
}));

import { getTipFunctionsTable, getTipTeam, saveTipFunctions } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { AbaFuncoes } from "../AbaFuncoes";
import { gravarRascunho, lerRascunho } from "../rascunhoFuncoes";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(
  <SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>,
);

const funcao = (over: Partial<TipFunction>): TipFunction => ({
  id: "f", name: "Funcao", points: 4, minPoints: null, maxPoints: null, group: null, notes: null, isActive: true, ...over,
});
const FUNCOES: TipFunction[] = [
  funcao({ id: "f1", name: "Atendente Teste", points: 5, group: "Salão" }),
  funcao({ id: "f2", name: "Cozinheiro Teste", points: 8, group: "Cozinha", isActive: false }),
];
const membro = (id: string, tipFunctionId: string | null, over: Partial<TipTeamMember> = {}): TipTeamMember => ({
  id, firstName: "Pessoa", lastName: id, displayName: null, isActive: true, sector: null, position: null, modality: "NAO_CLT",
  admissionDate: null, terminationDate: null, companyId: null, participaGorjeta: true, tipoGorjeta: "PONTOS", cotaFixaGorjeta: null,
  pontosExtra: null, pontosExtraMotivo: null, tipFunctionId, inicioGorjeta: null, ...over,
});

const abrir = (canEdit = true) => {
  const onNotice = vi.fn();
  const onChanged = vi.fn();
  render(<AbaFuncoes canEdit={canEdit} onNotice={onNotice} onChanged={onChanged} />);
  return { onNotice, onChanged };
};
const pontosDe = (nome: string) => screen.getByLabelText(`Pontos de ${nome}`) as HTMLInputElement;
const editarPontos = (nome: string, valor: string) => fireEvent.change(pontosDe(nome), { target: { value: valor } });

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
  vi.mocked(getTipFunctionsTable).mockResolvedValue({ versao: "v1", funcoes: FUNCOES });
  vi.mocked(getTipTeam).mockResolvedValue([
    membro("a", "f1"), membro("b", "f1"),
    membro("c", "f1", { isActive: false }), // desligado não conta
    membro("d", "f1", { participaGorjeta: false }), // não participa não conta
    membro("e", null), // sem função não conta
  ]);
  vi.mocked(saveTipFunctions).mockResolvedValue({ ok: true });
});

describe("Aba Funções e pontos: leitura", () => {
  test("lista as funções com pontos, total de funções, ativas e pessoas ativas em cada uma", async () => {
    abrir();
    await screen.findAllByLabelText("Nome da função");
    const atendente = pontosDe("Atendente Teste").closest("tr")!;
    expect(screen.getByText(/2 funções · 1 ativas/)).toBeTruthy();
    expect(pontosDe("Atendente Teste").value).toBe("5");
    expect(pontosDe("Cozinheiro Teste").value).toBe("8");
    // só participantes ativos com função: 2 em Atendente, 0 em Cozinheiro
    const celulas = within(atendente).getAllByRole("cell").map((c) => c.textContent);
    expect(celulas).toContain("2");
    const cozinha = screen.getByLabelText("Pontos de Cozinheiro Teste").closest("tr")!;
    expect(within(cozinha).getAllByRole("cell").map((c) => c.textContent)).toContain("0");
    expect((screen.getByLabelText("Cozinheiro Teste ativa") as HTMLInputElement).checked).toBe(false);
  });

  test("sem permissão de editar: campos desabilitados e sem botão de nova função", async () => {
    abrir(false);
    await screen.findByText(/2 funções/);
    expect(pontosDe("Atendente Teste").disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Nova função/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Revisar e salvar/ })).toBeNull();
  });

  test("falha ao carregar: avisa o erro e não mostra funções", async () => {
    vi.mocked(getTipFunctionsTable).mockRejectedValue(new Error("Servidor fora do ar"));
    const { onNotice } = abrir();
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "Servidor fora do ar"));
    expect(screen.queryByLabelText("Nome da função")).toBeNull();
  });

  test("tabela sem funções: mostra 0 funções e nenhuma linha", async () => {
    vi.mocked(getTipFunctionsTable).mockResolvedValue({ versao: "v1", funcoes: [] });
    abrir();
    expect(await screen.findByText(/0 funções · 0 ativas/)).toBeTruthy();
    expect(screen.queryByLabelText("Nome da função")).toBeNull();
  });
});

describe("Aba Funções e pontos: edição e salvamento", () => {
  test("sem alteração, a barra de salvar não aparece", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    expect(screen.queryByRole("region", { name: "Alterações não salvas" })).toBeNull();
  });

  test("alterar pontos marca a célula, mostra a barra e guarda o rascunho no navegador", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    const barra = await screen.findByRole("region", { name: "Alterações não salvas" });
    expect(barra.textContent).toContain("1 alteração(ões) não salvas");
    expect(pontosDe("Atendente Teste").closest("td")!.getAttribute("title")).toBe("Antes: 5");
    await waitFor(() => expect(lerRascunho()?.funcoes[0].points).toBe(6));
    expect(lerRascunho()?.versao).toBe("v1");
  });

  test("revisar mostra antes → depois e quantas pessoas a mudança de pontos afeta", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    fireEvent.click(await screen.findByRole("button", { name: /Revisar e salvar/ }));
    expect(screen.getByText("O que vai ser gravado")).toBeTruthy();
    const item = screen.getByText("Atendente Teste", { selector: ".barra-salvar-funcao" }).closest("li")!;
    expect(item.textContent).toContain("Pontos 5 → 6");
    expect(item.textContent).toContain("muda a base de 2 pessoa(s)");
  });

  test("confirmar e salvar envia a tabela, a vigência, o motivo e a versão; limpa o rascunho e avisa", async () => {
    const { onNotice, onChanged } = abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    fireEvent.change(await screen.findByLabelText("Vigência das alterações"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Motivo das alterações"), { target: { value: "  reajuste do salão  " } });
    fireEvent.click(screen.getByRole("button", { name: /Revisar e salvar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e salvar/ }));

    await waitFor(() => expect(saveTipFunctions).toHaveBeenCalledTimes(1));
    const [enviadas, opcoes] = vi.mocked(saveTipFunctions).mock.calls[0];
    expect(enviadas).toHaveLength(2);
    expect(enviadas[0]).toMatchObject({ id: "f1", name: "Atendente Teste", points: 6 });
    expect(enviadas[1]).toMatchObject({ id: "f2", points: 8 });
    expect(opcoes).toEqual({ validFrom: "2026-10-01", reason: "reajuste do salão", baseVersion: "v1" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(onNotice).toHaveBeenCalledWith("success", expect.stringContaining("Tabela de funções salva"));
    expect(getTipFunctionsTable).toHaveBeenCalledTimes(2); // recarregou depois de salvar
    expect(lerRascunho()).toBeNull();
  });

  test("motivo em branco vai como indefinido", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    fireEvent.change(await screen.findByLabelText("Motivo das alterações"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Revisar e salvar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e salvar/ }));
    await waitFor(() => expect(saveTipFunctions).toHaveBeenCalled());
    expect(vi.mocked(saveTipFunctions).mock.calls[0][1]?.reason).toBeUndefined();
  });

  test("nova função sem nome: mostra o erro e bloqueia o salvamento; com nome, libera e entra marcada como nova", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    fireEvent.click(screen.getByRole("button", { name: /Nova função/ }));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("Há uma função sem nome.");
    expect((screen.getByRole("button", { name: /Revisar e salvar/ }) as HTMLButtonElement).disabled).toBe(true);

    const campos = screen.getAllByLabelText("Nome da função");
    fireEvent.change(campos[campos.length - 1], { target: { value: "Garçom Novo" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("nova")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Revisar e salvar/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("mínimo maior que o máximo e nome repetido bloqueiam salvar", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    fireEvent.change(screen.getByLabelText("Mínimo de Atendente Teste"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Máximo de Atendente Teste"), { target: { value: "3" } });
    expect((await screen.findByRole("alert")).textContent).toContain("o mínimo está maior que o máximo");
    expect((screen.getByRole("button", { name: /Revisar e salvar/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Mínimo de Atendente Teste"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Máximo de Atendente Teste"), { target: { value: "" } });
    fireEvent.change(screen.getAllByLabelText("Nome da função")[1], { target: { value: "atendente teste" } });
    expect((await screen.findByRole("alert")).textContent).toContain("aparece 2 vezes");
  });

  test("desfazer uma linha alterada volta ao valor salvo e esconde a barra", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer alterações em Atendente Teste" }));
    expect(pontosDe("Atendente Teste").value).toBe("5");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Alterações não salvas" })).toBeNull());
    await waitFor(() => expect(lerRascunho()).toBeNull());
  });

  test("desfazer uma função nova a remove da tabela", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    fireEvent.click(screen.getByRole("button", { name: /Nova função/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer alterações em função nova" }));
    await waitFor(() => expect(screen.getAllByLabelText("Nome da função")).toHaveLength(2));
  });

  test("descartar pede confirmação: Voltar mantém a edição, Descartar volta ao salvo", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "7");
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    const caixa = await screen.findByRole("alertdialog");
    expect(within(caixa).getByText("Descartar 1 alteração(ões) não salvas?")).toBeTruthy();
    fireEvent.click(within(caixa).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(pontosDe("Atendente Teste").value).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(pontosDe("Atendente Teste").value).toBe("5"));
    expect(saveTipFunctions).not.toHaveBeenCalled();
  });

  test("com alteração pendente, fechar a página pede confirmação do navegador", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    const livre = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(livre);
    expect(livre.defaultPrevented).toBe(false);
    editarPontos("Atendente Teste", "6");
    await screen.findByRole("region", { name: "Alterações não salvas" });
    const preso = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(preso);
    expect(preso.defaultPrevented).toBe(true);
  });
});

describe("Aba Funções e pontos: rascunho e conflito de versão", () => {
  const rascunho = (versao: string, pontos: number) => gravarRascunho({
    versao, salvoEm: "2026-10-05T12:00:00.000Z", vigencia: "2026-10-01", motivo: "do rascunho",
    funcoes: [{ ...FUNCOES[0], points: pontos }, FUNCOES[1]],
  });

  test("rascunho da mesma versão é recuperado com aviso informativo, vigência e motivo", async () => {
    rascunho("v1", 9);
    abrir();
    expect((await screen.findByText(/Recuperamos 1 alteração\(ões\) não salvas/))).toBeTruthy();
    expect(pontosDe("Atendente Teste").value).toBe("9");
    expect((screen.getByLabelText("Motivo das alterações") as HTMLInputElement).value).toBe("do rascunho");
    expect((screen.getByLabelText("Vigência das alterações") as HTMLInputElement).value).toBe("2026-10-01");
  });

  test("rascunho de versão antiga é recuperado com alerta para conferir", async () => {
    rascunho("v0", 9);
    abrir();
    expect(await screen.findByText(/a tabela foi salva depois dele/)).toBeTruthy();
    expect(pontosDe("Atendente Teste").value).toBe("9");
  });

  test("rascunho igual ao que está salvo é descartado sem aviso", async () => {
    rascunho("v1", 5);
    abrir();
    await screen.findByText(/2 funções/);
    expect(pontosDe("Atendente Teste").value).toBe("5");
    expect(screen.queryByText(/Recuperamos/)).toBeNull();
    expect(lerRascunho()).toBeNull();
  });

  test("outra pessoa salvou antes: avisa, mantém o rascunho e permite comparar e salvar de novo com a versão nova", async () => {
    const { onNotice } = abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    vi.mocked(saveTipFunctions).mockRejectedValueOnce(new Error("Outra pessoa salvou a tabela antes de você."));
    fireEvent.click(await screen.findByRole("button", { name: /Revisar e salvar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e salvar/ }));

    expect(await screen.findByText(/Outra pessoa salvou a tabela enquanto você editava/)).toBeTruthy();
    expect(onNotice).toHaveBeenCalledWith("error", "Outra pessoa salvou a tabela antes de você.");
    expect(pontosDe("Atendente Teste").value).toBe("6");
    expect(lerRascunho()).not.toBeNull();

    vi.mocked(getTipFunctionsTable).mockResolvedValue({ versao: "v2", funcoes: [{ ...FUNCOES[0], points: 5.5 }, FUNCOES[1]] });
    fireEvent.click(screen.getByRole("button", { name: "Comparar com a versão salva" }));
    expect(await screen.findByText(/Rascunho comparado com a versão salva agora/)).toBeTruthy();
    // a célula agora mostra o que o servidor tem como "antes"
    await waitFor(() => expect(pontosDe("Atendente Teste").closest("td")!.getAttribute("title")).toBe("Antes: 5,5"));
    expect(screen.queryByRole("button", { name: "Comparar com a versão salva" })).toBeNull();

    // a revisão continua aberta depois do conflito: basta confirmar de novo
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e salvar/ }));
    await waitFor(() => expect(saveTipFunctions).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveTipFunctions).mock.calls[1][1]?.baseVersion).toBe("v2");
  });

  test("erro comum ao salvar avisa mas não mostra o aviso de conflito", async () => {
    const { onNotice } = abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    vi.mocked(saveTipFunctions).mockRejectedValueOnce(new Error("Sem conexão"));
    fireEvent.click(await screen.findByRole("button", { name: /Revisar e salvar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e salvar/ }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("error", "Sem conexão"));
    expect(screen.queryByText(/Outra pessoa salvou/)).toBeNull();
    expect(pontosDe("Atendente Teste").value).toBe("6");
  });
});

describe("Aba Funções e pontos: filtro", () => {
  test("filtrar por texto mostra o total do filtro e a mensagem de vazio; limpar volta tudo", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    const busca = screen.getByLabelText("Filtrar a tabela");
    fireEvent.change(busca, { target: { value: "cozinha" } });
    expect(screen.getByText(/Total do filtro \(1 de 2\)/)).toBeTruthy();
    expect(screen.queryByLabelText("Pontos de Atendente Teste")).toBeNull();
    expect(pontosDe("Cozinheiro Teste")).toBeTruthy();

    fireEvent.change(busca, { target: { value: "inexistente" } });
    expect(screen.getByText("Nenhuma função bate com o filtro.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /limpar filtro/ }));
    expect(screen.getByText(/2 funções/)).toBeTruthy();
  });

  test("filtro ativo com alteração pendente avisa que salvar grava também o que está escondido", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    editarPontos("Atendente Teste", "6");
    fireEvent.change(screen.getByLabelText("Filtrar a tabela"), { target: { value: "cozinha" } });
    expect(screen.getByText(/salvar grava todas as alterações, inclusive as de funções escondidas/)).toBeTruthy();
    expect(screen.queryByLabelText("Pontos de Atendente Teste")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Revisar e salvar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e salvar/ }));
    await waitFor(() => expect(saveTipFunctions).toHaveBeenCalled());
    expect(vi.mocked(saveTipFunctions).mock.calls[0][0][0].points).toBe(6);
  });

  test("filtro \"Pessoas: Sem pessoas\" mostra só funções sem participantes ativos", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    fireEvent.change(screen.getByLabelText("Pessoas"), { target: { value: "Sem pessoas" } });
    expect(screen.queryByLabelText("Pontos de Atendente Teste")).toBeNull();
    expect(pontosDe("Cozinheiro Teste")).toBeTruthy();
  });

  test("filtro por situação \"Ativa: Não\" deixa só as inativas e o contador de ativas acompanha", async () => {
    abrir();
    await screen.findByText(/2 funções/);
    fireEvent.change(screen.getByLabelText("Ativa"), { target: { value: "Não" } });
    expect(screen.getByText(/Total do filtro \(1 de 2\) · 0 ativas/)).toBeTruthy();
  });
});
