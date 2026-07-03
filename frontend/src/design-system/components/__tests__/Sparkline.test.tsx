import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Sparkline } from "../Sparkline";

describe("Sparkline", () => {
  test("renderiza svg com 2+ pontos", () => {
    const { container } = render(<Sparkline points={[1, 2, 3, 4]} />);
    expect(container.querySelector("svg")).not.toBeNull();
    // 2 paths: fill + line
    expect(container.querySelectorAll("path").length).toBe(2);
  });

  test("nao renderiza nada com menos de 2 pontos", () => {
    const { container } = render(<Sparkline points={[5]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  test("valores iguais em todo o array nao explode (range=0)", () => {
    const { container } = render(<Sparkline points={[5, 5, 5]} />);
    // usa fallback range=1, gera linha reta na base — svg deve existir
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("aceita width e height custom", () => {
    const { container } = render(<Sparkline points={[1, 2]} width={100} height={40} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 40");
  });

  test("path da linha comeca com M", () => {
    const { container } = render(<Sparkline points={[10, 20]} />);
    const linePath = container.querySelectorAll("path")[1].getAttribute("d")!;
    expect(linePath.startsWith("M")).toBe(true);
  });

  test("path do fill fecha ate a base (contem Z)", () => {
    const { container } = render(<Sparkline points={[10, 20]} />);
    const fillPath = container.querySelectorAll("path")[0].getAttribute("d")!;
    expect(fillPath.endsWith("Z")).toBe(true);
  });

  test("aria-hidden=true (decorativo)", () => {
    const { container } = render(<Sparkline points={[1, 2]} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
