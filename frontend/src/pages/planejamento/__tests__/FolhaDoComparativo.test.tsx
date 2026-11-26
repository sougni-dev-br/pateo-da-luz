import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FolhaDoComparativo } from "../impressao/FolhaDoComparativo";
import { notasDaFolha } from "../impressao/notasDaFolha";
import { comentarioFicticio, comparativoFicticio } from "./fixturesComentarios";

const lista = [
  comentarioFicticio({ id: "a", texto: "Texto do jantar", turno: "JANTAR", mes: 3 }),
  comentarioFicticio({ id: "b", texto: "Texto de vendas", mes: 2 }),
  comentarioFicticio({ id: "c", texto: "SEGREDO que não imprime", naImpressao: false }),
  comentarioFicticio({ id: "d", texto: "Texto de clientes", metrica: "CLIENTES", mes: null })
];

describe("notasDaFolha", () => {
  it("numera na ordem da folha e conta os não incluídos", () => {
    const r = notasDaFolha(lista, 2026);
    expect(r.notas.map((n) => [n.numero, n.comentario.id])).toEqual([[1, "a"], [2, "b"], [3, "d"]]);
    expect(r.naoIncluidos).toBe(1);
    expect(r.numerosDe("3|VENDAS|JANTAR")).toEqual([1]);
  });
});

describe("FolhaDoComparativo", () => {
  it("imprime só os marcados, as três grandezas e o aviso sem o texto dos demais", () => {
    const { container } = render(<FolhaDoComparativo dados={comparativoFicticio()} comentarios={lista} geradoPor="Ana Teste" geradoEm={new Date("2026-11-25T15:00:00Z")} />);
    expect(screen.getByText("Texto do jantar")).toBeInTheDocument();
    expect(screen.getByText("Texto de clientes")).toBeInTheDocument();
    expect(screen.queryByText(/SEGREDO/)).toBeNull();
    expect(screen.getByText("1 comentário não incluído nesta impressão.")).toBeInTheDocument();
    expect(screen.getByText(/Vendas mês a mês/)).toBeInTheDocument();
    expect(screen.getByText(/Clientes mês a mês/)).toBeInTheDocument();
    expect(screen.getByText(/Ticket médio mês a mês/)).toBeInTheDocument();
    expect(container.querySelectorAll("sup.fcmp-nota")).toHaveLength(3);
  });

  it("a nota leva o número da época, com os valores mesmo na folha", () => {
    const comEpoca = [comentarioFicticio({ id: "e", texto: "Obra na rua", epoca: { valorBase: 341000, valorComparado: 216000, variacao: -0.3666 } })];
    render(<FolhaDoComparativo dados={comparativoFicticio()} comentarios={comEpoca} geradoPor="Ana Teste" geradoEm={new Date("2026-11-25T15:00:00Z")} />);
    expect(screen.getByText("escrito quando estava −36,7% (R$ 216 mil contra R$ 341 mil)")).toBeInTheDocument();
  });
});
