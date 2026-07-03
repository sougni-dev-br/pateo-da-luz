import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ListDetailLayout } from "../ListDetailLayout";

function renderLayout(props: { detailActive?: boolean; onBack?: () => void } = {}) {
  return render(
    <ListDetailLayout
      {...props}
      list={
        <ListDetailLayout.List
          header={<input placeholder="Buscar..." />}
          footer={<button type="button">Novo usuário</button>}
        >
          <ListDetailLayout.Item title="Rafael" subtitle="ADMIN" active />
          <ListDetailLayout.Item title="Marcos" subtitle="ESTOQUISTA" />
        </ListDetailLayout.List>
      }
      detail={<div>Editor do usuário</div>}
    />
  );
}

describe("ListDetailLayout", () => {
  test("renderiza lista, header, footer e detalhe", () => {
    renderLayout();
    expect(screen.getByPlaceholderText("Buscar...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo usuário" })).toBeInTheDocument();
    expect(screen.getByText("Editor do usuário")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("item ativo recebe classe e aria-current", () => {
    renderLayout();
    // role=listitem nao computa nome do conteudo — localiza pelo texto.
    const active = screen.getByText("Rafael").closest("button")!;
    expect(active.className).toContain("ds-list-detail-item-active");
    expect(active.getAttribute("aria-current")).toBe("true");
  });

  test("clique no item dispara onClick", () => {
    const onClick = vi.fn();
    render(
      <ListDetailLayout
        list={
          <ListDetailLayout.List>
            <ListDetailLayout.Item title="Rafael" onClick={onClick} />
          </ListDetailLayout.List>
        }
        detail={<div>x</div>}
      />
    );
    fireEvent.click(screen.getByText("Rafael").closest("button")!);
    expect(onClick).toHaveBeenCalledOnce();
  });

  test("detailActive aplica classe no root e botão voltar dispara onBack", () => {
    const onBack = vi.fn();
    const { container } = renderLayout({ detailActive: true, onBack });
    expect(container.querySelector(".ds-list-detail-detail-active")).not.toBeNull();
    // display:none no desktop (so aparece no media query mobile) — o nome
    // acessivel some junto, entao localiza pelo texto do DOM.
    fireEvent.click(screen.getByText("Voltar"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  test("sem onBack não renderiza botão voltar", () => {
    renderLayout();
    expect(screen.queryByText("Voltar")).not.toBeInTheDocument();
  });
});
