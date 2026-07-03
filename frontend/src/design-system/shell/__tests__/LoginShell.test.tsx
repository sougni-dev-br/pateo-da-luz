import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LoginShell } from "../LoginShell";

describe("LoginShell", () => {
  test("renderiza <main.ds-login-shell> como wrapper", () => {
    const { container } = render(<LoginShell>x</LoginShell>);
    const main = container.querySelector("main.ds-login-shell");
    expect(main).not.toBeNull();
  });

  test("renderiza como <div> quando onSubmit ausente", () => {
    const { container } = render(<LoginShell>x</LoginShell>);
    expect(container.querySelector("form.ds-login-card")).toBeNull();
    expect(container.querySelector("div.ds-login-card")).not.toBeNull();
  });

  test("renderiza como <form> quando onSubmit fornecido e dispara callback", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    const { container } = render(
      <LoginShell onSubmit={onSubmit}>
        <button type="submit">go</button>
      </LoginShell>
    );
    const form = container.querySelector("form.ds-login-card");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("brandTitle + brandSubtitle geram brand default com h1 e p", () => {
    render(
      <LoginShell brandTitle="Gestão Pateo da Luz" brandSubtitle="ERP">
        x
      </LoginShell>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Gestão Pateo da Luz" })).toBeInTheDocument();
    expect(screen.getByText("ERP")).toBeInTheDocument();
  });

  test("brand override substitui o brand default", () => {
    render(
      <LoginShell brandTitle="ignorado" brand={<div data-testid="custom">C</div>}>
        x
      </LoginShell>
    );
    expect(screen.getByTestId("custom")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  test("desdeYear renderiza chip com texto \"Desde XXXX\"", () => {
    render(<LoginShell desdeYear="2003">x</LoginShell>);
    expect(screen.getByText(/Desde 2003/)).toBeInTheDocument();
  });

  test("desdeYear ausente nao renderiza chip", () => {
    const { container } = render(<LoginShell>x</LoginShell>);
    expect(container.querySelector(".ds-login-desde")).toBeNull();
  });

  test("children sao renderizados dentro do card", () => {
    render(
      <LoginShell>
        <div data-testid="content">form content</div>
      </LoginShell>
    );
    const content = screen.getByTestId("content");
    expect(content.parentElement?.className).toContain("ds-login-card");
  });

  test("cardClassName adiciona classe ao card", () => {
    const { container } = render(<LoginShell cardClassName="foo">x</LoginShell>);
    const card = container.querySelector(".ds-login-card.foo");
    expect(card).not.toBeNull();
  });
});
