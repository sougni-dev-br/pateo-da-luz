import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EmAndamento } from "../EmAndamento";

const rascunho = (id: string, extra: Record<string, unknown> = {}) => ({
  id, itemCount: 3, summary: "FARINHA, OVO e mais 1", version: 2, date: "2026-10-15", shift: "MORNING",
  createdByName: "Ana", updatedByName: "Maria", createdAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T11:00:00Z", ...extra
});

const montar = (props: Partial<Parameters<typeof EmAndamento>[0]> = {}) => {
  const onAbrir = vi.fn();
  const onDescartar = vi.fn();
  render(<EmAndamento rascunhos={[rascunho("a"), rascunho("b")]} falhou={false} abertoId={null} onAbrir={onAbrir} onDescartar={onDescartar} onTentarDeNovo={vi.fn()} {...props} />);
  return { onAbrir, onDescartar };
};

describe("EmAndamento", () => {
  afterEach(cleanup);

  test("mostra quem mexeu por último e abre ou descarta o rascunho escolhido", () => {
    const { onAbrir, onDescartar } = montar();
    expect(screen.getAllByText(/por Maria/).length).toBe(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Continuar" })[1]);
    expect(onAbrir).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getAllByRole("button", { name: /Descartar a requisição/ })[0]);
    expect(onDescartar).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  test("o rascunho aberto agora não pode ser descartado por aqui", () => {
    montar({ abertoId: "a" });
    expect(screen.getByText(/aberta agora/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Descartar a requisição/ }).length).toBe(1);
  });

  test("lista vazia explica onde começar; falha oferece tentar de novo", () => {
    montar({ rascunhos: [] });
    expect(screen.getByText("Nenhuma requisição em andamento.")).toBeTruthy();
    cleanup();
    montar({ rascunhos: null, falhou: true });
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
});
