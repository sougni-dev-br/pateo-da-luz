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
});
