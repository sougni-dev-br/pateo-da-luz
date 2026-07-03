import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FormGrid } from "../FormGrid";

describe("FormGrid", () => {
  test("default: 2 colunas", () => {
    const { container } = render(
      <FormGrid>
        <span>a</span>
      </FormGrid>
    );
    expect(container.querySelector(".ds-form-grid-2")).not.toBeNull();
  });

  test("cols=3 aplica classe correspondente", () => {
    const { container } = render(
      <FormGrid cols={3}>
        <span>a</span>
      </FormGrid>
    );
    expect(container.querySelector(".ds-form-grid-3")).not.toBeNull();
  });

  test("className extra e children renderizam", () => {
    const { container, getByText } = render(
      <FormGrid cols={4} className="extra">
        <span>campo</span>
      </FormGrid>
    );
    expect(container.querySelector(".ds-form-grid-4.extra")).not.toBeNull();
    expect(getByText("campo")).toBeInTheDocument();
  });
});
