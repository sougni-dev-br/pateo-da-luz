import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PageHeader } from "../PageHeader";

describe("PageHeader", () => {
  test("renderiza titulo em h1", () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });

  test("eyebrow em uppercase quando fornecido", () => {
    render(<PageHeader eyebrow="Pateo / Financeiro" title="X" />);
    expect(screen.getByText("Pateo / Financeiro").className).toContain("ds-page-header-eyebrow");
  });

  test("description renderiza quando fornecida", () => {
    render(<PageHeader title="X" description="desc" />);
    expect(screen.getByText("desc")).toBeInTheDocument();
  });

  test("actions ficam na direita quando fornecidas", () => {
    render(<PageHeader title="X" actions={<button>Novo</button>} />);
    expect(screen.getByRole("button", { name: "Novo" })).toBeInTheDocument();
  });

  test("classe raiz ds-page-header", () => {
    render(<PageHeader title="X" />);
    const h1 = screen.getByRole("heading", { level: 1 });
    // .ds-page-header > .ds-page-header-titles > h1 → 2 níveis acima
    expect(h1.parentElement?.parentElement?.className).toContain("ds-page-header");
  });
});
