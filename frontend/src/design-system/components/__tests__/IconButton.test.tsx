import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Pencil } from "lucide-react";
import { IconButton } from "../IconButton";

describe("IconButton", () => {
  test("renderiza com aria-label e title a partir de label", () => {
    render(<IconButton icon={<Pencil size={16} />} label="Editar" />);
    const btn = screen.getByRole("button", { name: "Editar" });
    expect(btn.getAttribute("title")).toBe("Editar");
    expect(btn.className).toContain("ds-icon-button-md");
  });

  test("onClick dispara", () => {
    const onClick = vi.fn();
    render(<IconButton icon={<Pencil size={16} />} label="Editar" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("variant danger e size sm aplicam classes", () => {
    render(<IconButton icon={<Pencil size={16} />} label="Excluir" variant="danger" size="sm" />);
    const btn = screen.getByRole("button", { name: "Excluir" });
    expect(btn.className).toContain("ds-icon-button-danger");
    expect(btn.className).toContain("ds-icon-button-sm");
  });

  test("disabled propaga e type default é button", () => {
    render(<IconButton icon={<Pencil size={16} />} label="Editar" disabled />);
    const btn = screen.getByRole("button", { name: "Editar" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("type")).toBe("button");
  });
});
