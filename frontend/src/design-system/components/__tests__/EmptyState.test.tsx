import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  test("renderiza titulo", () => {
    render(<EmptyState title="Sem resultados" />);
    expect(screen.getByText("Sem resultados")).toBeInTheDocument();
  });

  test("renderiza description quando fornecida", () => {
    render(<EmptyState title="t" description="d" />);
    expect(screen.getByText("d")).toBeInTheDocument();
  });

  test("nao renderiza description quando ausente", () => {
    const { container } = render(<EmptyState title="t" />);
    expect(container.querySelector("p")).toBeNull();
  });

  test("renderiza action quando fornecida", () => {
    render(<EmptyState title="t" action={<button>Adicionar</button>} />);
    expect(screen.getByRole("button", { name: "Adicionar" })).toBeInTheDocument();
  });

  test("classe raiz ds-empty-state", () => {
    render(<EmptyState title="t" />);
    expect(screen.getByText("t").parentElement?.className).toContain("ds-empty-state");
  });
});
