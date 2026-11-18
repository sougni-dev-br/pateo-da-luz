import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { BuffetPot } from "../../../../api/client";
import { FolhaPesagem } from "../FolhaPesagem";

const panelas: BuffetPot[] = [
  { id: "p1", code: "P01", name: null, tareG: 2400, isActive: true },
  { id: "p2", code: "P02", name: "inox 10 L", tareG: 3150, isActive: true },
];

describe("folha de pesagem impressa", () => {
  test("traz cabeçalho, o peso vazio de cada panela e uma linha por prato mais linhas em branco", () => {
    render(<FolhaPesagem dataTexto="18/11/2026" tipoTexto="Buffet do dia" listaNome="Buffet Executivo"
      pratos={[{ id: "a", nome: "Arroz branco" }, { id: "b", nome: "Feijão" }]} panelas={panelas} />);
    expect(screen.getByText("Buffet do dia · 18/11/2026 · Buffet Executivo")).toBeInTheDocument();
    expect(screen.getByText("2,4 kg")).toBeInTheDocument();
    expect(screen.getByText("3,15 kg")).toBeInTheDocument();
    const tabela = screen.getAllByRole("table")[1];
    // 2 linhas de cabeçalho + 2 pratos + 4 em branco
    expect(within(tabela).getAllByRole("row")).toHaveLength(8);
    expect(within(tabela).getByText("Arroz branco")).toBeInTheDocument();
    expect(within(tabela).getByText("Reposição")).toBeInTheDocument();
    expect(within(tabela).getByText("Sobra")).toBeInTheDocument();
  });

  test("sem lista, o cabeçalho não mostra nome de lista", () => {
    render(<FolhaPesagem dataTexto="18/11/2026" tipoTexto="Coffee break" listaNome={null} pratos={[]} panelas={panelas} />);
    expect(screen.getByText("Coffee break · 18/11/2026")).toBeInTheDocument();
  });
});
