import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CapturaFoto } from "../CapturaFoto";

const parar = vi.fn();
const getUserMedia = vi.fn();

function streamFalso() {
  return { getTracks: () => [{ stop: parar }] } as unknown as MediaStream;
}

function montar(aberto = true) {
  const onFechar = vi.fn();
  const onConfirmar = vi.fn();
  const resultado = render(
    <CapturaFoto aberto={aberto} maximo={5} onFechar={onFechar} onConfirmar={onConfirmar} />,
  );
  return { ...resultado, onFechar, onConfirmar };
}

beforeEach(() => {
  parar.mockReset();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(streamFalso());
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  // jsdom não implementa play() em <video>.
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: () => Promise.resolve(), configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CapturaFoto — abertura", () => {
  test("não renderiza nada quando fechada, e não liga a câmera", () => {
    montar(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  test("pede a câmera traseira — é a que fotografa papel", async () => {
    montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    const pedido = getUserMedia.mock.calls[0][0];
    expect(pedido.video.facingMode).toEqual({ ideal: "environment" });
    expect(pedido.audio).toBe(false);
  });

  test("pede resolução alta — dígito borrado vira valor errado", async () => {
    montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(getUserMedia.mock.calls[0][0].video.width.ideal).toBeGreaterThanOrEqual(1920);
  });
});

describe("CapturaFoto — desliga a câmera", () => {
  test("para o stream ao desmontar (câmera não fica ligada)", async () => {
    const { unmount } = montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(parar).toHaveBeenCalled());
  });

  test("para o stream ao fechar a janela", async () => {
    const { rerender } = render(
      <CapturaFoto aberto maximo={5} onFechar={vi.fn()} onConfirmar={vi.fn()} />,
    );
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    rerender(<CapturaFoto aberto={false} maximo={5} onFechar={vi.fn()} onConfirmar={vi.fn()} />);

    await waitFor(() => expect(parar).toHaveBeenCalled());
  });
});

describe("CapturaFoto — quando a câmera não colabora", () => {
  test("permissão negada explica o que fazer", async () => {
    const erro = new Error("denied");
    erro.name = "NotAllowedError";
    getUserMedia.mockRejectedValue(erro);
    montar();

    expect(await screen.findByText(/Permissão de câmera negada/i)).toBeInTheDocument();
  });

  test("aparelho sem câmera diz isso, em vez de erro técnico", async () => {
    const erro = new Error("no device");
    erro.name = "NotFoundError";
    getUserMedia.mockRejectedValue(erro);
    montar();

    expect(await screen.findByText(/Nenhuma câmera encontrada/i)).toBeInTheDocument();
  });

  test("navegador sem suporte manda usar o seletor de arquivo", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    montar();

    expect(await screen.findByText(/não permite acessar a câmera/i)).toBeInTheDocument();
  });

  test("com erro, o botão de tirar foto fica desabilitado", async () => {
    const erro = new Error("denied");
    erro.name = "NotAllowedError";
    getUserMedia.mockRejectedValue(erro);
    montar();

    await screen.findByText(/Permissão de câmera negada/i);
    expect(screen.getByRole("button", { name: /Tirar foto/i })).toBeDisabled();
  });
});

describe("CapturaFoto — orientação ao usuário", () => {
  test("diz como enquadrar e quantas fotos cabem", async () => {
    montar();
    expect(await screen.findByText(/documento inteiro na moldura/i)).toBeInTheDocument();
    expect(screen.getByText(/0 de 5/)).toBeInTheDocument();
  });
});

describe("CapturaFoto — tirar, revisar e usar", () => {
  /** jsdom não implementa canvas: simulamos o mínimo que a captura usa. */
  function habilitarCanvas() {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: () => ({ drawImage: () => undefined }),
      configurable: true,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      value: () => "data:image/jpeg;base64,/9j/fake",
      configurable: true,
    });
    // O vídeo precisa ter dimensão, senão o canvas sai 0x0.
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 1920, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 1080, configurable: true });
  }

  const obturador = () => screen.getByRole("button", { name: /Tirar foto/i });

  test("o contador começa zerado e anda a cada foto", async () => {
    habilitarCanvas();
    montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    expect(screen.getByText("0 de 5")).toBeInTheDocument();
    fireEvent.click(obturador());
    expect(await screen.findByText("1 de 5")).toBeInTheDocument();
  });

  test("cada foto vira uma miniatura que dá para descartar", async () => {
    habilitarCanvas();
    montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    fireEvent.click(obturador());
    fireEvent.click(obturador());
    expect(await screen.findByText("2 de 5")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Descartar foto 1/i));
    expect(await screen.findByText("1 de 5")).toBeInTheDocument();
  });

  test("o obturador trava ao atingir o limite, em vez de aceitar e descartar depois", async () => {
    habilitarCanvas();
    const onFechar = vi.fn();
    const onConfirmar = vi.fn();
    render(<CapturaFoto aberto maximo={2} onFechar={onFechar} onConfirmar={onConfirmar} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/i }));
    fireEvent.click(screen.getByRole("button", { name: /Tirar foto/i }));

    expect(await screen.findByRole("button", { name: /Limite de 2 fotos/i })).toBeDisabled();
  });

  test("usar as fotos entrega arquivos JPEG e fecha", async () => {
    habilitarCanvas();
    const { onConfirmar, onFechar } = montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    fireEvent.click(obturador());
    fireEvent.click(await screen.findByRole("button", { name: /Usar foto/i }));

    expect(onConfirmar).toHaveBeenCalledTimes(1);
    const arquivos = onConfirmar.mock.calls[0][0] as File[];
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0].type).toBe("image/jpeg");
    expect(arquivos[0].name).toMatch(/\.jpg$/);
    expect(onFechar).toHaveBeenCalled();
  });

  test("Esc fecha a câmera", async () => {
    const { onFechar } = montar();
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onFechar).toHaveBeenCalled();
  });
});
