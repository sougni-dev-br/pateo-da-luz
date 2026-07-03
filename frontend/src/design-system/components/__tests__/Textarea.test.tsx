import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Textarea } from "../Textarea";

describe("Textarea", () => {
  test("renderiza textarea e associa label via htmlFor/id", () => {
    render(<Textarea label="Observações" />);
    expect(screen.getByLabelText("Observações")).toBeInTheDocument();
  });

  test("hint renderiza abaixo do campo", () => {
    render(<Textarea label="X" hint="Máx. 500 caracteres" />);
    expect(screen.getByText("Máx. 500 caracteres")).toBeInTheDocument();
  });

  test("error sobrescreve hint e marca aria-invalid", () => {
    render(<Textarea label="X" hint="ignorado" error="Campo obrigatório" />);
    expect(screen.queryByText("ignorado")).not.toBeInTheDocument();
    expect(screen.getByText("Campo obrigatório")).toBeInTheDocument();
    const el = screen.getByRole("textbox");
    expect(el.className).toContain("ds-textarea-input-error");
    expect(el.getAttribute("aria-invalid")).toBe("true");
  });

  test("onChange dispara", () => {
    const onChange = vi.fn();
    render(<Textarea label="X" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalled();
  });

  test("rows default 3 e disabled propagam", () => {
    render(<Textarea label="X" disabled />);
    const el = screen.getByLabelText("X") as HTMLTextAreaElement;
    expect(el.rows).toBe(3);
    expect(el).toBeDisabled();
  });
});
