import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { EmbalagensDeCompra } from "../EmbalagensDeCompra";
import { lerFator, type ConversaoDoForm } from "../embalagens";

const UNIDADES = [
  { id: "1", code: "CX", name: "Caixa" },
  { id: "2", code: "PCT", name: "Pacote" },
  { id: "3", code: "UN", name: "Unidade" },
  { id: "4", code: "L", name: "Litro" },
  { id: "5", code: "BARRIL", name: "Barril" }
];

const ANTIGA: ConversaoDoForm = {
  fromUnit: "FD", toUnit: "UN", factor: "6", averagePackageWeight: "1.5", notes: "da nota antiga", isActive: false
};

let ultimas: ConversaoDoForm[] = [];

function Tela({ inicial = [], contagem = "UN" }: { inicial?: ConversaoDoForm[]; contagem?: string }) {
  const [conversoes, setConversoes] = useState(inicial);
  const [origem, setOrigem] = useState("");
  const [fator, setFator] = useState("");
  ultimas = conversoes;
  return (
    <EmbalagensDeCompra
      unidades={UNIDADES}
      unidadeDeContagem={contagem}
      conversoes={conversoes}
      origem={origem}
      fator={fator}
      onOrigem={setOrigem}
      onFator={setFator}
      onAdicionar={(c) => { setConversoes([...conversoes, c]); setOrigem(""); setFator(""); }}
      onRemover={(i) => setConversoes(conversoes.filter((_, j) => j !== i))}
    />
  );
}

const origem = () => screen.getByLabelText("Quando a nota vier em") as HTMLSelectElement;
const fator = () => screen.getByLabelText("entram") as HTMLInputElement;
const botao = () => screen.getByRole("button", { name: "Adicionar embalagem" }) as HTMLButtonElement;

describe("Embalagens de compra", () => {
  test("a origem é um select com as unidades cadastradas, sem texto livre", () => {
    render(<Tela />);
    expect(origem().tagName).toBe("SELECT");
    const opcoes = within(origem()).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(opcoes).toEqual(["", "CX", "PCT", "UN", "L", "BARRIL"]);
    // o destino é a unidade de contagem, só texto: nenhum campo para digitar
    expect(screen.queryByPlaceholderText(/PCT, CX/)).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  test("mostra o exemplo calculado ao vivo", () => {
    render(<Tela />);
    fireEvent.change(origem(), { target: { value: "CX" } });
    fireEvent.change(fator(), { target: { value: "12" } });
    expect(screen.getByRole("status").textContent).toBe("Exemplo: 10 CX na nota = 120 UN no estoque.");
    fireEvent.change(fator(), { target: { value: "0,5" } });
    expect(screen.getByRole("status").textContent).toBe("Exemplo: 10 CX na nota = 5 UN no estoque.");
  });

  test.each(["0", "-3", "abc", ""])("recusa o fator inválido %j", (valor) => {
    render(<Tela />);
    fireEvent.change(origem(), { target: { value: "CX" } });
    fireEvent.change(fator(), { target: { value: valor } });
    expect(botao().disabled).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
    if (valor) expect(screen.getByRole("alert").textContent).toMatch(/maior que zero/);
    fireEvent.click(botao());
    expect(ultimas).toHaveLength(0);
  });

  test("recusa origem igual à unidade de contagem", () => {
    render(<Tela />);
    fireEvent.change(origem(), { target: { value: "UN" } });
    fireEvent.change(fator(), { target: { value: "2" } });
    expect(botao().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/diferente de UN/);
  });

  test("avisa quando o produto ainda não tem unidade de contagem", () => {
    render(<Tela contagem="" />);
    expect(screen.getByRole("alert").textContent).toMatch(/unidade padrão/);
    expect(botao().disabled).toBe(true);
  });

  test("a tela limpa não mostra erro", () => {
    render(<Tela />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(botao().disabled).toBe(true);
  });

  test("conversão já cadastrada aparece legível e pode ser removida", () => {
    render(<Tela inicial={[{ ...ANTIGA, fromUnit: "CX", factor: "12" }]} />);
    expect(screen.getByText("1 CX = 12 UN")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "remover" }));
    expect(screen.queryByText("1 CX = 12 UN")).toBeNull();
    expect(ultimas).toEqual([]);
  });

  test("não aceita repetir a mesma embalagem", () => {
    render(<Tela inicial={[{ ...ANTIGA, fromUnit: "CX", factor: "12" }]} />);
    fireEvent.change(origem(), { target: { value: "CX" } });
    fireEvent.change(fator(), { target: { value: "10" } });
    expect(botao().disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/Já existe/);
  });

  test("unidade inválida vinda do banco aparece em destaque, sem quebrar a tela", () => {
    const quebrada: ConversaoDoForm = { ...ANTIGA, fromUnit: "PCT, CX, FD", factor: "50" };
    const { container } = render(<Tela inicial={[quebrada, { ...ANTIGA, fromUnit: "CX", factor: "12" }]} />);
    const destaque = container.querySelector(".embalagem-invalida");
    expect(destaque?.textContent).toMatch(/PCT, CX, FD/);
    expect(screen.getByText("1 CX = 12 UN")).toBeTruthy();
    expect(screen.getAllByRole("alert")[0].textContent).toMatch(/uma conversão com unidade inválida/);
    fireEvent.click(within(destaque as HTMLElement).getByRole("button", { name: "remover" }));
    expect(container.querySelector(".embalagem-invalida")).toBeNull();
  });

  test("devolve intactos os valores antigos e monta a nova no formato do backend", () => {
    render(<Tela inicial={[ANTIGA]} />);
    fireEvent.change(origem(), { target: { value: "CX" } });
    fireEvent.change(fator(), { target: { value: "0,5" } });
    fireEvent.click(botao());
    expect(ultimas).toEqual([
      ANTIGA,
      { fromUnit: "CX", toUnit: "UN", factor: "0.5", averagePackageWeight: "", notes: "", isActive: true }
    ]);
    // o campo volta limpo para a próxima embalagem
    expect(origem().value).toBe("");
    expect(fator().value).toBe("");
  });
});

describe("lerFator", () => {
  test.each([
    ["12", 12], ["0,5", 0.5], ["0.5", 0.5], ["1.000,5", 1000.5], [" 3 ", 3]
  ])("lê %j", (texto, esperado) => expect(lerFator(texto)).toBe(esperado));
  test.each(["", "abc", "1,2,3", "-1", "1e3"])("recusa %j", (texto) => expect(lerFator(texto)).toBeNull());
});

describe("conversão que o sistema já faz sozinho", () => {
  test("litro para barril avisa e não deixa adicionar embalagem", () => {
    render(<Tela contagem="BARRIL" />);
    fireEvent.change(origem(), { target: { value: "L" } });
    fireEvent.change(fator(), { target: { value: "1" } });
    expect(screen.getByRole("alert").textContent).toContain("Quando a compra vier em 50 L, entram 1 BARRIL no estoque (e ao contrário: 1 BARRIL = 50 L)");
    expect((screen.getByRole("button", { name: "Adicionar embalagem" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("barril para litro (estoque em litros) também avisa: 1 BARRIL = 50 L", () => {
    render(<Tela contagem="L" />);
    fireEvent.change(origem(), { target: { value: "BARRIL" } });
    fireEvent.change(fator(), { target: { value: "1" } });
    expect(screen.getByRole("alert").textContent).toContain("Quando a compra vier em 1 BARRIL, entram 50 L no estoque (e ao contrário: 50 L = 1 BARRIL)");
    expect((screen.getByRole("button", { name: "Adicionar embalagem" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
