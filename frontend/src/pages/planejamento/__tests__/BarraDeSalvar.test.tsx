import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BarraDeSalvar } from "../BarraDeSalvar";

const base = { salvando: false, podeEditar: true, podeCriar: true, caixaValida: true, onSalvar: vi.fn(), onDescartar: vi.fn(), onSalvarComoCopia: vi.fn() };

describe("BarraDeSalvar", () => {
  it("some quando não há alteração nem falha", () => {
    const { container } = render(<BarraDeSalvar {...base} sujo={false} falha={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("conflito de edição é explicado em alerta e oferece salvar como cópia ou abrir a versão salva", () => {
    const onSalvarComoCopia = vi.fn();
    const onDescartar = vi.fn();
    render(<BarraDeSalvar {...base} sujo falha={{ tipo: "conflito", mensagem: "Outra pessoa salvou." }} onSalvarComoCopia={onSalvarComoCopia} onDescartar={onDescartar} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Suas alterações continuam na tela/);
    fireEvent.click(screen.getByRole("button", { name: /Salvar as minhas como cópia/ }));
    fireEvent.click(screen.getByRole("button", { name: /Abrir a versão salva/ }));
    expect(onSalvarComoCopia).toHaveBeenCalledTimes(1);
    expect(onDescartar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Salvar cenário/ })).toBeNull();
  });

  it("erro ao salvar fica numa linha, com detalhe sob demanda e tentar de novo", () => {
    const onSalvar = vi.fn();
    render(<BarraDeSalvar {...base} sujo falha={{ tipo: "erro", mensagem: "O servidor não respondeu (erro 500)." }} onSalvar={onSalvar} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/não foi salvo/);
    expect(screen.queryByText(/erro 500/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Detalhes/ }));
    expect(screen.getByText(/erro 500\)\. Confira/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(onSalvar).toHaveBeenCalledTimes(1);
  });

  it("mix que não fecha bloqueia o salvar e diz por quê", () => {
    render(<BarraDeSalvar {...base} sujo caixaValida={false} falha={null} />);
    expect(screen.getByRole("button", { name: /Salvar cenário/ })).toBeDisabled();
    expect(screen.getByText(/precisa somar 100% para salvar/)).toBeInTheDocument();
  });

  it("com o mix bloqueando, a barra leva até ele", () => {
    const onVerMix = vi.fn();
    render(<BarraDeSalvar {...base} sujo caixaValida={false} falha={null} onVerMix={onVerMix} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver o mix" }));
    expect(onVerMix).toHaveBeenCalledTimes(1);
  });
});
