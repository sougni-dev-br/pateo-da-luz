import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Card } from "../Card";

describe("Card", () => {
  test("renderiza como div com classe ds-card", () => {
    render(<Card><span data-testid="child">x</span></Card>);
    expect(screen.getByTestId("child").parentElement?.className).toBe("ds-card");
  });

  test("interactive=true adiciona ds-card-interactive", () => {
    render(<Card interactive><span data-testid="c">x</span></Card>);
    const parent = screen.getByTestId("c").parentElement!;
    expect(parent.className).toContain("ds-card-interactive");
  });

  test("interactive default false: sem classe extra", () => {
    render(<Card><span data-testid="c">x</span></Card>);
    expect(screen.getByTestId("c").parentElement?.className).not.toContain("ds-card-interactive");
  });

  test("aceita className adicional", () => {
    render(<Card className="foo"><span data-testid="c">x</span></Card>);
    expect(screen.getByTestId("c").parentElement?.className).toContain("foo");
  });

  test("props html passam adiante (data attrs)", () => {
    render(<Card data-testid="wrap">x</Card>);
    expect(screen.getByTestId("wrap")).toBeInTheDocument();
  });
});
