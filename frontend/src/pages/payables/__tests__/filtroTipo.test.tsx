import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Payable } from "../../../api/client";
import { Select } from "../../../design-system";
import { combinaSubtipo } from "../regras";
import { OPCOES_SUBTIPO } from "../PainelFiltros";

const titulo = (sourceType: string, taxDocumentType: string | null = null) => ({ sourceType, taxDocumentType }) as unknown as Payable;

describe("filtro de tipo do Contas a Pagar", () => {
  test("Folha (tudo) inclui os títulos da folha liberada; o lote tem opção própria", () => {
    expect(combinaSubtipo(titulo("PAYROLL", "Salário"), "PAYROLL")).toBe(true);
    expect(combinaSubtipo(titulo("FOLHA_LOTE"), "PAYROLL")).toBe(true);
    expect(combinaSubtipo(titulo("FOLHA_LOTE"), "FOLHA_LOTE")).toBe(true);
    expect(combinaSubtipo(titulo("PAYROLL", "Salário"), "FOLHA_LOTE")).toBe(false);
    expect(combinaSubtipo(titulo("FOLHA_LOTE"), "PAYROLL:Salário")).toBe(false);
    expect(combinaSubtipo(titulo("DIRECT"), "PAYROLL")).toBe(false);
  });

  test("opções em grupos: Compras, Folha e Extras, com a folha liberada", () => {
    const grupos = [...new Set(OPCOES_SUBTIPO.map((o) => o.group))];
    expect(grupos).toEqual(["Compras", "Folha", "Extras"]);
    expect(OPCOES_SUBTIPO.find((o) => o.value === "FOLHA_LOTE")?.label).toMatch(/Folha liberada/);
  });

  test("o seletor desenha os grupos (optgroup) e mantém as opções sem grupo", () => {
    render(<Select aria-label="Tipo" placeholder="Todos" value="" onChange={() => undefined}
      options={[{ value: "a", label: "Avulsa" }, { value: "b", label: "Bê", group: "Grupo 1" }, { value: "c", label: "Cê", group: "Grupo 1" }]} />);
    const select = screen.getByRole("combobox", { name: "Tipo" });
    const grupo = select.querySelector("optgroup");
    expect(grupo?.getAttribute("label")).toBe("Grupo 1");
    expect(within(grupo as HTMLElement).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bê", "Cê"]);
    expect(screen.getByRole("option", { name: "Avulsa" })).toBeInTheDocument();
  });
});

