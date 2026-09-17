import { fireEvent, render, screen } from "@testing-library/react";
import { LayoutDashboard, ReceiptText } from "lucide-react";
import { describe, expect, test, vi } from "vitest";
import { Sidebar } from "../Sidebar";
import type { SidebarSectionGroup } from "../types";

const GROUPS: SidebarSectionGroup[] = [
  { group: "Visão geral", items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  { group: "Operação", items: [{ id: "purchases", label: "Compras", icon: ReceiptText }] }
];

const baseProps = {
  groups: GROUPS,
  activeId: "dashboard",
  user: { name: "Rafael Oliveira", role: "ADMIN" },
  favorites: [],
  onNavigate: () => undefined,
  onToggleFavorite: () => undefined,
  hideValues: false,
  onToggleValues: () => undefined,
  onLogout: () => undefined
};

describe("Sidebar", () => {
  test("renderiza <aside> com aria-label", () => {
    render(<Sidebar {...baseProps} />);
    const aside = screen.getByRole("complementary");
    expect(aside.getAttribute("aria-label")).toBe("Menu lateral");
    expect(aside.tagName).toBe("ASIDE");
  });

  test("renderiza brand block com Pateo da Luz e tag default", () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText("Pateo da Luz")).toBeInTheDocument();
    expect(screen.getByText("Gestão eficiente")).toBeInTheDocument();
  });

  test("aceita tagline customizada", () => {
    render(<Sidebar {...baseProps} tagline="Retaguarda" />);
    expect(screen.getByText("Retaguarda")).toBeInTheDocument();
  });

  test("renderiza user name e role no footer", () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText("Rafael Oliveira")).toBeInTheDocument();
    expect(screen.getByText("ADMIN")).toBeInTheDocument();
  });

  test("toggle de valores mostra o label correto conforme hideValues", () => {
    const { rerender } = render(<Sidebar {...baseProps} hideValues={false} />);
    expect(screen.getByRole("button", { name: "Ocultar valores" })).toBeInTheDocument();
    rerender(<Sidebar {...baseProps} hideValues={true} />);
    expect(screen.getByRole("button", { name: "Mostrar valores" })).toBeInTheDocument();
  });

  test("toggle de valores tem aria-pressed sincronizado", () => {
    const { rerender } = render(<Sidebar {...baseProps} hideValues={false} />);
    const toggle = screen.getByRole("button", { name: /valores/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    rerender(<Sidebar {...baseProps} hideValues={true} />);
    expect(screen.getByRole("button", { name: /valores/ }).getAttribute("aria-pressed")).toBe("true");
  });

  test("dispara onToggleValues ao clicar no toggle", () => {
    const onToggleValues = vi.fn();
    render(<Sidebar {...baseProps} onToggleValues={onToggleValues} />);
    fireEvent.click(screen.getByRole("button", { name: /valores/ }));
    expect(onToggleValues).toHaveBeenCalledTimes(1);
  });

  test("dispara onLogout ao clicar em Sair", () => {
    const onLogout = vi.fn();
    render(<Sidebar {...baseProps} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole("button", { name: /Sair/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test("favoritos aparecem como grupo no topo quando >0", () => {
    render(<Sidebar {...baseProps} favorites={["purchases"]} />);
    expect(screen.getByText("Favoritos")).toBeInTheDocument();
    // "Compras" aparece 2x: no grupo Favoritos + no grupo Operação
    expect(screen.getAllByRole("button", { name: /Compras/ }).length).toBe(2);
  });

  test("showDevBadge=true renderiza DEV badge", () => {
    const { container } = render(<Sidebar {...baseProps} showDevBadge />);
    const badge = container.querySelector(".ds-sidebar-dev-badge");
    expect(badge?.textContent).toBe("DEV");
  });

  test("showDevBadge=false (default) nao renderiza DEV badge", () => {
    const { container } = render(<Sidebar {...baseProps} />);
    expect(container.querySelector(".ds-sidebar-dev-badge")).toBeNull();
  });

  test("delega para SidebarNav (encontra items de nav)", () => {
    render(<Sidebar {...baseProps} activeId="purchases" />);
    const active = screen.getByRole("button", { name: /Compras/ });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  test("onNavigate propaga do SidebarNav interno", () => {
    const onNavigate = vi.fn();
    render(<Sidebar {...baseProps} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Compras/ }));
    expect(onNavigate).toHaveBeenCalledWith("purchases");
  });
});

describe("Sidebar recolhida", () => {
  test("sem onToggleCollapse nao mostra o botao (caso do drawer mobile)", () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole("button", { name: /recolher menu/i })).not.toBeInTheDocument();
  });

  test("o botao diz o que vai acontecer, nao o estado atual", () => {
    const { rerender } = render(<Sidebar {...baseProps} onToggleCollapse={() => undefined} />);
    expect(screen.getByRole("button", { name: "Recolher menu lateral" })).toHaveAttribute("aria-expanded", "true");

    rerender(<Sidebar {...baseProps} collapsed onToggleCollapse={() => undefined} />);
    expect(screen.getByRole("button", { name: "Expandir menu lateral" })).toHaveAttribute("aria-expanded", "false");
  });

  test("clicar avisa o caller, que e' quem guarda o estado", () => {
    const aoRecolher = vi.fn();
    render(<Sidebar {...baseProps} onToggleCollapse={aoRecolher} />);
    fireEvent.click(screen.getByRole("button", { name: "Recolher menu lateral" }));
    expect(aoRecolher).toHaveBeenCalledTimes(1);
  });

  test("recolhida esconde os rotulos mas os itens continuam alcancaveis por nome", () => {
    render(<Sidebar {...baseProps} collapsed onToggleCollapse={() => undefined} />);
    // O texto sai da tela...
    expect(screen.queryByText("Compras")).not.toBeInTheDocument();
    // ...mas o leitor de tela e o teclado ainda chegam no item.
    expect(screen.getByRole("button", { name: "Compras" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  test("recolhida nao esconde sair nem o controle de valores", () => {
    render(<Sidebar {...baseProps} collapsed onToggleCollapse={() => undefined} />);
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar valores" })).toBeInTheDocument();
  });

  test("recolhida some com o nome do usuario, que nao cabe em 72px", () => {
    render(<Sidebar {...baseProps} collapsed onToggleCollapse={() => undefined} />);
    expect(screen.queryByText("Rafael Oliveira")).not.toBeInTheDocument();
  });
});
