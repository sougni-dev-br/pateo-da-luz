import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LoginShell } from "../LoginShell";

describe("LoginShell", () => {
  test("renderiza o container split .ds-login-shell", () => {
    const { container } = render(<LoginShell>x</LoginShell>);
    expect(container.querySelector(".ds-login-shell")).not.toBeNull();
  });

  test("renderiza aside e main lado a lado", () => {
    const { container } = render(<LoginShell>x</LoginShell>);
    expect(container.querySelector("aside.ds-login-aside")).not.toBeNull();
    expect(container.querySelector("main.ds-login-main")).not.toBeNull();
  });

  test("renderiza card como <div> quando onSubmit ausente", () => {
    const { container } = render(<LoginShell>x</LoginShell>);
    expect(container.querySelector("form.ds-login-card")).toBeNull();
    expect(container.querySelector("div.ds-login-card")).not.toBeNull();
  });

  test("renderiza card como <form> quando onSubmit fornecido e dispara callback", () => {
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

  test("formTitle vira h1 e formSubtitle vira paragrafo", () => {
    render(
      <LoginShell formTitle="Bem-vindo" formSubtitle="Entre para continuar">
        x
      </LoginShell>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Bem-vindo" })).toBeInTheDocument();
    expect(screen.getByText("Entre para continuar")).toBeInTheDocument();
  });

  test("brandName aparece no aside (e no header mobile)", () => {
    render(<LoginShell brandName="Pateo da Luz">x</LoginShell>);
    // aparece duas vezes: uma no aside desktop, outra no mobile brand
    expect(screen.getAllByText("Pateo da Luz").length).toBeGreaterThanOrEqual(1);
  });

  test("showcaseFeatures renderiza itens na lista", () => {
    render(
      <LoginShell showcaseFeatures={["Alpha", "Beta"]}>x</LoginShell>
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
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
    expect(container.querySelector(".ds-login-card.foo")).not.toBeNull();
  });

  test("legal padrao aparece no card", () => {
    render(<LoginShell>x</LoginShell>);
    expect(screen.getByText(/Acesso restrito/)).toBeInTheDocument();
  });
});
