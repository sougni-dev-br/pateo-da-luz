import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AnaliseConsumo } from "../../../api/client";
import { ConsumoPanel } from "../ConsumoPanel";
import { PERIODO, renderComSessao } from "./fixtures";

const base = (over: Partial<AnaliseConsumo> = {}): AnaliseConsumo => ({
  periodo: PERIODO,
  hojeFicouDeFora: false,
  insumos: [
    { insumoId: "i1", insumo: "Filé mignon", unidade: "KG", consumo: 22.5, consumoFichas: 22.5, consumoRevenda: 0 },
    { insumoId: "i2", insumo: "Cerveja long neck", unidade: "UN", consumo: 120, consumoFichas: 0, consumoRevenda: 120 }
  ],
  cobertura: { receitaTotal: 10000, receitaCoberta: 9000, pct: 0.9, receitaBuffet: 5000, semVinculoTotal: 1 },
  semVinculo: [{ codigo: "P9", nome: "PRATO SEM FICHA", categoria: "PRATOS", receita: 1000, quantidade: 20, motivo: "SEM_VINCULO" }],
  problemas: [],
  ...over
});

describe("ConsumoPanel", () => {
  test("mostra a cobertura em porcentagem e diz que boa cobertura e boa", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    const bloco = screen.getByRole("heading", { name: "Quanto este cálculo explica" }).closest("section")!;
    expect(bloco).toHaveTextContent("90%");
    expect(bloco).toHaveTextContent("Boa cobertura");
  });

  test("cobertura baixa avisa que o numero e um piso, nao um total", () => {
    renderComSessao(<ConsumoPanel dados={base({ cobertura: { receitaTotal: 10000, receitaCoberta: 300, pct: 0.03, receitaBuffet: 0, semVinculoTotal: 5 } })} />);
    expect(screen.getByText("Ainda pouco confiável.")).toBeInTheDocument();
    expect(screen.getByText(/piso, não como total/)).toBeInTheDocument();
  });

  test("cobertura parcial tem aviso proprio", () => {
    renderComSessao(<ConsumoPanel dados={base({ cobertura: { receitaTotal: 10000, receitaCoberta: 6000, pct: 0.6, receitaBuffet: 0, semVinculoTotal: 2 } })} />);
    expect(screen.getByText("Cobertura parcial.")).toBeInTheDocument();
  });

  test("sem vendas, nao inventa cobertura", () => {
    renderComSessao(<ConsumoPanel dados={base({ cobertura: { receitaTotal: 0, receitaCoberta: 0, pct: 0, receitaBuffet: 0, semVinculoTotal: 0 }, insumos: [], semVinculo: [] })} />);
    expect(screen.getByText(/Sem vendas por item neste período/)).toBeInTheDocument();
    expect(screen.queryByText(/Quanto este cálculo explica/)).not.toBeInTheDocument();
  });

  test("explica que o buffet fica de fora e que nao baixa o estoque", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    expect(screen.getByText(/O buffet \(.*\) fica de fora/)).toBeInTheDocument();
    expect(screen.getByText(/Não baixa o estoque nem muda o CMV/)).toBeInTheDocument();
  });

  test("lista o consumo por insumo com a unidade de estoque e a origem", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    const linha = screen.getByRole("row", { name: /Filé mignon/ });
    expect(linha).toHaveTextContent("22,5 KG");
    const cerveja = screen.getByRole("row", { name: /Cerveja long neck/ });
    expect(cerveja).toHaveTextContent("120 UN");
  });

  test("busca insumo sem diferenciar acento nem caixa", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    fireEvent.change(screen.getByLabelText("Buscar insumo"), { target: { value: "file" } });
    expect(screen.getByRole("row", { name: /Filé mignon/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Cerveja/ })).not.toBeInTheDocument();
  });

  test("busca sem resultado avisa", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    fireEvent.change(screen.getByLabelText("Buscar insumo"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum insumo com esse nome.")).toBeInTheDocument();
  });

  test("com muitos insumos mostra os primeiros e deixa mostrar todos", () => {
    const insumos = Array.from({ length: 70 }, (_, i) => ({ insumoId: `i${i}`, insumo: `Insumo ${String(i).padStart(2, "0")}`, unidade: "KG", consumo: 1, consumoFichas: 1, consumoRevenda: 0 }));
    renderComSessao(<ConsumoPanel dados={base({ insumos })} />);
    const tabela = screen.getByRole("table", { name: /Quanto de cada insumo/ });
    expect(within(tabela).getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todos os 70" }));
    expect(within(tabela).getAllByRole("row")).toHaveLength(71);
  });

  test("lista o que vende e nao entra no calculo, com a situacao em palavras", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    const linha = screen.getByRole("row", { name: /PRATO SEM FICHA/ });
    expect(linha).toHaveTextContent("Sem vínculo");
  });

  test("prato com ficha incompleta aparece na lista com o motivo em palavras", () => {
    renderComSessao(<ConsumoPanel dados={base({ semVinculo: [{ codigo: "P7", nome: "NHOQUE", categoria: "PRATOS", receita: 800, quantidade: 12, motivo: "FICHA_INCOMPLETA" }] })} />);
    expect(screen.getByRole("row", { name: /NHOQUE/ })).toHaveTextContent("Ficha com ingrediente fora do cálculo");
  });

  test("diz quantos faltam quando a lista foi cortada", () => {
    renderComSessao(<ConsumoPanel dados={base({ cobertura: { ...base().cobertura, semVinculoTotal: 80 } })} />);
    expect(screen.getByText(/Mostrando os 1 que mais vendem, de 80/)).toBeInTheDocument();
  });

  test("o atalho para a aba Margem so aparece quando permitido", () => {
    const abrir = vi.fn();
    const { unmount } = renderComSessao(<ConsumoPanel dados={base()} onAbrirMargem={abrir} />);
    fireEvent.click(screen.getByRole("button", { name: "Vincular na aba Margem" }));
    expect(abrir).toHaveBeenCalledTimes(1);
    unmount();
    renderComSessao(<ConsumoPanel dados={base()} />);
    expect(screen.queryByRole("button", { name: "Vincular na aba Margem" })).not.toBeInTheDocument();
  });

  test("mostra as fichas para corrigir quando ha problema", () => {
    renderComSessao(<ConsumoPanel dados={base({ problemas: [{ tipo: "SEM_CONVERSAO", origem: "Filé com fritas", insumo: "Molho", detalhe: "Sem conversão de CX para KG." }] })} />);
    expect(screen.getByRole("heading", { name: "Fichas para corrigir" })).toBeInTheDocument();
    expect(screen.getByText(/Sem conversão de CX para KG/)).toBeInTheDocument();
  });

  test("nao mostra a secao de problemas quando esta tudo certo", () => {
    renderComSessao(<ConsumoPanel dados={base()} />);
    expect(screen.queryByRole("heading", { name: "Fichas para corrigir" })).not.toBeInTheDocument();
  });

  test("ocultar valores mascara os reais da cobertura e da lista", () => {
    renderComSessao(<ConsumoPanel dados={base()} />, { ocultar: true });
    expect(screen.queryByText(/R\$ 9\.000/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/R\$ ••••/).length).toBeGreaterThan(0);
  });
});
