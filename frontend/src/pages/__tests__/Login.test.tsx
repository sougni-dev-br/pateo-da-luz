import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Login } from "../Login";

// Nada de rede: login e health check sao simulados.
const login = vi.fn();
const checkBackendHealth = vi.fn();
vi.mock("../../api/client", async () => {
  const real = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return {
    ApiError: real.ApiError,
    API_BASE_URL: "/api",
    BACKEND_TARGET_URL: "",
    login: (...args: unknown[]) => login(...args),
    checkBackendHealth: () => checkBackendHealth(),
  };
});

// Comportamento de producao: sem o painel de diagnostico do ambiente local.
vi.mock("../../utils/env", () => ({ isLocal: false, isStaging: false }));

const { ApiError } = await vi.importActual<typeof import("../../api/client")>("../../api/client");

function campoSenha() {
  return screen.getByLabelText("Senha", { selector: "input" }) as HTMLInputElement;
}

function preencherEEnviar(senha = "senha-errada") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "teste@exemplo.com" } });
  fireEvent.change(campoSenha(), { target: { value: senha } });
  fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("Login", () => {
  beforeEach(() => {
    login.mockReset();
    checkBackendHealth.mockReset().mockResolvedValue(true);
  });

  test("servidor online nao ocupa o formulario com alerta; o rodape do painel mostra o estado", async () => {
    render(<Login onLogin={vi.fn()} />);
    expect(await screen.findByText("Sistema online")).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível conectar/)).toBeNull();
  });

  test("servidor fora do ar mostra o alerta no formulario", async () => {
    checkBackendHealth.mockResolvedValue(false);
    render(<Login onLogin={vi.fn()} />);
    expect(await screen.findByText(/Não foi possível conectar ao servidor/)).toBeInTheDocument();
    expect(screen.getByText("Servidor indisponível no momento")).toBeInTheDocument();
  });

  test("durante o envio o botao vira 'Entrando…' e os campos travam", async () => {
    login.mockReturnValue(new Promise(() => undefined));
    render(<Login onLogin={vi.fn()} />);
    preencherEEnviar();
    const botao = await screen.findByRole("button", { name: "Entrando…" });
    expect(botao).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(campoSenha()).toBeDisabled();
  });

  test("senha recusada: erro anunciado e senha volta focada e selecionada", async () => {
    login.mockRejectedValue(new ApiError("Email ou senha inválidos.", 401));
    render(<Login onLogin={vi.fn()} />);
    preencherEEnviar("abc123");

    expect(await screen.findByRole("alert")).toHaveTextContent("Email ou senha inválidos.");
    const senha = campoSenha();
    await waitFor(() => expect(senha).toHaveFocus());
    expect(senha.selectionStart).toBe(0);
    expect(senha.selectionEnd).toBe("abc123".length);
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  test("voltar a digitar apaga o erro", async () => {
    login.mockRejectedValue(new ApiError("Email ou senha inválidos.", 401));
    render(<Login onLogin={vi.fn()} />);
    preencherEEnviar();
    await screen.findByRole("alert");

    fireEvent.change(campoSenha(), { target: { value: "outra" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("sessao aberta em outro lugar: oferece encerrar e reenvia com force", async () => {
    login.mockRejectedValueOnce(new ApiError("Já existe uma sessão ativa.", 409, { canForce: true }));
    login.mockResolvedValueOnce({ user: { id: "u1" } });
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);
    preencherEEnviar("certa");

    const encerrar = await screen.findByRole("button", { name: "Encerrar sessão anterior e entrar" });
    expect(campoSenha()).not.toHaveFocus();
    fireEvent.click(encerrar);

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ id: "u1" }));
    expect(login).toHaveBeenLastCalledWith("teste@exemplo.com", "certa", { force: true });
  });

  test("avisa Caps Lock ligado e some ao sair do campo", () => {
    render(<Login onLogin={vi.fn()} />);
    const senha = campoSenha();
    fireEvent.keyUp(senha, { key: "A", modifierCapsLock: true });
    expect(screen.getByText("Caps Lock está ligado")).toBeInTheDocument();

    fireEvent.keyUp(senha, { key: "a", modifierCapsLock: false });
    expect(screen.queryByText("Caps Lock está ligado")).toBeNull();

    fireEvent.keyUp(senha, { key: "A", modifierCapsLock: true });
    fireEvent.blur(senha);
    expect(screen.queryByText("Caps Lock está ligado")).toBeNull();
  });
});
