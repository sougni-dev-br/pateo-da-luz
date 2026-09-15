import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DocIntakeAviso } from "../../api/client";
import { AvisosDoTitulo } from "../AvisosDoTitulo";

const BLOQUEIO: DocIntakeAviso = {
  nivel: "BLOQUEIO",
  codigo: "JA_LANCADO",
  mensagem: "Já existe lançamento ativo deste fornecedor com a nota 01454727.",
};

const ATENCAO: DocIntakeAviso = {
  nivel: "ATENCAO",
  codigo: "LIDO_POR_IMAGEM",
  mensagem: "Documento fotografado: confira valor e vencimento.",
};

const OUTRA_ATENCAO: DocIntakeAviso = {
  nivel: "ATENCAO",
  codigo: "FORNECEDOR_NAO_CADASTRADO",
  mensagem: "Fornecedor não está cadastrado.",
};

const DUPLICATA = { invoiceNumber: "01454727", totalAmount: "209.00" };

describe("Bloqueio — sempre à vista", () => {
  test("aparece sem precisar expandir, porque impede o lançamento", () => {
    render(<AvisosDoTitulo avisos={[BLOQUEIO]} duplicatas={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Já existe lançamento ativo/);
  });

  test("cada bloqueio tem seu próprio alerta", () => {
    render(<AvisosDoTitulo avisos={[BLOQUEIO, { ...BLOQUEIO, codigo: "SEM_VALOR", mensagem: "Valor não identificado." }]} duplicatas={[]} />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});

describe("Atenção — recolhida, mas contada", () => {
  test("mostra quantas são, sem ocupar a tela", () => {
    // O desenho anterior empilhava alertas grandes e empurrava o formulário
    // para fora da tela — na prática, ninguém lia nenhum.
    render(<AvisosDoTitulo avisos={[ATENCAO, OUTRA_ATENCAO]} duplicatas={[]} />);

    expect(screen.getByText(/2 pontos de atenção/i)).toBeInTheDocument();
    expect(screen.queryByText(/Fornecedor não está cadastrado/)).not.toBeInTheDocument();
  });

  test("deixa claro que não impedem o lançamento", () => {
    render(<AvisosDoTitulo avisos={[ATENCAO]} duplicatas={[]} />);
    expect(screen.getByText(/não impedem o lançamento/i)).toBeInTheDocument();
  });

  test("expandir mostra o conteúdo de cada uma", () => {
    render(<AvisosDoTitulo avisos={[ATENCAO, OUTRA_ATENCAO]} duplicatas={[]} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText(/Documento fotografado/)).toBeInTheDocument();
    expect(screen.getByText(/Fornecedor não está cadastrado/)).toBeInTheDocument();
  });

  test("usa singular quando é só uma", () => {
    render(<AvisosDoTitulo avisos={[ATENCAO]} duplicatas={[]} />);
    expect(screen.getByText(/1 ponto de atenção/i)).toBeInTheDocument();
  });
});

describe("Títulos parecidos já lançados", () => {
  test("entram na contagem de atenção", () => {
    render(<AvisosDoTitulo avisos={[]} duplicatas={[DUPLICATA]} />);
    expect(screen.getByText(/1 ponto de atenção/i)).toBeInTheDocument();
  });

  test("ao expandir, mostram a nota e o valor para comparação", () => {
    render(<AvisosDoTitulo avisos={[]} duplicatas={[DUPLICATA]} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText(/Títulos parecidos já lançados/)).toBeInTheDocument();
    expect(screen.getByText(/01454727/)).toBeInTheDocument();
    expect(screen.getByText(/209\.00/)).toBeInTheDocument();
  });

  test("somam com as demais atenções na contagem", () => {
    render(<AvisosDoTitulo avisos={[ATENCAO]} duplicatas={[DUPLICATA]} />);
    expect(screen.getByText(/2 pontos de atenção/i)).toBeInTheDocument();
  });
});

describe("Sem avisos", () => {
  test("não renderiza nada — card limpo é informação também", () => {
    const { container } = render(<AvisosDoTitulo avisos={[]} duplicatas={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
