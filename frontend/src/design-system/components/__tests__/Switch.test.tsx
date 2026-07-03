import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Switch } from "../Switch";

describe("Switch", () => {
  test("renderiza role=switch com aria-checked", () => {
    render(<Switch checked={false} onChange={() => undefined} label="Ativo" />);
    const el = screen.getByRole("switch", { name: "Ativo" });
    expect(el.getAttribute("aria-checked")).toBe("false");
  });

  test("clique inverte o valor via onChange", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Ativo" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("checked=true aplica classe on e aria-checked=true", () => {
    render(<Switch checked onChange={() => undefined} label="Ativo" />);
    const el = screen.getByRole("switch");
    expect(el.getAttribute("aria-checked")).toBe("true");
    expect(el.className).toContain("ds-switch-on");
  });

  test("disabled não dispara onChange", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Ativo" disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
