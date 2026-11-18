import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Pendencias } from "../Pendencias";
import { idLinhaDaPessoa, irParaLinhaDaPessoa, irParaLinhaQuandoPronta } from "../irParaPessoa";

const NOMES = new Map([["a", "Ana"], ["b", "Bia"]]);
const AVISO = "Sem data de admissão (considerados no período inteiro): Ana, Bia.";
const PENDENCIA = "A distribuição (R$ 10,00) passa do líquido (R$ 9,00) em R$ 1,00. Reduza pontos ou ajustes.";
const SITUACAO = [
  { gravidade: "AVISO" as const, texto: AVISO, employeeIds: ["a", "b"] },
  { gravidade: "PENDENCIA" as const, texto: PENDENCIA, employeeIds: ["a"] },
];

function abrir(onIrPessoa = vi.fn(), over: Partial<Parameters<typeof Pendencias>[0]> = {}) {
  render(<Pendencias pendencias={[PENDENCIA]} avisos={[AVISO]} fechado={false} situacao={SITUACAO} nomes={NOMES} onIrPessoa={onIrPessoa} {...over} />);
  return onIrPessoa;
}

describe("Pendencias: ir até a linha da pessoa", () => {
  test("pendência que cita alguém ganha o botão e leva à pessoa", () => {
    const ir = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Ir para Ana na tabela" }));
    expect(ir).toHaveBeenCalledWith("a");
  });

  test("os avisos recolhidos mostram um botão por pessoa citada", () => {
    const ir = abrir();
    fireEvent.click(screen.getByRole("button", { name: /1 para conferir/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ir para Bia na tabela" }));
    expect(ir).toHaveBeenCalledWith("b");
  });

  test("sem a lista de pessoas (resposta antiga) o painel segue igual, sem botões", () => {
    abrir(vi.fn(), { situacao: undefined });
    expect(screen.queryByRole("button", { name: /Ir para Ana/ })).toBeNull();
    expect(screen.getByText(/A distribuição/)).toBeInTheDocument();
  });

  test("texto que cita gente demais não vira uma fila de botões", () => {
    const muitos = Array.from({ length: 9 }, (_, i) => `p${i}`);
    abrir(vi.fn(), { situacao: [{ gravidade: "PENDENCIA", texto: PENDENCIA, employeeIds: muitos }], nomes: new Map(muitos.map((id) => [id, id])) });
    expect(screen.queryByRole("button", { name: /Ir para/ })).toBeNull();
  });

  test("fechado não mostra nada", () => {
    abrir(vi.fn(), { fechado: true });
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("Pendencias: saídas sem valor", () => {
  test("a saída agrupada também leva até a pessoa", () => {
    const texto = 'Ana: saiu em 10/11 e falta o valor da rescisão. Em "Rescisões do período", digite a gorjeta paga.';
    const ir = vi.fn();
    render(<Pendencias pendencias={[texto]} avisos={[]} fechado={false} situacao={[{ gravidade: "PENDENCIA", texto, employeeIds: ["a"] }]} nomes={NOMES} onIrPessoa={ir} />);
    fireEvent.click(screen.getByRole("button", { name: "Ir para Ana na tabela" }));
    expect(ir).toHaveBeenCalledWith("a");
  });
});

describe("irParaLinhaDaPessoa", () => {
  test("destaca e foca a linha; devolve false quando ela não existe", () => {
    document.body.innerHTML = `<table><tbody><tr id="${idLinhaDaPessoa("a")}"></tr></tbody></table>`;
    const linha = document.getElementById(idLinhaDaPessoa("a"))!;
    linha.scrollIntoView = vi.fn();
    expect(irParaLinhaDaPessoa("a")).toBe(true);
    expect(linha.classList.contains("linha-destacada")).toBe(true);
    expect(document.activeElement).toBe(linha);
    expect(irParaLinhaDaPessoa("zzz")).toBe(false);
  });

  test("espera a aba desenhar e avisa só se a linha nunca aparecer", () => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    const aoFalhar = vi.fn();
    irParaLinhaQuandoPronta("a", aoFalhar);
    vi.advanceTimersByTime(300);
    expect(aoFalhar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(aoFalhar).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
