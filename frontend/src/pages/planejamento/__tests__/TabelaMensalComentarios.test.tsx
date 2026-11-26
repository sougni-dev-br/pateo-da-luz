import { render, screen } from "@testing-library/react";
import { acoes } from "./acoes";
import { describe, expect, it, vi } from "vitest";
import type { LigacaoDeComentarios } from "../comentarios/ligacao";
import { agruparPorPonto } from "../comentarios/ponto";
import { TabelaMensal } from "../TabelaMensal";
import { comentarioFicticio, comparativoFicticio } from "./fixturesComentarios";

const ligar = (podeEscrever: boolean, abrir = vi.fn()): LigacaoDeComentarios => {
  const todos = [comentarioFicticio({ id: "a" }), comentarioFicticio({ id: "b" }), comentarioFicticio({ id: "c", mes: null, turno: "JANTAR" })];
  return { todos, porPonto: agruparPorPonto(todos), podeEscrever, abrir };
};

describe("TabelaMensal com comentários", () => {
  it("marca com a contagem e o rótulo completo; clicar abre a gaveta no ponto", async () => {
    const abrir = vi.fn();
    render(<TabelaMensal dados={comparativoFicticio()} grandeza="vendas" comentarios={ligar(true, abrir)} />);
    const marca = screen.getByRole("button", { name: "2 comentários em Out/2026 · Vendas. Abrir" });
    expect(marca).toHaveTextContent("2");
    await acoes.click(marca);
    expect(abrir).toHaveBeenCalledWith({ mes: 10, metrica: "VENDAS", turno: "TOTAL" });
    expect(screen.getByRole("button", { name: "1 comentário em Ano inteiro · Vendas · jantar. Abrir" })).toBeInTheDocument();
  });

  it("só quem pode escrever ganha o + (fora do Tab)", () => {
    const { container, rerender } = render(<TabelaMensal dados={comparativoFicticio()} grandeza="vendas" comentarios={ligar(true)} />);
    expect(container.querySelectorAll(".plan-coment-marca-vazia").length).toBeGreaterThan(0);
    expect(container.querySelector(".plan-coment-marca-vazia")).toHaveAttribute("tabindex", "-1");
    rerender(<TabelaMensal dados={comparativoFicticio()} grandeza="vendas" comentarios={ligar(false)} />);
    expect(container.querySelectorAll(".plan-coment-marca-vazia")).toHaveLength(0);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});
