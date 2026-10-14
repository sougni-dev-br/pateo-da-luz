import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PanelEyebrow } from "../PanelEyebrow";

describe("PanelEyebrow", () => {
  test("renderiza texto com a classe do DS", () => {
    render(<PanelEyebrow>Cadastro operacional</PanelEyebrow>);
    const el = screen.getByText("Cadastro operacional");
    expect(el.className).toContain("ds-panel-eyebrow");
  });

  test("aceita className extra", () => {
    render(<PanelEyebrow className="extra">X</PanelEyebrow>);
    expect(screen.getByText("X").className).toBe("ds-panel-eyebrow extra");
  });

  test("as=\"h2\" vira título de seção (navegável por leitor de tela) com o mesmo visual", () => {
    render(<PanelEyebrow as="h2" id="secao">Resumo</PanelEyebrow>);
    const titulo = screen.getByRole("heading", { level: 2, name: "Resumo" });
    expect(titulo.className).toContain("ds-panel-eyebrow");
    expect(titulo.id).toBe("secao");
  });

  test("sem as continua sendo parágrafo, não título", () => {
    render(<PanelEyebrow>Contexto</PanelEyebrow>);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
