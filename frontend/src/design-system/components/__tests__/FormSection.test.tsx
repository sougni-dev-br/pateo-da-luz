import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FormSection } from "../FormSection";

describe("FormSection", () => {
  test("renderiza eyebrow, título, descrição e children", () => {
    render(
      <FormSection
        eyebrow="Cadastro operacional"
        title="Dados do fornecedor"
        description="Informações fiscais e de contato."
      >
        <span>conteúdo</span>
      </FormSection>
    );
    expect(screen.getByText("Cadastro operacional")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dados do fornecedor" })).toBeInTheDocument();
    expect(screen.getByText("Informações fiscais e de contato.")).toBeInTheDocument();
    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });

  test("actions renderizam no cabeçalho", () => {
    render(
      <FormSection title="X" actions={<button type="button">Limpar</button>}>
        <span>y</span>
      </FormSection>
    );
    expect(screen.getByRole("button", { name: "Limpar" })).toBeInTheDocument();
  });

  test("eyebrow e descrição são opcionais", () => {
    const { container } = render(
      <FormSection title="Só título">
        <span>y</span>
      </FormSection>
    );
    expect(container.querySelector(".ds-form-section-eyebrow")).toBeNull();
    expect(container.querySelector(".ds-form-section-description")).toBeNull();
  });
});
