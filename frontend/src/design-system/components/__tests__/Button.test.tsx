import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Button } from "../Button";

describe("Button", () => {
  test("renderiza com variant primary por padrao e tamanho md", () => {
    render(<Button>Salvar</Button>);
    const btn = screen.getByRole("button", { name: "Salvar" });
    expect(btn.className).toContain("ds-button");
    expect(btn.className).toContain("ds-button-primary");
    expect(btn.className).toContain("ds-button-md");
  });

  test("aplica variant secondary", () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole("button").className).toContain("ds-button-secondary");
  });

  test("aplica variant danger", () => {
    render(<Button variant="danger">Excluir</Button>);
    expect(screen.getByRole("button").className).toContain("ds-button-danger");
  });

  test("iconOnly=true aplica classe icon-only", () => {
    render(<Button variant="icon" aria-label="ver"><span>i</span></Button>);
    expect(screen.getByRole("button").className).toContain("ds-button-icon-only");
  });

  test("size sm aplica classe correspondente", () => {
    render(<Button size="sm">x</Button>);
    expect(screen.getByRole("button").className).toContain("ds-button-sm");
  });

  test("disabled propaga para o button HTML", () => {
    render(<Button disabled>x</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  test("type default e 'button' (nao submit acidental)", () => {
    render(<Button>x</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  test("onClick e disparado", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("leadingIcon renderiza antes do texto", () => {
    render(<Button leadingIcon={<span data-testid="icn">i</span>}>ok</Button>);
    const btn = screen.getByRole("button");
    expect(btn.firstChild).toBe(screen.getByTestId("icn"));
  });

  test("aceita className adicional", () => {
    render(<Button className="foo">x</Button>);
    expect(screen.getByRole("button").className).toContain("foo");
  });
});
