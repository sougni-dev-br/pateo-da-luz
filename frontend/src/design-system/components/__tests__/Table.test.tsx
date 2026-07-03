import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Table } from "../Table";

function renderTable(onRowClick?: () => void) {
  return render(
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.Th minWidth={180}>Fornecedor</Table.Th>
          <Table.Th align="right">Total</Table.Th>
          <Table.Th actions>Ações</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        <Table.Row onClick={onRowClick}>
          <Table.Td truncate title="Distribuidora Hortifruti Central do Vale Ltda">
            Distribuidora Hortifruti Central do Vale Ltda
          </Table.Td>
          <Table.Td align="right">R$ 1.234</Table.Td>
          <Table.Td actions>
            <button type="button">editar</button>
          </Table.Td>
        </Table.Row>
      </Table.Body>
    </Table>
  );
}

describe("Table", () => {
  test("renderiza table semântico dentro do wrapper com scroll", () => {
    const { container } = renderTable();
    expect(container.querySelector(".ds-table-scroll table.ds-table")).not.toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("noScroll remove o wrapper", () => {
    const { container } = render(
      <Table noScroll>
        <Table.Body>
          <Table.Row>
            <Table.Td>x</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table>
    );
    expect(container.querySelector(".ds-table-scroll")).toBeNull();
    expect(container.querySelector("table.ds-table")).not.toBeNull();
  });

  test("Th aplica minWidth e alinhamento", () => {
    renderTable();
    const th = screen.getByText("Fornecedor");
    expect(th.style.minWidth).toBe("180px");
    const totalTh = screen.getByText("Total");
    expect(totalTh.className).toContain("ds-table-cell-right");
  });

  test("Td truncate aplica classe e title para tooltip", () => {
    renderTable();
    const td = screen.getByText("Distribuidora Hortifruti Central do Vale Ltda");
    expect(td.className).toContain("ds-table-cell-truncate");
    expect(td.getAttribute("title")).toContain("Distribuidora");
  });

  test("célula de ações envolve conteúdo no wrap alinhado", () => {
    const { container } = renderTable();
    expect(container.querySelector(".ds-table-cell-actions .ds-table-actions-wrap button")).not.toBeNull();
  });

  test("row com onClick vira clicável e dispara", () => {
    const onClick = vi.fn();
    const { container } = renderTable(onClick);
    const row = container.querySelector(".ds-table-body .ds-table-row-clickable");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(onClick).toHaveBeenCalled();
  });
});
