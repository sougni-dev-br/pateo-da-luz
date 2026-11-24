import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanejamentoLinhaDeGasto, PlanejamentoPremissasDoMes, PlanejamentoProjecao } from "../../../api/client";
import { BarraDeSalvar } from "../BarraDeSalvar";
import { GastosCartoes, GastosTabela, type PropsDasLinhas } from "../GastosLinhas";
import { pesoNaMargem } from "../gastosLeitura";
import { desfazerColuna, PremissasEditor } from "../PremissasEditor";
import { trechoNegativo } from "../Veredito";

const ocupacao = (): PlanejamentoLinhaDeGasto => ({ grupo: "OCUPACAO", nome: "Ocupação", modo: "FIXO", valores: Array(12).fill(52000), pagoNoMes: 0 });
const tributos = (): PlanejamentoLinhaDeGasto => ({ grupo: "TRIBUTOS", nome: "Tributos", modo: "PERCENTUAL", valores: Array(12).fill(0.06), pagoNoMes: 0 });

function linhas(sobre: Partial<PropsDasLinhas> = {}): PropsDasLinhas {
  return { anoBase: 2026, gastos: [ocupacao(), tributos()], desabilitado: false, onMudarLinha: vi.fn(), onMudarPago: vi.fn(), onRemover: vi.fn(), ...sobre };
}

const neutras = (): PlanejamentoPremissasDoMes[] =>
  Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, clientesAlmoco: 0, clientesJantar: 0, ticketAlmoco: 0, ticketJantar: 0, cmv: null }));

describe("Gastos no celular (cartões)", () => {
  it("cada linha mostra os 12 meses rotulados e editáveis", () => {
    const p = linhas();
    render(<GastosCartoes {...p} />);
    const cartao = screen.getAllByRole("group", { name: /Ocupação, mês a mês/ })[0];
    expect(within(cartao).getAllByRole("textbox")).toHaveLength(12);
    fireEvent.change(screen.getByLabelText("Ocupação em Dez"), { target: { value: "60.000" } });
    expect(p.onMudarLinha).toHaveBeenCalledWith(0, 11, 60000);
  });

  it("remover e o % pago no mês continuam no cartão", () => {
    const p = linhas();
    render(<GastosCartoes {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Remover Tributos" }));
    expect(p.onRemover).toHaveBeenCalledWith(1);
    fireEvent.change(screen.getByLabelText("Ocupação, % pago no mês"), { target: { value: "50" } });
    expect(p.onMudarPago).toHaveBeenCalledWith(0, 0.5);
  });
});

describe("Gastos no computador (planilha de meio ano)", () => {
  it("abre em Jan–Jun e troca para Jul–Dez", () => {
    render(<GastosTabela {...linhas()} />);
    expect(screen.getByLabelText("Ocupação em Jun")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ocupação em Jul")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Jul–Dez" }));
    expect(screen.getByRole("button", { name: "Jul–Dez" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Ocupação em Dez")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ocupação em Jan")).toBeNull();
  });
});

describe("Peso do gasto na margem bruta", () => {
  it("soma R$ fixo e % × vendas só nos meses com projeção", () => {
    const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, projetado: i < 2 ? { vendas: { total: 100_000 } } : null }));
    const projecao = { meses, total: { margemBruta: 100_000 } } as unknown as PlanejamentoProjecao;
    expect(pesoNaMargem(ocupacao(), projecao)).toBeCloseTo(1.04);
    expect(pesoNaMargem(tributos(), projecao)).toBeCloseTo(0.12);
    expect(pesoNaMargem(ocupacao(), null)).toBeNull();
  });
});

describe("Desfazer de 'Todos os meses' fora do quadro", () => {
  it("com quem mostra o aviso, o editor não desenha o próprio aviso", () => {
    const onAviso = vi.fn();
    render(<PremissasEditor premissas={neutras()} desabilitado={false} onMudar={vi.fn()} onAvisoDeDesfazer={onAviso} />);
    const todos = screen.getByLabelText("Clientes jantar, todos os meses");
    fireEvent.change(todos, { target: { value: "13" } });
    fireEvent.keyDown(todos, { key: "Enter" });
    expect(onAviso).toHaveBeenCalledWith(expect.objectContaining({ coluna: "clientesJantar", texto: expect.stringMatching(/12 meses trocados/) }));
    expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull();
  });

  it("desfazerColuna volta só a coluna trocada, sobre as premissas do momento", () => {
    const atuais = neutras().map((p) => ({ ...p, clientesJantar: 0.13, ticketAlmoco: 0.02 }));
    const voltou = desfazerColuna(atuais, { texto: "", coluna: "clientesJantar", anteriores: Array(12).fill(0.1) });
    expect(voltou.every((p) => p.clientesJantar === 0.1 && p.ticketAlmoco === 0.02)).toBe(true);
  });

  it("a barra de salvar empilha o aviso acima da falha, sem esconder os botões", () => {
    const onDesfazer = vi.fn();
    render(
      <BarraDeSalvar salvando={false} podeEditar podeCriar caixaValida sujo falha={{ tipo: "conflito", mensagem: "Conflito" }} onSalvar={vi.fn()} onDescartar={vi.fn()} onSalvarComoCopia={vi.fn()} aviso={{ texto: "12 meses trocados para 8%.", onDesfazer, onFechar: vi.fn() }} />
    );
    const regiao = screen.getByRole("region", { name: "Alterações do cenário" });
    expect(regiao.firstElementChild).toHaveTextContent(/12 meses trocados/);
    expect(within(regiao).getByRole("button", { name: /Salvar as minhas como cópia/ })).toBeInTheDocument();
    fireEvent.click(within(regiao).getByRole("button", { name: "Desfazer" }));
    expect(onDesfazer).toHaveBeenCalled();
  });
});

describe("Trecho do caixa no vermelho", () => {
  const caixa = (saldos: (number | null)[]) => ({ meses: saldos.map((s) => (s === null ? null : { saldo: s })) }) as never;
  it("diz o trecho seguido em palavras", () => {
    expect(trechoNegativo(caixa([10, 5, -1, -2, -3, 4, 1, 1, 1, 1, null, null]))).toBe("de março a maio o caixa fica no vermelho (3 meses seguidos)");
    expect(trechoNegativo(caixa([10, -5, 1, -2, 3, 4, 1, 1, 1, 1, null, null]))).toBe("o caixa fica no vermelho em 2 meses, entre fevereiro e abril");
    expect(trechoNegativo(caixa([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, null, null]))).toBeNull();
  });
});
