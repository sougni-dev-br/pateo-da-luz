import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanejamentoPremissasDoMes } from "../../../api/client";
import { PremissasEditor } from "../PremissasEditor";

const neutras = (): PlanejamentoPremissasDoMes[] =>
  Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, clientesAlmoco: 0, clientesJantar: 0, ticketAlmoco: 0, ticketJantar: 0, cmv: null }));

describe("PremissasEditor", () => {
  it("digitar um percentual válido avisa o pai com a fração só daquele mês", () => {
    const onMudar = vi.fn();
    render(<PremissasEditor premissas={neutras()} desabilitado={false} onMudar={onMudar} />);
    fireEvent.change(screen.getByLabelText("Clientes almoço em Mar"), { target: { value: "5,5" } });
    const proximas = onMudar.mock.calls[0][0] as PlanejamentoPremissasDoMes[];
    expect(proximas.find((p) => p.mes === 3)?.clientesAlmoco).toBe(0.055);
    expect(proximas.find((p) => p.mes === 4)?.clientesAlmoco).toBe(0);
  });

  it("texto inválido ou fora da faixa não chega ao pai e marca o campo", () => {
    const onMudar = vi.fn();
    render(<PremissasEditor premissas={neutras()} desabilitado={false} onMudar={onMudar} />);
    const campo = screen.getByLabelText("Ticket jantar em Jan");
    fireEvent.change(campo, { target: { value: "abc" } });
    fireEvent.change(campo, { target: { value: "-95" } });
    expect(onMudar).not.toHaveBeenCalled();
    expect(campo).toHaveAttribute("aria-invalid", "true");
  });

  it('"Todos os meses" preenche a coluna inteira', () => {
    const onMudar = vi.fn();
    render(<PremissasEditor premissas={neutras()} desabilitado={false} onMudar={onMudar} />);
    fireEvent.change(screen.getByLabelText("Ticket jantar, todos os meses"), { target: { value: "5" } });
    const proximas = onMudar.mock.calls[0][0] as PlanejamentoPremissasDoMes[];
    expect(proximas.every((p) => p.ticketJantar === 0.05)).toBe(true);
  });

  it("CMV aceita vazio (volta a null) mas não passa de 100%", () => {
    const onMudar = vi.fn();
    const premissas = neutras().map((p) => (p.mes === 1 ? { ...p, cmv: 0.4 } : p));
    render(<PremissasEditor premissas={premissas} desabilitado={false} onMudar={onMudar} />);
    const campo = screen.getByLabelText("CMV em Jan");
    expect(campo).toHaveValue("40");
    fireEvent.change(campo, { target: { value: "" } });
    expect((onMudar.mock.calls[0][0] as PlanejamentoPremissasDoMes[])[0].cmv).toBeNull();
    onMudar.mockClear();
    fireEvent.change(campo, { target: { value: "120" } });
    expect(onMudar).not.toHaveBeenCalled();
  });

  it("sem permissão de edição os campos ficam desabilitados", () => {
    render(<PremissasEditor premissas={neutras()} desabilitado onMudar={vi.fn()} />);
    expect(screen.getByLabelText("Clientes almoço em Jan")).toBeDisabled();
  });
});
