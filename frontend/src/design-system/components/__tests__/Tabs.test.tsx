import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Tabs } from "../Tabs";

const TABS = [
  { value: "todas", label: "Todas" },
  { value: "abertas", label: "Em aberto" },
  { value: "pagas", label: "Pagas" }
];

describe("Tabs", () => {
  test("renderiza todos os tabs", () => {
    render(<Tabs tabs={TABS} value="todas" />);
    expect(screen.getByRole("tab", { name: "Todas" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Em aberto" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pagas" })).toBeInTheDocument();
  });

  test("tab ativo marca aria-selected=true e classe active", () => {
    render(<Tabs tabs={TABS} value="abertas" />);
    const active = screen.getByRole("tab", { name: "Em aberto" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.className).toContain("ds-tab-active");
    const inactive = screen.getByRole("tab", { name: "Todas" });
    expect(inactive.getAttribute("aria-selected")).toBe("false");
    expect(inactive.className).not.toContain("ds-tab-active");
  });

  test("onChange dispara com o value clicado", () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="todas" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Pagas" }));
    expect(onChange).toHaveBeenCalledWith("pagas");
  });

  test("tab disabled nao dispara onChange", () => {
    const onChange = vi.fn();
    const tabs = [...TABS, { value: "cancel", label: "X", disabled: true }];
    render(<Tabs tabs={tabs} value="todas" onChange={onChange} />);
    const disabledTab = screen.getByRole("tab", { name: "X" });
    expect(disabledTab).toBeDisabled();
    fireEvent.click(disabledTab);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("wrapper tem role tablist", () => {
    render(<Tabs tabs={TABS} value="todas" />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  describe("teclado (WAI-ARIA)", () => {
    test("só a aba ativa entra na ordem do Tab; as outras ficam em -1", () => {
      render(<Tabs tabs={TABS} value="abertas" />);
      expect(screen.getByRole("tab", { name: "Em aberto" }).tabIndex).toBe(0);
      expect(screen.getByRole("tab", { name: "Todas" }).tabIndex).toBe(-1);
      expect(screen.getByRole("tab", { name: "Pagas" }).tabIndex).toBe(-1);
    });

    test("sem aba ativa a primeira continua alcançável", () => {
      render(<Tabs tabs={TABS} value="inexistente" />);
      expect(screen.getByRole("tab", { name: "Todas" }).tabIndex).toBe(0);
    });

    test("setas movem o foco (com volta ao início/fim) sem ativar", () => {
      const onChange = vi.fn();
      render(<Tabs tabs={TABS} value="todas" onChange={onChange} />);
      const [a, b, c] = screen.getAllByRole("tab");
      a.focus();
      fireEvent.keyDown(a, { key: "ArrowRight" });
      expect(document.activeElement).toBe(b);
      fireEvent.keyDown(b, { key: "ArrowRight" });
      expect(document.activeElement).toBe(c);
      fireEvent.keyDown(c, { key: "ArrowRight" });
      expect(document.activeElement).toBe(a);
      fireEvent.keyDown(a, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(c);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("Home e End vão à primeira e à última aba", () => {
      render(<Tabs tabs={TABS} value="abertas" />);
      const [a, b, c] = screen.getAllByRole("tab");
      b.focus();
      fireEvent.keyDown(b, { key: "End" });
      expect(document.activeElement).toBe(c);
      fireEvent.keyDown(c, { key: "Home" });
      expect(document.activeElement).toBe(a);
    });

    test("pula aba desabilitada", () => {
      render(<Tabs tabs={[TABS[0], { ...TABS[1], disabled: true }, TABS[2]]} value="todas" />);
      const [a, , c] = screen.getAllByRole("tab");
      a.focus();
      fireEvent.keyDown(a, { key: "ArrowRight" });
      expect(document.activeElement).toBe(c);
    });
  });
});
