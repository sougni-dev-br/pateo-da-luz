import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, test } from "vitest";
import { AppShell } from "../AppShell";

describe("AppShell", () => {
  test("renderiza sidebar, main-col e content na ordem correta", () => {
    const { container } = render(
      <AppShell sidebar={<aside data-testid="side">S</aside>}>
        <div data-testid="child">C</div>
      </AppShell>
    );
    const shell = container.querySelector("main.app-shell");
    expect(shell).not.toBeNull();

    const sidebar = screen.getByTestId("side");
    const mainCol = container.querySelector(".main-col");
    const content = container.querySelector(".content");
    const child = screen.getByTestId("child");

    expect(sidebar.parentElement).toBe(shell);
    expect(mainCol?.parentElement).toBe(shell);
    expect(content?.parentElement).toBe(mainCol);
    expect(child.parentElement).toBe(content);
  });

  test("mobileHeader renderiza antes da sidebar", () => {
    const { container } = render(
      <AppShell
        mobileHeader={<header data-testid="mh">M</header>}
        sidebar={<aside data-testid="side">S</aside>}
      >
        x
      </AppShell>
    );
    const shell = container.querySelector("main.app-shell")!;
    const children = Array.from(shell.children);
    const mhIdx = children.findIndex((c) => c.getAttribute("data-testid") === "mh");
    const sideIdx = children.findIndex((c) => c.getAttribute("data-testid") === "side");
    expect(mhIdx).toBeGreaterThanOrEqual(0);
    expect(mhIdx).toBeLessThan(sideIdx);
  });

  test("drawer renderiza entre mobileHeader e sidebar", () => {
    const { container } = render(
      <AppShell
        mobileHeader={<header data-testid="mh">M</header>}
        drawer={<div data-testid="dr">D</div>}
        sidebar={<aside data-testid="side">S</aside>}
      >
        x
      </AppShell>
    );
    const shell = container.querySelector("main.app-shell")!;
    const children = Array.from(shell.children);
    const mhIdx = children.findIndex((c) => c.getAttribute("data-testid") === "mh");
    const drIdx = children.findIndex((c) => c.getAttribute("data-testid") === "dr");
    const sideIdx = children.findIndex((c) => c.getAttribute("data-testid") === "side");
    expect(mhIdx).toBeLessThan(drIdx);
    expect(drIdx).toBeLessThan(sideIdx);
  });

  test("topbar renderiza dentro de main-col antes de content", () => {
    const { container } = render(
      <AppShell
        sidebar={<aside>S</aside>}
        topbar={<div data-testid="tb">T</div>}
      >
        <div data-testid="child">C</div>
      </AppShell>
    );
    const mainCol = container.querySelector(".main-col")!;
    const topbar = screen.getByTestId("tb");
    const content = mainCol.querySelector(".content");
    expect(topbar.parentElement).toBe(mainCol);
    expect(content?.previousElementSibling).toBe(topbar);
  });

  test("forwardRef expõe o .content section", () => {
    const ref = createRef<HTMLElement>();
    render(<AppShell ref={ref} sidebar={<aside>S</aside>}>c</AppShell>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.className).toBe("content");
    expect(ref.current?.tagName).toBe("SECTION");
  });

  test("slots opcionais (mobileHeader/drawer/topbar) são omitidos quando ausentes", () => {
    const { container } = render(
      <AppShell sidebar={<aside data-testid="side">S</aside>}>c</AppShell>
    );
    const shell = container.querySelector("main.app-shell")!;
    // Só sidebar + main-col
    expect(shell.children.length).toBe(2);
  });
});
