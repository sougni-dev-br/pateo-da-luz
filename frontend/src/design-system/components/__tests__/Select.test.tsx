import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Select } from "../Select";

const OPTIONS = [
  { value: "a", label: "Opcao A" },
  { value: "b", label: "Opcao B" }
];

describe("Select", () => {
  test("renderiza opcoes", () => {
    render(<Select label="Fornecedor" options={OPTIONS} onChange={() => undefined} />);
    expect(screen.getByRole("option", { name: "Opcao A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Opcao B" })).toBeInTheDocument();
  });

  test("placeholder aparece como option vazia", () => {
    render(<Select label="X" options={OPTIONS} placeholder="Selecione" />);
    expect(screen.getByRole("option", { name: "Selecione" })).toBeInTheDocument();
  });

  test("classe placeholder aplica quando value vazio", () => {
    render(<Select label="X" options={OPTIONS} placeholder="Selecione" value="" onChange={() => undefined} />);
    const select = screen.getByLabelText("X") as HTMLSelectElement;
    expect(select.className).toContain("ds-select-native-placeholder");
  });

  test("classe placeholder nao aplica quando value definido", () => {
    render(<Select label="X" options={OPTIONS} value="a" onChange={() => undefined} />);
    const select = screen.getByLabelText("X") as HTMLSelectElement;
    expect(select.className).not.toContain("ds-select-native-placeholder");
  });

  test("error aplica classe de erro e aria-invalid", () => {
    render(<Select label="X" options={OPTIONS} error="Escolha uma opcao" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.className).toContain("ds-select-native-error");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Escolha uma opcao")).toBeInTheDocument();
  });

  test("onChange dispara ao trocar", () => {
    const onChange = vi.fn();
    render(<Select label="X" options={OPTIONS} value="a" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalled();
  });

  test("caret ChevronDown renderiza como SVG aria-hidden", () => {
    const { container } = render(<Select label="X" options={OPTIONS} />);
    const caret = container.querySelector('[aria-hidden="true"]');
    expect(caret?.querySelector("svg")).not.toBeNull();
  });
});
