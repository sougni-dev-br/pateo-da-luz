import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { useConfirmacao, type PedidoConfirmacao } from "../Confirmacao";

// jsdom não implementa <dialog>.showModal/close
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
});

function Tela({ pedido, aoResponder }: { pedido: PedidoConfirmacao; aoResponder: (ok: boolean) => void }) {
  const { confirmar, caixa } = useConfirmacao();
  return (
    <div>
      <button type="button" onClick={async () => aoResponder(await confirmar(pedido))}>Apagar</button>
      {caixa}
    </div>
  );
}

function abrir(pedido: Partial<PedidoConfirmacao> = {}) {
  const aoResponder = vi.fn();
  render(<Tela pedido={{ titulo: "Apagar o lançamento?", confirmar: "Sim, apagar", ...pedido }} aoResponder={aoResponder} />);
  return aoResponder;
}

describe("Caixa de confirmação", () => {
  test("não aparece até alguém pedir", () => {
    abrir();
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull();
  });

  test("ao pedir, mostra título, texto e os dois botões", async () => {
    abrir({ texto: "Isso não pode ser desfeito." });
    fireEvent.click(screen.getByText("Apagar"));
    const caixa = await screen.findByRole("alertdialog", { hidden: true });
    expect(caixa.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Apagar o lançamento?", hidden: true })).toBeTruthy();
    expect(screen.getByText("Isso não pode ser desfeito.")).toBeTruthy();
    expect(screen.getByText("Voltar")).toBeTruthy();
    expect(screen.getByText("Sim, apagar")).toBeTruthy();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  test("sem texto, não liga aria-describedby", async () => {
    abrir();
    fireEvent.click(screen.getByText("Apagar"));
    const caixa = await screen.findByRole("alertdialog", { hidden: true });
    expect(caixa.getAttribute("aria-describedby")).toBeNull();
  });

  test("confirmar resolve true e fecha a caixa", async () => {
    const aoResponder = abrir();
    fireEvent.click(screen.getByText("Apagar"));
    fireEvent.click(await screen.findByText("Sim, apagar"));
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull();
  });

  test("Voltar resolve false e fecha a caixa", async () => {
    const aoResponder = abrir();
    fireEvent.click(screen.getByText("Apagar"));
    fireEvent.click(await screen.findByText("Voltar"));
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("alertdialog", { hidden: true })).toBeNull();
  });

  test("Esc (evento cancel do dialog) resolve false em vez de fechar sozinho", async () => {
    const aoResponder = abrir();
    fireEvent.click(screen.getByText("Apagar"));
    const caixa = await screen.findByRole("alertdialog", { hidden: true });
    await act(async () => { fireEvent(caixa, new Event("cancel", { cancelable: true, bubbles: false })); });
    await waitFor(() => expect(aoResponder).toHaveBeenCalledWith(false));
  });

  test("ação perigosa usa o botão de perigo; a comum usa o primário", async () => {
    const { unmount } = render(<Tela pedido={{ titulo: "t", confirmar: "Excluir", perigo: true }} aoResponder={vi.fn()} />);
    fireEvent.click(screen.getByText("Apagar"));
    const perigo = (await screen.findByText("Excluir")).closest("button")!;
    unmount();
    render(<Tela pedido={{ titulo: "t", confirmar: "Excluir" }} aoResponder={vi.fn()} />);
    fireEvent.click(screen.getByText("Apagar"));
    const comum = (await screen.findByText("Excluir")).closest("button")!;
    expect(perigo.className).not.toBe(comum.className);
  });
});
