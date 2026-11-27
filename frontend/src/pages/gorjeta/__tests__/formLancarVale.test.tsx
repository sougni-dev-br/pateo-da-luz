import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TipValeDescricao } from "../../../api/client";
import { FormLancarVale } from "../FormLancarVale";
import type { PessoaSelecionavel } from "../SeletorFuncionario";

const PESSOAS: PessoaSelecionavel[] = [
  { participantId: "p1", nome: "Ana Ficticia", apelido: "Aninha", funcao: "Garçom", empresa: "Empresa Teste", semRegistro: false, liquida: 100 },
  { participantId: "p2", nome: "Bruno Ficticio", funcao: "Cozinha", empresa: null, semRegistro: true, liquida: 50 },
];
const DESCRICOES: TipValeDescricao[] = [
  { id: "d1", texto: "Adiantamento para transporte", tipo: "ADIANTAMENTO", ativo: true },
  { id: "d2", texto: "Refeição extra", tipo: "REFEICAO", ativo: true },
  { id: "d3", texto: "Ajuste geral", tipo: null, ativo: true },
  { id: "d4", texto: "Texto desativado", tipo: "ADIANTAMENTO", ativo: false },
];

function montar(over: Partial<React.ComponentProps<typeof FormLancarVale>> = {}) {
  const onLancar = vi.fn().mockResolvedValue(true);
  const props = { pessoas: PESSOAS, descricoes: DESCRICOES, pessoaInicial: "p1", ocupado: false, onLancar, onDescricoesMudaram: vi.fn(), onErro: vi.fn(), ...over };
  render(<FormLancarVale {...props} />);
  return { onLancar, props };
}
const botaoLancar = () => screen.getByRole("button", { name: "Lançar vale" }) as HTMLButtonElement;
const campoValor = () => screen.getByLabelText("Valor (R$)") as HTMLInputElement;
const digitar = (campo: HTMLElement, v: string) => fireEvent.change(campo, { target: { value: v } });
const clicar = (el: HTMLElement) => fireEvent.click(el);
const areaSugestoes = () => screen.getByLabelText("Descrições prontas", { selector: "div" });

beforeEach(() => window.localStorage.clear());

describe("Formulário de lançar vale", () => {
  test("sem funcionário ou sem valor, o botão fica desabilitado", () => {
    montar({ pessoaInicial: "" });
    expect(screen.getByText("Escolha o funcionário.")).toBeTruthy();
    expect(botaoLancar().disabled).toBe(true);
    digitar(campoValor(), "10");
    expect(botaoLancar().disabled).toBe(true);
  });

  test("com funcionário mas valor zero ou vazio, continua desabilitado", () => {
    montar();
    expect(botaoLancar().disabled).toBe(true);
    digitar(campoValor(), "0");
    expect(botaoLancar().disabled).toBe(true);
    digitar(campoValor(), "5");
    expect(botaoLancar().disabled).toBe(false);
  });

  test("ocupado desabilita o botão mesmo com tudo preenchido", () => {
    montar({ ocupado: true });
    digitar(campoValor(), "10");
    expect(botaoLancar().disabled).toBe(true);
  });

  test("envia o payload com valor numérico, tipo e descrição sem espaços nas pontas", () => {
    const { onLancar } = montar();
    digitar(campoValor(), "25.5");
    digitar(screen.getByLabelText("Descrição"), "  Transporte  ");
    digitar(screen.getByLabelText("Data"), "2026-09-10");
    clicar(botaoLancar());
    expect(onLancar).toHaveBeenCalledWith({ participantId: "p1", type: "ADIANTAMENTO", amount: 25.5, date: "2026-09-10", notes: "Transporte", imprimir: false });
  });

  test("depois de lançar com sucesso limpa valor e descrição, mantendo pessoa e tipo", async () => {
    const { onLancar } = montar();
    clicar(screen.getByRole("radio", { name: "Refeição" }));
    digitar(campoValor(), "12");
    digitar(screen.getByLabelText("Descrição"), "Almoço");
    clicar(botaoLancar());
    await waitFor(() => expect(campoValor().value).toBe(""));
    expect((screen.getByLabelText("Descrição") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("radio", { name: "Refeição" }).getAttribute("aria-checked")).toBe("true");
    expect(onLancar).toHaveBeenCalledTimes(1);
  });

  test("se o lançamento falha, o que foi digitado continua no formulário", async () => {
    const onLancar = vi.fn().mockResolvedValue(false);
    montar({ onLancar });
    digitar(campoValor(), "12");
    clicar(botaoLancar());
    await waitFor(() => expect(onLancar).toHaveBeenCalled());
    await Promise.resolve();
    expect(campoValor().value).toBe("12");
  });

  test("mostra a gorjeta líquida depois do vale e avisa quando passa da gorjeta", () => {
    montar();
    expect(document.body.textContent).toMatch(/Aninha: gorjeta líquida R\$\s*100,00/);
    digitar(campoValor(), "30");
    expect(document.body.textContent).toMatch(/R\$\s*70,00\s*depois deste vale/);
    expect(screen.queryByRole("alert")).toBeNull();
    digitar(campoValor(), "130");
    expect(document.body.textContent).toMatch(/-R\$\s*30,00\s*depois deste vale/);
    expect(screen.getByRole("alert").textContent).toContain("passa da gorjeta");
  });

  test("crédito soma à gorjeta, desabilita o recibo e não pede impressão", () => {
    const { onLancar } = montar();
    window.localStorage.setItem("gorjeta-vales-imprimir", "sim");
    clicar(screen.getByRole("radio", { name: "Crédito" }));
    digitar(campoValor(), "20");
    expect(document.body.textContent).toMatch(/R\$\s*120,00\s*depois deste vale/);
    expect(screen.getByText("Crédito não tem recibo")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    clicar(botaoLancar());
    expect(onLancar.mock.calls[0][0]).toMatchObject({ type: "CREDITO", amount: 20, imprimir: false });
  });

  test("a escolha de imprimir recibo é lembrada e vai no payload", () => {
    const { onLancar } = montar();
    clicar(screen.getByRole("checkbox"));
    expect(window.localStorage.getItem("gorjeta-vales-imprimir")).toBe("sim");
    digitar(campoValor(), "5");
    clicar(botaoLancar());
    expect(onLancar.mock.calls[0][0].imprimir).toBe(true);
  });

  test("sugestões: só as ativas do tipo atual e as de todos os tipos; clicar preenche a descrição", () => {
    montar();
    const area = areaSugestoes();
    expect(within(area).getByText("Adiantamento para transporte")).toBeTruthy();
    expect(within(area).getByText("Ajuste geral")).toBeTruthy();
    expect(within(area).queryByText("Refeição extra")).toBeNull();
    expect(within(area).queryByText("Texto desativado")).toBeNull();
    clicar(within(area).getByText("Adiantamento para transporte"));
    expect((screen.getByLabelText("Descrição") as HTMLInputElement).value).toBe("Adiantamento para transporte");
    // escolhida a sugestão, as outras continuam à vista
    expect(within(areaSugestoes()).getByText("Ajuste geral")).toBeTruthy();
  });

  test("digitar na descrição filtra as sugestões", () => {
    montar();
    digitar(screen.getByLabelText("Descrição"), "transp");
    const area = areaSugestoes();
    expect(within(area).getByText("Adiantamento para transporte")).toBeTruthy();
    expect(within(area).queryByText("Ajuste geral")).toBeNull();
  });

  test("trocar o tipo troca as sugestões", () => {
    montar();
    clicar(screen.getByRole("radio", { name: "Refeição" }));
    const area = areaSugestoes();
    expect(within(area).getByText("Refeição extra")).toBeTruthy();
    expect(within(area).queryByText("Adiantamento para transporte")).toBeNull();
  });

  test("o botão Descrições prontas abre e fecha o cadastro", () => {
    montar();
    expect(screen.queryByRole("region", { name: "Descrições prontas" })).toBeNull();
    clicar(screen.getByRole("button", { name: /Descrições prontas/ }));
    expect(screen.getByRole("region", { name: "Descrições prontas" })).toBeTruthy();
    clicar(screen.getByRole("button", { name: "Fechar descrições prontas" }));
    expect(screen.queryByRole("region", { name: "Descrições prontas" })).toBeNull();
  });
});
