import { fireEvent, render, screen } from "@testing-library/react";
import { LayoutDashboard, ReceiptText, WalletCards } from "lucide-react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SidebarNav, filterGroupsByQuery, withFavoritesGroup } from "../SidebarNav";
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

beforeEach(() => {
  window.localStorage.clear();
});

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
    // Por grupo: 1 cabecalho (acordeao) + 1 botao de nav + 1 estrela.
    expect(screen.getAllByRole("button").length).toBe(9);
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

  test("move o favorito para o grupo Favoritos e some com o grupo que esvaziar", () => {
    const out = withFavoritesGroup(GROUPS, ["purchases"]);
    expect(out[0].group).toBe("Favoritos");
    expect(out[0].items.map((i) => i.id)).toEqual(["purchases"]);
    expect(out.map((g) => g.group)).toEqual(["Favoritos", "Visão geral", "Financeiro"]);
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

describe("SidebarNav acordeao", () => {
  const props = {
    groups: GROUPS,
    activeId: "dashboard",
    favorites: [] as string[],
    onNavigate: noop,
    onToggleFavorite: noop
  };

  test("clicar no cabecalho fecha o grupo e aria-expanded acompanha", () => {
    render(<SidebarNav {...props} />);
    const header = screen.getByRole("button", { name: "Financeiro" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /Contas a pagar/ })).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByRole("button", { name: /Contas a pagar/ })).toBeInTheDocument();
  });

  test("grupo fechado continua fechado depois de remontar (localStorage)", () => {
    const first = render(<SidebarNav {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
    first.unmount();
    render(<SidebarNav {...props} />);
    expect(screen.queryByRole("button", { name: /Contas a pagar/ })).not.toBeInTheDocument();
  });

  test("navegar para um item de grupo fechado reabre o grupo", () => {
    window.localStorage.setItem("pateo:sidebar:grupos-fechados", JSON.stringify(["Financeiro"]));
    const { rerender } = render(<SidebarNav {...props} />);
    expect(screen.queryByRole("button", { name: /Contas a pagar/ })).not.toBeInTheDocument();
    rerender(<SidebarNav {...props} activeId="payables" />);
    expect(screen.getByRole("button", { name: /Contas a pagar/ })).toBeInTheDocument();
  });

  test("grupo fechado mostra a soma das pendencias no cabecalho", () => {
    window.localStorage.setItem("pateo:sidebar:grupos-fechados", JSON.stringify(["Operação"]));
    render(<SidebarNav {...props} badges={{ purchases: 25 }} />);
    expect(screen.getByRole("button", { name: /Operação/ })).toHaveTextContent("25");
  });

  test("localStorage corrompido nao quebra: tudo aberto", () => {
    window.localStorage.setItem("pateo:sidebar:grupos-fechados", "{nao-e-json");
    render(<SidebarNav {...props} />);
    expect(screen.getByRole("button", { name: /Contas a pagar/ })).toBeInTheDocument();
  });
});

describe("SidebarNav busca", () => {
  const props = {
    groups: GROUPS,
    activeId: "dashboard",
    favorites: [] as string[],
    onNavigate: noop,
    onToggleFavorite: noop
  };

  test("filtra sem acento e sem caixa, mesmo com o grupo fechado", () => {
    window.localStorage.setItem("pateo:sidebar:grupos-fechados", JSON.stringify(["Visão geral"]));
    render(<SidebarNav {...props} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no menu" }), { target: { value: "DASH" } });
    expect(screen.getByRole("button", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Compras/ })).not.toBeInTheDocument();
  });

  test("sem resultado mostra aviso", () => {
    render(<SidebarNav {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByRole("status")).toHaveTextContent("Nenhum item encontrado.");
  });

  test("Enter abre o primeiro resultado e limpa a busca", () => {
    const onNavigate = vi.fn();
    render(<SidebarNav {...props} onNavigate={onNavigate} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "contas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("payables");
    expect(input).toHaveValue("");
  });

  test("Escape limpa a busca", () => {
    render(<SidebarNav {...props} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "com" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
  });

  test("Ctrl+K foca o campo de busca", () => {
    render(<SidebarNav {...props} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  test("recolhida a so icones nao renderiza busca", () => {
    render(<SidebarNav {...props} collapsed />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});

describe("filterGroupsByQuery", () => {
  test("busca vazia devolve os grupos originais", () => {
    expect(filterGroupsByQuery(GROUPS, "  ")).toBe(GROUPS);
  });
});
