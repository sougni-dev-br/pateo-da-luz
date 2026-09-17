import { fireEvent, render, screen } from "@testing-library/react";
import { LayoutDashboard, ReceiptText, WalletCards } from "lucide-react";
import { describe, expect, test, vi } from "vitest";
import { SidebarNav, withFavoritesGroup } from "../SidebarNav";
import type { SidebarSectionGroup } from "../types";

const GROUPS: SidebarSectionGroup[] = [
  {
    group: "Visão geral",
    items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }]
  },
  {
    group: "Operação",
    items: [{ id: "purchases", label: "Compras", icon: ReceiptText }]
  },
  {
    group: "Financeiro",
    items: [{ id: "payables", label: "Contas a pagar", icon: WalletCards }]
  }
];

const noop = () => undefined;

describe("SidebarNav", () => {
  test("renderiza <nav> semantico com aria-label", () => {
    render(<SidebarNav groups={GROUPS} activeId="dashboard" favorites={[]} onNavigate={noop} onToggleFavorite={noop} />);
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBe("Navegação principal");
  });

  test("renderiza titulo de cada grupo e items como <button>", () => {
    render(<SidebarNav groups={GROUPS} activeId="dashboard" favorites={[]} onNavigate={noop} onToggleFavorite={noop} />);
    expect(screen.getByText("Visão geral")).toBeInTheDocument();
    expect(screen.getByText("Operação")).toBeInTheDocument();
    expect(screen.getByText("Financeiro")).toBeInTheDocument();
    // Cada section renderiza um <button> de nav + <button> de estrela.
    expect(screen.getAllByRole("button").length).toBe(6);
  });

  test("item ativo marca aria-current=page e classe active", () => {
    render(<SidebarNav groups={GROUPS} activeId="purchases" favorites={[]} onNavigate={noop} onToggleFavorite={noop} />);
    const active = screen.getByRole("button", { name: /Compras/ });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("ds-sidebar-nav-item-active");
    const inactive = screen.getByRole("button", { name: /Dashboard/ });
    expect(inactive.getAttribute("aria-current")).toBeNull();
    expect(inactive.className).not.toContain("ds-sidebar-nav-item-active");
  });

  test("onNavigate dispara com o id ao clicar no item", () => {
    const onNavigate = vi.fn();
    render(<SidebarNav groups={GROUPS} activeId="dashboard" favorites={[]} onNavigate={onNavigate} onToggleFavorite={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Compras/ }));
    expect(onNavigate).toHaveBeenCalledWith("purchases");
  });

  test("estrela de favorito tem aria-pressed refletindo o estado", () => {
    render(<SidebarNav groups={GROUPS} activeId="dashboard" favorites={["purchases"]} onNavigate={noop} onToggleFavorite={noop} />);
    const stars = screen.getAllByRole("button", { name: /favorito/i });
    // 3 estrelas — a de purchases deve estar pressed=true
    const pressed = stars.filter((s) => s.getAttribute("aria-pressed") === "true");
    expect(pressed.length).toBe(1);
  });

  test("onToggleFavorite dispara com id sem propagar para nav (stopPropagation)", () => {
    const onNavigate = vi.fn();
    const onToggleFavorite = vi.fn();
    render(<SidebarNav groups={GROUPS} activeId="dashboard" favorites={[]} onNavigate={onNavigate} onToggleFavorite={onToggleFavorite} />);
    const star = screen.getAllByRole("button", { name: /Adicionar aos favoritos/ })[0];
    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledWith("dashboard");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test("badges numericos aparecem no item correto com valor", () => {
    render(
      <SidebarNav
        groups={GROUPS}
        activeId="dashboard"
        favorites={[]}
        onNavigate={noop}
        onToggleFavorite={noop}
        badges={{ purchases: 3 }}
      />
    );
    const badge = screen.getByText("3");
    expect(badge.className).toContain("ds-sidebar-nav-item-badge");
  });

  test("badge=0 nao renderiza", () => {
    const { container } = render(
      <SidebarNav
        groups={GROUPS}
        activeId="dashboard"
        favorites={[]}
        onNavigate={noop}
        onToggleFavorite={noop}
        badges={{ purchases: 0 }}
      />
    );
    expect(container.querySelector(".ds-sidebar-nav-item-badge")).toBeNull();
  });
});

describe("withFavoritesGroup", () => {
  test("retorna grupos originais quando favorites vazio", () => {
    const out = withFavoritesGroup(GROUPS, []);
    expect(out).toBe(GROUPS);
  });

  test("prepende grupo Favoritos com items filtrados", () => {
    const out = withFavoritesGroup(GROUPS, ["purchases"]);
    expect(out[0].group).toBe("Favoritos");
    expect(out[0].items.map((i) => i.id)).toEqual(["purchases"]);
    expect(out.length).toBe(GROUPS.length + 1);
  });

  test("ignora favorites que nao existem", () => {
    const out = withFavoritesGroup(GROUPS, ["inexistente"]);
    expect(out).toBe(GROUPS);
  });
});

describe("SidebarNav recolhida", () => {
  const props = {
    groups: GROUPS,
    activeId: "dashboard",
    favorites: [] as string[],
    onNavigate: () => undefined,
    onToggleFavorite: () => undefined
  };

  test("esconde a estrela de favorito, que nao cabe ao lado do icone", () => {
    render(<SidebarNav {...props} collapsed />);
    expect(screen.queryByRole("button", { name: /favoritos/i })).not.toBeInTheDocument();
  });

  test("o badge vira ponto: perde o numero, mantem o aviso acessivel", () => {
    render(<SidebarNav {...props} collapsed badges={{ purchases: 7 }} />);
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByLabelText("7 pendencia(s)")).toBeInTheDocument();
  });

  test("expandida continua mostrando o numero do badge", () => {
    render(<SidebarNav {...props} badges={{ purchases: 7 }} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  test("o rotulo do grupo sai da arvore acessivel quando recolhida", () => {
    render(<SidebarNav {...props} collapsed />);
    expect(screen.queryByText("Operação")).not.toBeInTheDocument();
  });
});
