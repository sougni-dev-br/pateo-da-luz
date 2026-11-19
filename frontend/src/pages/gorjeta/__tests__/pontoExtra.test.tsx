import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EditorExtra, ExtraCelula } from "../PontoExtra";

describe("Célula do ponto extra", () => {
  test("sem extra e com permissão: botão para adicionar que chama onAbrir", () => {
    const onAbrir = vi.fn();
    render(<ExtraCelula extra={null} motivo={null} aberto={false} podeEditar rotulo="Pessoa Ficticia" onAbrir={onAbrir} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar ponto extra para Pessoa Ficticia" }));
    expect(onAbrir).toHaveBeenCalledTimes(1);
  });

  test("sem extra e sem permissão: só um traço, sem botão", () => {
    render(<ExtraCelula extra={null} motivo={null} aberto={false} podeEditar={false} rotulo="Pessoa Ficticia" onAbrir={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });

  test("extra positivo mostra + e o motivo; negativo mostra −", () => {
    const { rerender } = render(<ExtraCelula extra={1.5} motivo="fechou o caixa" aberto={false} podeEditar rotulo="Pessoa" onAbrir={vi.fn()} />);
    expect(screen.getByText("+1,5")).toBeTruthy();
    expect(screen.getByText("fechou o caixa")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ponto extra de Pessoa: \+1,5/ })).toBeTruthy();
    rerender(<ExtraCelula extra={-0.5} motivo="atraso" aberto={false} podeEditar rotulo="Pessoa" onAbrir={vi.fn()} />);
    expect(screen.getByText("−0,5")).toBeTruthy();
  });

  test("com extra mas sem permissão: o chip fica desabilitado", () => {
    const onAbrir = vi.fn();
    render(<ExtraCelula extra={1} motivo="m" aberto={false} podeEditar={false} rotulo="Pessoa" onAbrir={onAbrir} />);
    const chip = screen.getByRole("button", { name: /Ponto extra de Pessoa/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(onAbrir).not.toHaveBeenCalled();
  });

  test("aria-expanded acompanha o estado aberto", () => {
    render(<ExtraCelula extra={null} motivo={null} aberto podeEditar rotulo="P" onAbrir={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
  });
});

function editor(over: Partial<Parameters<typeof EditorExtra>[0]> = {}) {
  const props = { nome: "Pessoa Ficticia", pontosFuncao: 3, extra: null, motivo: null, salvando: false, onSalvar: vi.fn(), onCancelar: vi.fn(), ...over };
  render(<EditorExtra {...props} />);
  return {
    props,
    valor: screen.getByLabelText("Ponto extra de Pessoa Ficticia") as HTMLInputElement,
    just: screen.getByLabelText("Justificativa do ponto extra de Pessoa Ficticia") as HTMLInputElement,
    salvar: () => screen.getByText("Salvar extra").closest("button") as HTMLButtonElement,
  };
}

describe("Editor do ponto extra", () => {
  test("mostra a conta função + extra = total em tempo real", () => {
    const { valor } = editor();
    expect(screen.getByText("função 3")).toBeTruthy();
    expect(screen.getByText("3 pts")).toBeTruthy();
    fireEvent.change(valor, { target: { value: "1.5" } });
    expect(screen.getByText("+1,5")).toBeTruthy();
    expect(screen.getByText("4,5 pts")).toBeTruthy();
  });

  test("começa com Salvar desabilitado (vazio) e habilita com extra e justificativa válidos", () => {
    const { valor, just, salvar } = editor();
    expect(salvar().disabled).toBe(true);
    fireEvent.change(valor, { target: { value: "1" } });
    expect(salvar().disabled).toBe(true);
    fireEvent.change(just, { target: { value: "ajuda" } });
    expect(salvar().disabled).toBe(false);
  });

  test("justificativa com menos de 5 letras (ou só espaços) mantém desabilitado e orienta", () => {
    const { valor, just, salvar } = editor();
    fireEvent.change(valor, { target: { value: "1" } });
    fireEvent.change(just, { target: { value: "  ab  " } });
    expect(salvar().disabled).toBe(true);
    expect(screen.getByText(/Escreva a justificativa \(pelo menos 5 letras\)/)).toBeTruthy();
  });

  test("extra zero é inválido; texto não é aceito pelo campo numérico", () => {
    const { valor, just, salvar } = editor();
    fireEvent.change(just, { target: { value: "justificativa ok" } });
    fireEvent.change(valor, { target: { value: "0" } });
    expect(salvar().disabled).toBe(true);
    fireEvent.change(valor, { target: { value: "abc" } });
    expect(salvar().disabled).toBe(true);
  });

  test("extra que deixaria a pessoa negativa é bloqueado com aviso", () => {
    const { valor, just, salvar } = editor({ pontosFuncao: 1 });
    fireEvent.change(just, { target: { value: "justificativa ok" } });
    fireEvent.change(valor, { target: { value: "-2" } });
    expect(salvar().disabled).toBe(true);
    expect(screen.getByText("O extra não pode deixar a pessoa com pontos negativos.")).toBeTruthy();
    fireEvent.change(valor, { target: { value: "-1" } });
    expect(salvar().disabled).toBe(false);
  });

  test("sem pontos de função (null) conta como zero", () => {
    editor({ pontosFuncao: null });
    expect(screen.getByText("função 0")).toBeTruthy();
  });

  test("salvar envia o extra numérico e a justificativa sem espaços nas pontas", () => {
    const { valor, just, props } = editor();
    fireEvent.change(valor, { target: { value: "-0.5" } });
    fireEvent.change(just, { target: { value: "  chegou atrasado  " } });
    fireEvent.click(screen.getByText("Salvar extra"));
    expect(props.onSalvar).toHaveBeenCalledWith(-0.5, "chegou atrasado");
  });

  test("enviar o formulário ainda inválido não salva", () => {
    const { valor, props } = editor();
    fireEvent.change(valor, { target: { value: "1" } });
    fireEvent.submit(valor.closest("form")!);
    expect(props.onSalvar).not.toHaveBeenCalled();
  });

  test("com extra existente: abre preenchido e \"Tirar extra\" envia null, null", () => {
    const { valor, just, props } = editor({ extra: 2, motivo: "fechamento do caixa" });
    expect(valor.value).toBe("2");
    expect(just.value).toBe("fechamento do caixa");
    fireEvent.click(screen.getByText("Tirar extra"));
    expect(props.onSalvar).toHaveBeenCalledWith(null, null);
  });

  test("sem extra existente não oferece \"Tirar extra\"", () => {
    editor();
    expect(screen.queryByText("Tirar extra")).toBeNull();
  });

  test("salvando: Salvar e Tirar ficam desabilitados", () => {
    const { salvar } = editor({ extra: 2, motivo: "fechamento do caixa", salvando: true });
    expect(salvar().disabled).toBe(true);
    expect((screen.getByText("Tirar extra").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  test("cancelar chama onCancelar e não salva", () => {
    const { props } = editor();
    fireEvent.click(screen.getByText("cancelar"));
    expect(props.onCancelar).toHaveBeenCalledTimes(1);
    expect(props.onSalvar).not.toHaveBeenCalled();
  });
});
