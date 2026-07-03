import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Alert } from "../Alert";

describe("Alert", () => {
  test("info e o default e vem com role=status", () => {
    render(<Alert>msg</Alert>);
    const root = screen.getByRole("status");
    expect(root.className).toContain("ds-alert-info");
    expect(screen.getByText("msg")).toBeInTheDocument();
  });

  test.each(["info", "success", "warning", "error"] as const)("aplica tone %s", (tone) => {
    render(<Alert tone={tone}>m</Alert>);
    expect(screen.getByRole("status").className).toContain(`ds-alert-${tone}`);
  });

  test("renderiza icone padrao do tom", () => {
    const { container } = render(<Alert tone="success">m</Alert>);
    // svg do lucide-react
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("icon=null suprime o icone padrao", () => {
    const { container } = render(<Alert icon={null}>m</Alert>);
    expect(container.querySelector("svg")).toBeNull();
  });

  test("icon custom substitui o padrao", () => {
    render(
      <Alert icon={<span data-testid="custom">c</span>}>m</Alert>
    );
    expect(screen.getByTestId("custom")).toBeInTheDocument();
  });
});
