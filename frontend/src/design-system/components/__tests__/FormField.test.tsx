import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FormField } from "../FormField";
import { TextField } from "../TextField";

describe("FormField", () => {
  test("injeta id no filho e associa label via htmlFor", () => {
    render(
      <FormField label="Razão social">
        <input />
      </FormField>
    );
    expect(screen.getByLabelText("Razão social")).toBeInTheDocument();
  });

  test("funciona com TextField do DS (id repassado ao input interno)", () => {
    render(
      <FormField label="CNPJ">
        <TextField placeholder="00.000.000/0000-00" />
      </FormField>
    );
    const input = screen.getByPlaceholderText("00.000.000/0000-00");
    expect(screen.getByText("CNPJ")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "12" } });
    expect((input as HTMLInputElement).value).toBe("12");
  });

  test("hint renderiza e vira aria-describedby do filho", () => {
    render(
      <FormField label="X" hint="Somente números">
        <input />
      </FormField>
    );
    const input = screen.getByLabelText("X");
    const helper = screen.getByText("Somente números");
    expect(input.getAttribute("aria-describedby")).toBe(helper.id);
  });

  test("error sobrescreve hint, marca aria-invalid e classe invalid", () => {
    const { container } = render(
      <FormField label="X" hint="ignorado" error="Campo obrigatório">
        <input />
      </FormField>
    );
    expect(screen.queryByText("ignorado")).not.toBeInTheDocument();
    expect(screen.getByText("Campo obrigatório")).toBeInTheDocument();
    expect(screen.getByLabelText("X").getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector(".ds-form-field-invalid")).not.toBeNull();
  });

  test("required renderiza asterisco", () => {
    const { container } = render(
      <FormField label="Nome" required>
        <input />
      </FormField>
    );
    expect(container.querySelector(".ds-form-field-required")).not.toBeNull();
  });

  test("inline aplica variante de layout", () => {
    const onChange = vi.fn();
    const { container } = render(
      <FormField label="Ativo" inline>
        <input type="checkbox" onChange={onChange} />
      </FormField>
    );
    expect(container.querySelector(".ds-form-field-inline")).not.toBeNull();
  });
});
