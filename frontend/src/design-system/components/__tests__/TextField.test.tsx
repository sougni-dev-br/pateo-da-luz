import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TextField } from "../TextField";

describe("TextField", () => {
  test("renderiza input e associa label via htmlFor/id", () => {
    render(<TextField label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  test("hint renderiza abaixo do input", () => {
    render(<TextField label="X" hint="Formato: user@dominio.com" />);
    expect(screen.getByText("Formato: user@dominio.com")).toBeInTheDocument();
  });

  test("error sobrescreve hint e adiciona classe de erro no input", () => {
    render(<TextField label="X" hint="ignorado" error="Campo obrigatorio" />);
    expect(screen.queryByText("ignorado")).not.toBeInTheDocument();
    expect(screen.getByText("Campo obrigatorio")).toBeInTheDocument();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.className).toContain("ds-text-field-input-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  test("onChange dispara com valor", () => {
    const onChange = vi.fn();
    render(<TextField label="X" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalled();
  });

  test("disabled propaga", () => {
    render(<TextField label="X" disabled />);
    expect(screen.getByLabelText("X")).toBeDisabled();
  });
});
