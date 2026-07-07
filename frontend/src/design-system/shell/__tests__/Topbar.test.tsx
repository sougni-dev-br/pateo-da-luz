import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Topbar } from "../Topbar";

const baseProps = {
  breadcrumb: ["Pateo da Luz", "Financeiro", "Contas a pagar"],
  hideValues: false,
  onToggleValues: () => undefined
};

describe("Topbar", () => {
  test("renderiza breadcrumb com ultimo item em <strong>", () => {
    render(<Topbar {...baseProps} />);
    expect(screen.getByText("Pateo da Luz")).toBeInTheDocument();
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    const current = screen.getByText("Contas a pagar");
    expect(current.tagName).toBe("STRONG");
  });

  test("breadcrumb tem role navigation com aria-label", () => {
    render(<Topbar {...baseProps} />);
    const nav = screen.getByRole("navigation", { name: "Localização atual" });
    expect(nav).toBeInTheDocument();
  });

  test("sem props de busca nem period, so aparece breadcrumb e toggle de valores", () => {
    render(<Topbar {...baseProps} />);
    expect(screen.queryByLabelText("Buscar")).toBeNull();
    expect(screen.queryByRole("button", { name: /Período atual/ })).toBeNull();
  });

  test("busca renderiza quando onSearchChange e fornecido", () => {
    const onSearchChange = vi.fn();
    render(<Topbar {...baseProps} onSearchChange={onSearchChange} />);
    const input = screen.getByLabelText("Buscar") as HTMLInputElement;
    expect(input.placeholder).toBe("Buscar fornecedor, NF, produto…");
  });

  test("busca aceita placeholder customizado quando visivel", () => {
    const onSearchChange = vi.fn();
    render(<Topbar {...baseProps} onSearchChange={onSearchChange} searchPlaceholder="Digite CNPJ" />);
    const input = screen.getByLabelText("Buscar") as HTMLInputElement;
    expect(input.placeholder).toBe("Digite CNPJ");
  });

  test("busca controlada dispara onSearchChange", () => {
    const onSearchChange = vi.fn();
    render(<Topbar {...baseProps} searchValue="" onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "abc" } });
    expect(onSearchChange).toHaveBeenCalledWith("abc");
  });

  test("toggle valores mostra Eye quando hideValues=false e EyeOff quando true", () => {
    const { rerender, container } = render(<Topbar {...baseProps} hideValues={false} />);
    expect(container.querySelector('[aria-label="Ocultar valores"]')).not.toBeNull();
    rerender(<Topbar {...baseProps} hideValues={true} />);
    expect(container.querySelector('[aria-label="Mostrar valores"]')).not.toBeNull();
  });

  test("toggle valores tem aria-pressed correto", () => {
    const { rerender } = render(<Topbar {...baseProps} hideValues={false} />);
    expect(screen.getByRole("button", { name: /valores/ }).getAttribute("aria-pressed")).toBe("false");
    rerender(<Topbar {...baseProps} hideValues={true} />);
    expect(screen.getByRole("button", { name: /valores/ }).getAttribute("aria-pressed")).toBe("true");
  });

  test("toggle valores dispara callback ao clicar", () => {
    const onToggleValues = vi.fn();
    render(<Topbar {...baseProps} onToggleValues={onToggleValues} />);
    fireEvent.click(screen.getByRole("button", { name: /valores/ }));
    expect(onToggleValues).toHaveBeenCalledTimes(1);
  });

  test("period pill mostra texto e dispara onPeriodClick quando ambos fornecidos", () => {
    const onPeriodClick = vi.fn();
    render(<Topbar {...baseProps} period="Julho 2026" onPeriodClick={onPeriodClick} />);
    const btn = screen.getByRole("button", { name: /Julho 2026/ });
    fireEvent.click(btn);
    expect(onPeriodClick).toHaveBeenCalledTimes(1);
  });

  test("period pill fica disabled quando onPeriodClick esta ausente", () => {
    render(<Topbar {...baseProps} period="Julho 2026" />);
    const btn = screen.getByRole("button", { name: /Julho 2026/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
