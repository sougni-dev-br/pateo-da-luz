import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { RowMenu } from "../RowMenu";

describe("RowMenu", () => {
  test("trigger renderiza com aria-label default", () => {
    render(<RowMenu items={[{ label: "Editar" }]} />);
    expect(screen.getByRole("button", { name: "Mais ações" })).toBeInTheDocument();
  });

  test("abre menu e dispara onClick do item", async () => {
    const onEdit = vi.fn();
    render(<RowMenu items={[{ label: "Editar", onClick: onEdit }]} label="Ações do fornecedor" />);
    const trigger = screen.getByRole("button", { name: "Ações do fornecedor" });
    // Radix abre via pointerdown (botão esquerdo) — clique simples não basta no jsdom.
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    const item = await screen.findByText("Editar");
    fireEvent.click(item);
    expect(onEdit).toHaveBeenCalled();
  });

  test("item danger recebe classe de tom", async () => {
    render(
      <RowMenu
        items={[{ label: "Editar" }, { separator: true }, { label: "Inativar", tone: "danger" }]}
      />
    );
    const trigger = screen.getByRole("button", { name: "Mais ações" });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    const danger = await screen.findByText("Inativar");
    expect(danger.className).toContain("ds-row-menu-item-danger");
  });
});
