import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SeletorFuncionario, type PessoaSelecionavel } from "../SeletorFuncionario";

const limpo = (t: string | null) => (t ?? "").replace(/\s/g, "");
const pessoa = (over: Partial<PessoaSelecionavel>): PessoaSelecionavel => ({
  participantId: "p", nome: "Pessoa", apelido: null, funcao: null, empresa: null, semRegistro: false, liquida: 100, ...over,
});
const PESSOAS = [
  pessoa({ participantId: "p1", nome: "Rosa Mariana", funcao: "Garçom", empresa: "Empresa A", liquida: 250 }),
  pessoa({ participantId: "p2", nome: "Álvaro Teste", apelido: "Alvinho", funcao: "Cozinha", semRegistro: true, liquida: 0 }),
  pessoa({ participantId: "p3", nome: "Beatriz Ficticia", funcao: "Caixa", empresa: "Empresa B", liquida: -30 }),
];

beforeEach(() => { window.localStorage.clear(); });

function abrir(valor = "", pessoas = PESSOAS, extra: { autoFoco?: boolean } = {}) {
  const onEscolher = vi.fn();
  render(<SeletorFuncionario pessoas={pessoas} valor={valor} onEscolher={onEscolher} {...extra} />);
  return { onEscolher, campo: screen.getByRole("combobox", { name: "Funcionário" }) as HTMLInputElement };
}
const nomesDaLista = () => within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.querySelector(".seletor-funcionario-nome")!.textContent);

describe("Seletor de funcionário", () => {
  test("fechado por padrão; ao clicar abre a lista em ordem alfabética", () => {
    const { campo } = abrir();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(campo);
    expect(nomesDaLista()).toEqual(["Álvaro Teste", "Beatriz Ficticia", "Rosa Mariana"]);
  });

  test("com foco automático ao abrir a aba, a lista não abre sozinha", () => {
    const { campo } = abrir("", PESSOAS, { autoFoco: true });
    campo.focus();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("busca sem acento e sem maiúsculas, por nome, apelido ou função", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "alvaro" } });
    expect(nomesDaLista()).toEqual(["Álvaro Teste"]);
    fireEvent.change(campo, { target: { value: "ALVINHO" } });
    expect(nomesDaLista()).toEqual(["Álvaro Teste"]);
    fireEvent.change(campo, { target: { value: "caixa" } });
    expect(nomesDaLista()).toEqual(["Beatriz Ficticia"]);
  });

  test("várias palavras em qualquer ordem", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "ana ros" } });
    expect(nomesDaLista()).toEqual(["Rosa Mariana"]);
  });

  test("sem resultado: mensagem de ninguém encontrado", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "zzzz" } });
    expect(screen.getByText("Ninguém com esse nome na apuração.")).toBeTruthy();
  });

  test("cada opção mostra função, empresa (ou \"sem registro\") e a gorjeta líquida", () => {
    const { campo } = abrir();
    fireEvent.click(campo);
    const opcoes = screen.getAllByRole("option");
    expect(limpo(opcoes[0].textContent)).toContain("“Alvinho”·Cozinha·semregistro");
    expect(limpo(opcoes[0].textContent)).toContain("R$0,00");
    expect(limpo(opcoes[1].textContent)).toContain("Caixa·EmpresaB");
    expect(limpo(opcoes[1].textContent)).toContain("R$30,00");
    expect(limpo(opcoes[2].textContent)).toContain("Garçom·EmpresaA");
  });

  test("quem está fora da gorjeta mostra \"só salário\" no lugar do valor", () => {
    const { campo } = abrir("", [pessoa({ participantId: "x", nome: "Fora Teste", foraDaGorjeta: true, liquida: 0 })]);
    fireEvent.click(campo);
    expect(screen.getByText("só salário")).toBeTruthy();
  });

  test("clicar numa opção chama onEscolher com o id, grava como recente e fecha a lista", () => {
    const { campo, onEscolher } = abrir();
    fireEvent.click(campo);
    fireEvent.mouseDown(screen.getByText("Rosa Mariana"));
    expect(onEscolher).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("gorjeta-vales-recentes")!)).toEqual(["p1"]);
  });

  test("os usados por último vêm primeiro, com selo \"recente\", e sem repetir ids", () => {
    window.localStorage.setItem("gorjeta-vales-recentes", JSON.stringify(["p3", "p1"]));
    const { campo } = abrir();
    fireEvent.click(campo);
    expect(nomesDaLista()).toEqual(["Beatriz Ficticiarecente", "Rosa Marianarecente", "Álvaro Teste"]);
  });

  test("localStorage com lixo é ignorado", () => {
    window.localStorage.setItem("gorjeta-vales-recentes", "{não é json");
    const { campo } = abrir();
    fireEvent.click(campo);
    expect(nomesDaLista()).toHaveLength(3);
  });

  test("teclado: seta para baixo percorre e Enter escolhe; Esc fecha sem escolher", () => {
    const { campo, onEscolher } = abrir();
    fireEvent.click(campo);
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onEscolher).toHaveBeenCalledWith("p3");

    fireEvent.click(campo);
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onEscolher).toHaveBeenCalledTimes(1);
  });

  test("seta para cima não passa do primeiro e Enter sem opções não escolhe", () => {
    const { campo, onEscolher } = abrir();
    fireEvent.click(campo);
    fireEvent.keyDown(campo, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.change(campo, { target: { value: "zzzz" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onEscolher).not.toHaveBeenCalled();
  });

  test("com pessoa escolhida: mostra o nome no campo e o resumo com função, empresa e gorjeta líquida", () => {
    const { campo } = abrir("p1");
    expect(campo.value).toBe("Rosa Mariana");
    expect(limpo(document.body.textContent)).toContain("Garçom·EmpresaA·R$250,00degorjetalíquida");
  });

  test("escolhida fora da gorjeta: o resumo avisa que o vale sai do salário", () => {
    abrir("x", [pessoa({ participantId: "x", nome: "Fora Teste", funcao: "Copa", foraDaGorjeta: true })]);
    expect(screen.getByText(/fora da gorjeta: o vale sai do salário/)).toBeTruthy();
    expect(screen.queryByText(/de gorjeta líquida/)).toBeNull();
  });

  test("o botão de trocar limpa a escolha chamando onEscolher com texto vazio", () => {
    const { onEscolher } = abrir("p1");
    fireEvent.click(screen.getByRole("button", { name: "Trocar funcionário" }));
    expect(onEscolher).toHaveBeenCalledWith("");
  });

  test("sem pessoa escolhida não há botão de trocar nem resumo", () => {
    abrir();
    expect(screen.queryByRole("button", { name: "Trocar funcionário" })).toBeNull();
    expect(screen.queryByText(/de gorjeta líquida/)).toBeNull();
  });
});
