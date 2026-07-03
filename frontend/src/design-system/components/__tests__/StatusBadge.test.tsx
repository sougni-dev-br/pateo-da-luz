import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StatusBadge } from "../StatusBadge";

describe("StatusBadge", () => {
  test("neutral e o default", () => {
    render(<StatusBadge>x</StatusBadge>);
    expect(screen.getByText("x").className).toContain("ds-status-badge-neutral");
  });

  test.each(["success", "warning", "danger", "info"] as const)("aplica tone %s", (tone) => {
    render(<StatusBadge tone={tone}>x</StatusBadge>);
    expect(screen.getByText("x").className).toContain(`ds-status-badge-${tone}`);
  });

  test("aceita className", () => {
    render(<StatusBadge className="foo">x</StatusBadge>);
    expect(screen.getByText("x").className).toContain("foo");
  });

  test("propaga title", () => {
    render(<StatusBadge title="tooltip">3</StatusBadge>);
    expect(screen.getByText("3").getAttribute("title")).toBe("tooltip");
  });
});
