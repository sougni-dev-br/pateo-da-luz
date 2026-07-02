import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Percent } from "../Percent";

describe("Percent", () => {
  test("formata valor com virgula em pt-BR e 1 casa decimal por padrao", () => {
    const { container } = render(<Percent value={31.8} />);
    expect(container.textContent).toBe("31,8%");
  });

  test("aceita casas decimais customizadas", () => {
    const { container } = render(<Percent value={31.876} decimals={2} />);
    expect(container.textContent).toBe("31,88%");
  });

  test("decimals=0 arredonda para inteiro", () => {
    const { container } = render(<Percent value={31.8} decimals={0} />);
    expect(container.textContent).toBe("32%");
  });

  test("null vira travessao", () => {
    const { container } = render(<Percent value={null} />);
    expect(container.textContent).toBe("—");
  });

  test("undefined vira travessao", () => {
    const { container } = render(<Percent value={undefined} />);
    expect(container.textContent).toBe("—");
  });

  test("zero renderiza 0,0% (nao travessao)", () => {
    const { container } = render(<Percent value={0} />);
    expect(container.textContent).toBe("0,0%");
  });

  test("negativos preservam sinal", () => {
    const { container } = render(<Percent value={-4.2} />);
    expect(container.textContent).toBe("-4,2%");
  });

  test("Percent nao le HideValuesContext por padrao (razoes seguem visiveis)", () => {
    // Renderiza SEM providers — se Percent lesse o context, explodiria como Money faria.
    const { container } = render(<Percent value={31.8} />);
    expect(container.textContent).toBe("31,8%");
  });

  test("prop hidden=true mascara", () => {
    const { container } = render(<Percent value={31.8} hidden />);
    expect(container.textContent).toBe("••••");
  });

  test("aceita className adicional", () => {
    const { container } = render(<Percent value={10} className="foo" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toBe("ds-percent foo");
  });
});
