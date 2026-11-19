import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BuffetPot } from "../../../../api/client";

vi.mock("../../../../api/client", () => ({ saveBuffetPot: vi.fn() }));

import { saveBuffetPot } from "../../../../api/client";
import { PanelasBuffet } from "../PanelasBuffet";

const panela: BuffetPot = { id: "p1", code: "P01", name: "Inox 10 L", tareG: 2400, isActive: true };
const salvar = vi.mocked(saveBuffetPot);

const abrir = (aoMudar = vi.fn()) => {
  render(<PanelasBuffet panelas={[panela]} podeCriar podeEditar aoMudar={aoMudar} />);
  return aoMudar;
};

beforeEach(() => vi.clearAllMocks());

describe("cadastro de panela", () => {
  test("não pede código: o sistema numera", () => {
    abrir();
    expect(screen.queryByLabelText(/^Código/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Descrição/)).toBeInTheDocument();
  });

  test("descrição é obrigatória: sem ela nada é enviado", () => {
    abrir();
    fireEvent.change(screen.getByLabelText(/Peso vazia/), { target: { value: "2,35" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar panela" }));
    expect(screen.getByText(/Informe a descrição da panela/)).toBeInTheDocument();
    expect(salvar).not.toHaveBeenCalled();
  });

  test("envia descrição e peso em gramas, e mostra o código que o sistema deu", async () => {
    salvar.mockResolvedValue({ ...panela, id: "p2", code: "P02", name: "Alumínio" });
    const aoMudar = abrir();
    fireEvent.change(screen.getByLabelText(/Descrição/), { target: { value: "  Alumínio " } });
    fireEvent.change(screen.getByLabelText(/Peso vazia/), { target: { value: "2,35" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar panela" }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith({ name: "Alumínio", tareG: 2350 }));
    expect(await screen.findByText(/código P02/)).toBeInTheDocument();
    expect(aoMudar).toHaveBeenCalled();
    expect(screen.getByLabelText(/Descrição/)).toHaveValue("");
  });
});
