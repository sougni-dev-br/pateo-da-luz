import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlanejamentoCaixaPremissas } from "../../../api/client";
import { CaixaEditor } from "../CaixaEditor";
import { mixFecha, somaDoMix } from "../caixa";
import { textoParaDias } from "../formato";

const padrao = (): PlanejamentoCaixaPremissas => ({
  saldoInicial: 0,
  formas: [
    { forma: "DINHEIRO", mix: 0.1, prazoDias: 0, taxa: 0 },
    { forma: "PIX", mix: 0.3, prazoDias: 0, taxa: 0 },
    { forma: "DEBITO", mix: 0.25, prazoDias: 1, taxa: 0 },
    { forma: "CREDITO", mix: 0.3, prazoDias: 30, taxa: 0 },
    { forma: "VOUCHER", mix: 0.05, prazoDias: 30, taxa: 0 }
  ],
  comprasPrazoDias: 30,
  herdado: { entradas: [0, 0, 0], saidas: [0, 0, 0] }
});

function montar(caixa = padrao(), desabilitado = false) {
  const onMudar = vi.fn<(proximo: PlanejamentoCaixaPremissas) => void>();
  render(<CaixaEditor caixa={caixa} desabilitado={desabilitado} onMudar={onMudar} />);
  return onMudar;
}

describe("regras do mix", () => {
  it("fecha quando soma 100% e acusa quando não", () => {
    expect(somaDoMix(padrao())).toBeCloseTo(1, 9);
    expect(mixFecha(padrao())).toBe(true);
    const aberto = { ...padrao(), formas: padrao().formas.map((f, i) => (i === 0 ? { ...f, mix: 0.2 } : f)) };
    expect(mixFecha(aberto)).toBe(false);
  });

  it("dias: só inteiros não negativos", () => {
    expect(textoParaDias("30")).toBe(30);
    expect(textoParaDias(" 7 ")).toBe(7);
    expect(textoParaDias("1,5")).toBeNull();
    expect(textoParaDias("-3")).toBeNull();
    expect(textoParaDias("")).toBeNull();
  });
});

describe("CaixaEditor", () => {
  it("muda só o prazo da forma digitada, em dias inteiros", () => {
    const onMudar = montar();
    fireEvent.change(screen.getByLabelText("Débito, prazo em dias"), { target: { value: "2" } });
    const proximo = onMudar.mock.calls[0][0];
    expect(proximo.formas.find((f) => f.forma === "DEBITO")?.prazoDias).toBe(2);
    expect(proximo.formas.find((f) => f.forma === "CREDITO")?.prazoDias).toBe(30);
  });

  it("prazo acima de 90 dias, taxa acima de 20% e texto não chegam ao pai", () => {
    const onMudar = montar();
    fireEvent.change(screen.getByLabelText("Crédito, prazo em dias"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Crédito, taxa em %"), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText("PIX, mix em %"), { target: { value: "abc" } });
    expect(onMudar).not.toHaveBeenCalled();
  });

  it("taxa e mix chegam como fração", () => {
    const onMudar = montar();
    fireEvent.change(screen.getByLabelText("Crédito, taxa em %"), { target: { value: "2,5" } });
    expect(onMudar.mock.calls[0][0].formas.find((f) => f.forma === "CREDITO")?.taxa).toBe(0.025);
  });

  it("mix que não fecha 100% avisa na tela", () => {
    montar({ ...padrao(), formas: padrao().formas.map((f, i) => (i === 0 ? { ...f, mix: 0.4 } : f)) });
    expect(screen.getByRole("alert")).toHaveTextContent(/O mix soma 130%: sobram 30 pontos para fechar 100%.*não pode ser salvo/);
  });

  it("saldo inicial, prazo das compras e herdados são editáveis", () => {
    const onMudar = montar();
    fireEvent.change(screen.getByLabelText("Caixa no começo de janeiro"), { target: { value: "50.000" } });
    expect(onMudar.mock.calls[0][0].saldoInicial).toBe(50000);
    fireEvent.change(screen.getByLabelText("Prazo de pagamento das compras, em dias"), { target: { value: "45" } });
    expect(onMudar.mock.calls[1][0].comprasPrazoDias).toBe(45);
    fireEvent.change(screen.getByLabelText("A receber herdado em Fev"), { target: { value: "8.000" } });
    expect(onMudar.mock.calls[2][0].herdado.entradas).toEqual([0, 8000, 0]);
    fireEvent.change(screen.getByLabelText("A pagar herdado em Mar"), { target: { value: "1.500" } });
    expect(onMudar.mock.calls[3][0].herdado.saidas).toEqual([0, 0, 1500]);
  });

  it("somente leitura desabilita os campos", () => {
    montar(padrao(), true);
    expect(screen.getByLabelText("Crédito, prazo em dias")).toBeDisabled();
    expect(screen.getByLabelText("Caixa no começo de janeiro")).toBeDisabled();
  });
});
