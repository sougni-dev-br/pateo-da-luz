import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { BarraFiltro, chaveCompetencia, opcoesCompetencia, useFiltro, valorForaDasOpcoes } from "../filtro";
import { aplicarOrdem } from "../ordenacao";

beforeEach(() => window.sessionStorage.clear());

describe("chaveCompetencia", () => {
  test("MM/AAAA vira AAAAMM", () => {
    expect(chaveCompetencia("09/2026")).toBe(202609);
    expect(chaveCompetencia("1/2027")).toBe(202701);
  });

  test("texto fora do formato ou mês inválido não tem chave", () => {
    expect(chaveCompetencia(null)).toBeNull();
    expect(chaveCompetencia("")).toBeNull();
    expect(chaveCompetencia("setembro/2026")).toBeNull();
    expect(chaveCompetencia("13/2026")).toBeNull();
  });

  test("ordena no tempo, não no texto: 12/2026 antes de 01/2027", () => {
    const lista = [{ c: "01/2027" }, { c: "12/2026" }, { c: null }, { c: "02/2026" }];
    const asc = aplicarOrdem(lista, { coluna: "c", direcao: "asc" }, { c: (x) => chaveCompetencia(x.c) });
    expect(asc.map((x) => x.c)).toEqual(["02/2026", "12/2026", "01/2027", null]);
  });
});

describe("opcoesCompetencia", () => {
  test("sem repetição, da mais recente para a mais antiga", () => {
    const lista = ["12/2026", "01/2027", "12/2026", null, "03/2026"].map((c) => ({ c }));
    expect(opcoesCompetencia(lista, (x) => x.c).map((o) => o.valor)).toEqual(["01/2027", "12/2026", "03/2026"]);
  });
});

describe("valorForaDasOpcoes", () => {
  const opcoes = [{ valor: "a", rotulo: "A" }];
  test("valor que não está entre as opções é fora", () => {
    expect(valorForaDasOpcoes("b", opcoes)).toBe(true);
  });
  test("valor existente, vazio ou lista ainda sem opções não é fora", () => {
    expect(valorForaDasOpcoes("a", opcoes)).toBe(false);
    expect(valorForaDasOpcoes("", opcoes)).toBe(false);
    expect(valorForaDasOpcoes(undefined, opcoes)).toBe(false);
    expect(valorForaDasOpcoes("b", [])).toBe(false);
  });
});

describe("useFiltro", () => {
  const pessoas = [{ nome: "Paulo Henrique", apelido: "Paulo", funcao: "Garçom" }, { nome: "Ana", apelido: null, funcao: "Caixa" }];

  test("texto ignora acento e caixa; lista filtra pelo valor exato", () => {
    const { result } = renderHook(() => useFiltro("teste"));
    act(() => result.current.setTexto("GARCOM"));
    expect(result.current.aplicar(pessoas, (p) => `${p.nome} ${p.funcao}`).map((p) => p.nome)).toEqual(["Paulo Henrique"]);
    act(() => { result.current.setTexto(""); result.current.setValor("funcao", "Caixa"); });
    expect(result.current.aplicar(pessoas, (p) => p.nome, { funcao: (p) => p.funcao }).map((p) => p.nome)).toEqual(["Ana"]);
  });

  test("duas chamadas seguidas não se sobrescrevem (usa o estado mais recente)", () => {
    const { result } = renderHook(() => useFiltro("teste"));
    act(() => { result.current.setValor("a", "1"); result.current.setValor("b", "2"); });
    expect(result.current.valores).toEqual({ a: "1", b: "2" });
  });

  test("limparValorSe só tira o valor se ele não mudou", () => {
    const { result } = renderHook(() => useFiltro("teste"));
    act(() => result.current.setValor("pessoa", "p1"));
    act(() => result.current.limparValorSe("pessoa", "p2"));
    expect(result.current.valores.pessoa).toBe("p1");
    act(() => result.current.limparValorSe("pessoa", "p1"));
    expect(result.current.valores.pessoa).toBe("");
    expect(result.current.ativo).toBe(false);
  });

  test("fica guardado na aba do navegador", () => {
    const primeiro = renderHook(() => useFiltro("guardado"));
    act(() => primeiro.result.current.setTexto("ana"));
    primeiro.unmount();
    const { result } = renderHook(() => useFiltro("guardado"));
    expect(result.current.texto).toBe("ana");
  });
});

describe("BarraFiltro", () => {
  function Barra({ opcoes }: { opcoes: Array<{ valor: string; rotulo: string }> }) {
    const filtro = useFiltro("barra");
    return <BarraFiltro filtro={filtro} total={3} visiveis={0} listas={[{ chave: "funcao", rotulo: "Função", opcoes }]} />;
  }

  test("valor guardado que sumiu das opções aparece como não disponível, não como todos", () => {
    window.sessionStorage.setItem("gorjeta-filtro:barra", JSON.stringify({ texto: "", valores: { funcao: "Sommelier" } }));
    render(<Barra opcoes={[{ valor: "Garçom", rotulo: "Garçom" }]} />);
    const select = screen.getByLabelText("Função") as HTMLSelectElement;
    expect(select.value).toBe("Sommelier");
    expect(select.selectedOptions[0].textContent).toBe("Função: (não disponível)");
    expect(screen.getByText(/0 de 3/)).toBeTruthy();
  });

  test("valor válido não ganha a opção extra", () => {
    window.sessionStorage.setItem("gorjeta-filtro:barra", JSON.stringify({ texto: "", valores: { funcao: "Garçom" } }));
    render(<Barra opcoes={[{ valor: "Garçom", rotulo: "Garçom" }]} />);
    expect(screen.queryByText("Função: (não disponível)")).toBeNull();
  });
});
