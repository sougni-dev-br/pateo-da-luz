import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanejamentoCaixaPremissas, PlanejamentoPremissasDoMes } from "../../../api/client";
import { BarraDeSalvar } from "../BarraDeSalvar";
import { PremissasCartoes } from "../PremissasCartoes";
import { ReguaDoPrazo } from "../ReguaDoPrazo";

const neutras = (): PlanejamentoPremissasDoMes[] =>
  Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, clientesAlmoco: 0, clientesJantar: 0, ticketAlmoco: 0, ticketJantar: 0, cmv: null }));

const caixa = (credito = 30): PlanejamentoCaixaPremissas => ({
  saldoInicial: 0,
  formas: [
    { forma: "DINHEIRO", mix: 0.1, prazoDias: 0, taxa: 0 },
    { forma: "PIX", mix: 0.3, prazoDias: 0, taxa: 0 },
    { forma: "DEBITO", mix: 0.2, prazoDias: 1, taxa: 0.01 },
    { forma: "CREDITO", mix: 0.4, prazoDias: credito, taxa: 0.03 }
  ],
  comprasPrazoDias: 30,
  herdado: { entradas: [0, 0, 0], saidas: [0, 0, 0] }
});

describe("Premissas em cartões (celular/tablet)", () => {
  function montar() {
    const props = {
      premissas: neutras(),
      desabilitado: false,
      dicaDoTodos: "aplica no Enter",
      valorComum: () => 0,
      vaiMudar: () => false,
      onPreviaDoTodos: vi.fn(),
      onMudarTodos: vi.fn(),
      onMudarMes: vi.fn()
    };
    render(<PremissasCartoes {...props} />);
    return props;
  }

  it("cada mês tem os cinco campos rotulados, e digitar avisa só aquele mês e coluna", () => {
    const props = montar();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
    fireEvent.change(screen.getByLabelText("Ticket jantar em Mar"), { target: { value: "4" } });
    expect(props.onMudarMes).toHaveBeenCalledWith(3, "ticketJantar", 0.04);
    expect(screen.getByLabelText("CMV em Dez")).toBeInTheDocument();
  });

  it('o cartão "Todos os meses" só aplica no Enter', () => {
    const props = montar();
    const todos = screen.getByLabelText("Clientes jantar, todos os meses");
    fireEvent.change(todos, { target: { value: "6" } });
    expect(props.onMudarTodos).not.toHaveBeenCalled();
    expect(props.onPreviaDoTodos).toHaveBeenCalledWith("clientesJantar", 0.06);
    fireEvent.keyDown(todos, { key: "Enter" });
    expect(props.onMudarTodos).toHaveBeenCalledWith("clientesJantar", 0.06);
  });
});

describe("Régua de prazo", () => {
  it("diz quanto das vendas fica para o mês seguinte e quem espera mais", () => {
    render(<ReguaDoPrazo caixa={caixa()} />);
    expect(screen.getByText("Fica para o mês seguinte").nextSibling).toHaveTextContent("41%");
    expect(screen.getByText(/só entram no caixa do mês seguinte/)).toHaveTextContent(/cerca de R\$ 41 só entram/);
    expect(screen.getByText(/40% das vendas, entra 30 dias depois da venda, taxa de 3%/)).toBeInTheDocument();
  });

  it("estende a escala quando um prazo passa de 30 dias e avisa o mix que não fecha", () => {
    const { rerender } = render(<ReguaDoPrazo caixa={caixa(45)} />);
    expect(screen.getByText("45 d")).toBeInTheDocument();
    rerender(<ReguaDoPrazo caixa={{ ...caixa(), formas: caixa().formas.map((f, i) => (i === 0 ? { ...f, mix: 0.2 } : f)) }} />);
    expect(screen.getByText(/O mix soma 110%: sobram 10 pontos/)).toBeInTheDocument();
  });
});

describe("Barra de salvar no conflito", () => {
  it("salvar como cópia vem primeiro; a versão salva continua disponível", () => {
    render(<BarraDeSalvar sujo salvando={false} podeEditar podeCriar caixaValida falha={{ tipo: "conflito", mensagem: "x" }} onSalvar={vi.fn()} onDescartar={vi.fn()} onSalvarComoCopia={vi.fn()} />);
    const botoes = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(botoes.indexOf("Salvar as minhas como cópia")).toBeLessThan(botoes.indexOf("Abrir a versão salva"));
  });
});
