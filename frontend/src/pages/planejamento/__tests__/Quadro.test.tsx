import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanejamentoPremissasDoMes } from "../../../api/client";
import { PremissasEditor } from "../PremissasEditor";

const neutras = (): PlanejamentoPremissasDoMes[] =>
  Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, clientesAlmoco: 0, clientesJantar: 0, ticketAlmoco: 0, ticketJantar: 0, cmv: null }));

// A tabela das premissas já vem dentro do próprio Quadro editável (na largura do computador).
function montar() {
  render(<PremissasEditor premissas={neutras()} desabilitado={false} onMudar={vi.fn()} />);
}

describe("Quadro (navegação de planilha)", () => {
  it("a região rolável recebe foco e diz como navegar", () => {
    montar();
    const regiao = screen.getByRole("region");
    expect(regiao).toHaveAttribute("tabindex", "0");
    expect(regiao.getAttribute("aria-label")).toMatch(/setas/);
  });

  it("seta para baixo e Enter descem na mesma coluna; Shift+Enter sobe", () => {
    montar();
    const jan = screen.getByLabelText("Clientes almoço em Jan");
    jan.focus();
    fireEvent.keyDown(jan, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("Clientes almoço em Fev"));
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("Clientes almoço em Mar"));
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Clientes almoço em Fev"));
  });

  it("seta lateral muda de coluna quando o texto está todo selecionado, e não no meio do texto", () => {
    montar();
    const campo = screen.getByLabelText("Clientes almoço em Jan") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "12" } });
    campo.focus();
    campo.setSelectionRange(1, 1);
    fireEvent.keyDown(campo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(campo);
    campo.setSelectionRange(0, campo.value.length);
    fireEvent.keyDown(campo, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByLabelText("Clientes jantar em Jan"));
  });
});
