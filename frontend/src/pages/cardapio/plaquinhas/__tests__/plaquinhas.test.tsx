import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { BuffetPlateItem } from "../../../../api/client";
import { BuscaPrato } from "../BuscaPrato";
import { FORMATOS, FolhaPlaquinhas, paginar, rotuloDaPlaca, textoDaPlaca } from "../FolhaPlaquinhas";
import { ListaDaFolha } from "../ListaDaFolha";
import { chaveTamanho, comFolga } from "../medidaFonte";
import {
  adicionarEntrada, arrumarNome, buscarPratos, dataCurta, novaEntrada, ordenarPorCategoria, rotuloLista, sugerirCategoria, type Entrada,
} from "../plaquinhasFormato";
import { preencherSemQuebrarHifen, semQuebrarHifen } from "../semQuebrarHifen";

const prato = (namePt: string, nameEn: string, category: string, isActive = true): BuffetPlateItem => ({ id: namePt, namePt, nameEn, category, isActive });
const catalogo = [
  prato("Penne ao molho rosé", "Penne in rosé sauce", "Massas"),
  prato("Salmão ao molho de alcaparras", "Salmon with caper sauce", "Peixes e frutos do mar"),
  prato("Pão de queijo", "Pão de queijo (cheese bread)", "Coffee break"),
  prato("Arroz", "White rice", "Arroz e grãos"),
  prato("Penne antigo", "Old penne", "Massas", false),
];
const porId = new Map(catalogo.map((p) => [p.id, p]));

describe("busca no catálogo", () => {
  test("acha sem acento, por partes, em português ou inglês", () => {
    expect(buscarPratos(catalogo, "salmao alcap", null).map((p) => p.namePt)).toEqual(["Salmão ao molho de alcaparras"]);
    expect(buscarPratos(catalogo, "cheese", null).map((p) => p.namePt)).toEqual(["Pão de queijo"]);
  });

  test("não mostra prato inativo", () => {
    expect(buscarPratos(catalogo, "penne", null).map((p) => p.namePt)).toEqual(["Penne ao molho rosé"]);
  });

  test("categoria sem texto lista a categoria inteira; sem nada, não lista", () => {
    expect(buscarPratos(catalogo, "", "Massas")).toHaveLength(1);
    expect(buscarPratos(catalogo, "  ", null)).toEqual([]);
  });
});

describe("categoria sugerida para prato novo", () => {
  test("segue a categoria dos pratos que começam igual; sem parecido, não sugere", () => {
    expect(sugerirCategoria(catalogo, "Penne ao pesto")).toBe("Massas");
    expect(sugerirCategoria(catalogo, "pão de mel")).toBe("Coffee break");
    expect(sugerirCategoria(catalogo, "Bolo de fubá")).toBeUndefined();
  });
});

describe("nome digitado", () => {
  test.each([
    ["  spaghetti   c/ brocolis", "Spaghetti com brócolis"],
    ["filet de frango c/ catupiry", "Filé de frango com Catupiry"],
    ["farfale ao molho rose", "Farfalle ao molho rosé"],
    ["batata doce assada", "Batata-doce assada"],
    ["tomate com mussarela", "Tomate com muçarela"],
  ])("%s → %s", (entrada, saida) => {
    expect(arrumarNome(entrada)).toBe(saida);
  });
});

describe("entradas da folha", () => {
  test("adicionar prato que já está soma uma plaquinha em vez de duplicar a linha", () => {
    const a = adicionarEntrada([], "Arroz");
    const b = adicionarEntrada(a.entradas, "Arroz");
    expect(b.entradas).toHaveLength(1);
    expect(b.entradas[0].qty).toBe(2);
    expect(b.chave).toBe(a.chave);
  });

  test("não passa de 20 plaquinhas do mesmo prato", () => {
    let es: Entrada[] = [novaEntrada("Arroz", 20)];
    es = adicionarEntrada(es, "Arroz").entradas;
    expect(es[0].qty).toBe(20);
  });

  test("ordenar por categoria segue a ordem do buffet e mantém a ordem dentro da categoria", () => {
    const es = ["Pão de queijo", "Penne ao molho rosé", "fantasma", "Arroz", "Salmão ao molho de alcaparras"].map((id) => novaEntrada(id));
    expect(ordenarPorCategoria(es, porId).map((e) => e.itemId)).toEqual(["Arroz", "Penne ao molho rosé", "Salmão ao molho de alcaparras", "Pão de queijo", "fantasma"]);
  });
});

describe("palavra com hífen", () => {
  test("não quebra a linha no meio de alho-poró nem de grão-de-bico", () => {
    const { container } = render(<div>{semQuebrarHifen("Creme de alho-poró com grão-de-bico")}</div>);
    const blocos = [...container.querySelectorAll(".plq-sem-quebra")].map((e) => e.textContent);
    expect(blocos).toEqual(["alho-poró", "grão-de-bico"]);
    expect(container.textContent).toBe("Creme de alho-poró com grão-de-bico");
  });

  test("texto sem hífen e hífen solto ficam como estão", () => {
    expect(semQuebrarHifen("Arroz branco")).toBe("Arroz branco");
    const { container } = render(<div>{semQuebrarHifen("Massa - opção vegana")}</div>);
    expect(container.querySelector(".plq-sem-quebra")).toBeNull();
  });

  test("o molde de medição recebe a mesma marcação", () => {
    const el = document.createElement("div");
    el.textContent = "antigo";
    preencherSemQuebrarHifen(el, "Batata-doce assada");
    expect(el.querySelector(".plq-sem-quebra")?.textContent).toBe("Batata-doce");
    expect(el.textContent).toBe("Batata-doce assada");
  });
});

describe("tamanho da letra", () => {
  test("dá meio ponto de folga só quando o nome foi reduzido", () => {
    expect(comFolga(22, "std")).toBe(22);
    expect(comFolga(15, "std")).toBe(14.5);
    expect(comFolga(10, "std")).toBe(10);
  });

  test("a medida é por texto: o mesmo prato repetido usa a mesma medida", () => {
    const t = textoDaPlaca({ namePt: "Molho de mostarda e mel", nameEn: "Honey mustard sauce", category: "Molhos" });
    expect(t).toEqual({ sobretitulo: "Molho", nome: "Mostarda e mel", nameEn: "Honey mustard sauce" });
    expect(chaveTamanho("sauce", true, t)).toBe(chaveTamanho("sauce", true, { ...t }));
    // Esconder a categoria não muda o espaço (visibility), então a medida é a mesma: não remede tudo.
    expect(chaveTamanho("sauce", true, t)).toBe(chaveTamanho("sauce", false, t));
    expect(chaveTamanho("sauce", true, t)).not.toBe(chaveTamanho("std", true, t));
  });
});

describe("folha", () => {
  test("paginação respeita quantas cabem por folha e nunca devolve zero folhas", () => {
    expect(paginar(Array.from({ length: 21 }, (_, i) => i), FORMATOS.std.porFolha).map((f) => f.length)).toEqual([10, 10, 1]);
    expect(paginar([], 10)).toEqual([[]]);
  });

  test("molho: MOLHO no alto e só o sabor em destaque", () => {
    expect(rotuloDaPlaca({ namePt: "Molho de mostarda e mel", category: "Molhos" })).toEqual({ sobretitulo: "Molho", nome: "Mostarda e mel" });
    expect(rotuloDaPlaca({ namePt: "Guacamole", category: "Molhos" })).toEqual({ sobretitulo: "Molhos", nome: "Guacamole" });
    expect(rotuloDaPlaca({ namePt: "Molho de queijo no penne", category: "Massas" }).nome).toBe("Molho de queijo no penne");
  });

  test("cada plaquinha sai em português e inglês, com a medida guardada; cavalete desenha as duas faces", () => {
    const placas = [{ key: "a", namePt: "Penne ao molho rosé", nameEn: "Penne in rosé sauce", category: "Massas" }];
    const tamanhos = new Map([[chaveTamanho("std", true, textoDaPlaca(placas[0])), { pt: 16, en: 8.3, estoura: true }]]);
    const { container, rerender } = render(<FolhaPlaquinhas placas={placas} formato="std" tema="wine" mostrarCategoria tamanhos={tamanhos} />);
    expect(screen.getByText("Penne ao molho rosé")).toBeTruthy();
    expect(screen.getByText("Penne in rosé sauce")).toBeTruthy();
    expect((container.querySelector(".plq-nomes") as HTMLElement).style.getPropertyValue("--pt")).toBe("16pt");
    expect(container.querySelector(".plq-placa--estoura")).toBeTruthy();

    rerender(<FolhaPlaquinhas placas={placas} formato="tent" tema="gold" mostrarCategoria tamanhos={new Map()} />);
    expect(screen.getAllByText("Penne in rosé sauce")).toHaveLength(2);
  });

  test("rótulo da lista salva mostra data e total", () => {
    expect(dataCurta("2026-10-09")).toBe("09/10/2026");
    expect(rotuloLista({ name: "Coffee break", eventDate: "2026-10-09", plateCount: 1 })).toBe("Coffee break · 09/10/2026 · 1 plaquinha");
  });
});

describe("busca pelo teclado", () => {
  test("↓ escolhe o próximo, Enter adiciona e a busca limpa para o próximo prato", () => {
    const onAdicionar = vi.fn();
    render(<BuscaPrato catalogo={catalogo} naFolha={new Map()} podeCriar onAdicionar={onAdicionar} onNovoPrato={vi.fn()} />);
    const campo = screen.getByRole("combobox");
    fireEvent.change(campo, { target: { value: "penne" } });
    fireEvent.change(campo, { target: { value: "a" } });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    const segundo = screen.getAllByRole("option")[1].textContent ?? "";
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onAdicionar).toHaveBeenCalledTimes(1);
    expect(segundo).toContain(onAdicionar.mock.calls[0][0]);
    expect((campo as HTMLInputElement).value).toBe("");
  });

  test("Enter sem resultado abre o cadastro de prato novo com o texto digitado", () => {
    const onNovoPrato = vi.fn();
    render(<BuscaPrato catalogo={catalogo} naFolha={new Map()} podeCriar onAdicionar={vi.fn()} onNovoPrato={onNovoPrato} />);
    const campo = screen.getByRole("combobox");
    fireEvent.change(campo, { target: { value: "bolo de fubá" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onNovoPrato).toHaveBeenCalledWith("bolo de fubá", null);
  });

  test("quem não pode cadastrar vê aviso em vez do botão", () => {
    render(<BuscaPrato catalogo={catalogo} naFolha={new Map()} podeCriar={false} onAdicionar={vi.fn()} onNovoPrato={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "bolo de fubá" } });
    expect(screen.getByText("Nenhum prato com esse nome no catálogo.")).toBeTruthy();
  });
});

function ListaControlada({ inicial }: { inicial: Entrada[] }) {
  const [entradas, setEntradas] = useState(inicial);
  return <ListaDaFolha entradas={entradas} porId={porId} destaque={null} onMudar={(fn) => setEntradas(fn)} />;
}

describe("lista da folha", () => {
  test("tirar um prato oferece desfazer, que devolve na mesma posição", () => {
    vi.useFakeTimers();
    try {
      render(<ListaControlada inicial={["Arroz", "Penne ao molho rosé", "Pão de queijo"].map((id) => novaEntrada(id))} />);
      fireEvent.click(screen.getByRole("button", { name: "Tirar Penne ao molho rosé da folha" }));
      expect(screen.queryByText("Penne in rosé sauce")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
      const nomes = screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
      expect(nomes).toEqual(["Arroz", "Penne ao molho rosé", "Pão de queijo"]);

      fireEvent.click(screen.getByRole("button", { name: "Tirar Arroz da folha" }));
      act(() => { vi.advanceTimersByTime(6100); });
      expect(screen.queryByRole("button", { name: /Desfazer/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("quantidade fica entre 1 e 20", () => {
    render(<ListaControlada inicial={[novaEntrada("Arroz", 1)]} />);
    expect((screen.getByRole("button", { name: "Uma plaquinha a menos de Arroz" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Uma plaquinha a mais de Arroz" }));
    expect(screen.getByLabelText("Plaquinhas de Arroz").textContent).toBe("2");
  });
});

vi.mock("../../../../api/client", async (original) => ({
  ...(await original<typeof import("../../../../api/client")>()),
  deactivateBuffetPlateItem: vi.fn(async (id: string) => ({ ...catalogo.find((p) => p.id === id)!, isActive: false })),
  saveBuffetPlateItem: vi.fn(async (dados: Omit<BuffetPlateItem, "id">, id: string) => ({ ...dados, id })),
  getBuffetUsage: vi.fn(async () => ({ period: { start: "2026-09-05", end: "2026-10-04", windowDays: 30, servedDays: 0 }, ranking: [], staples: [], repeating: [], forgotten: [] })),
  getBuffetPlatePrints: vi.fn(async () => []),
}));

describe("catálogo", () => {
  test("inativar avisa qual prato saiu e o Desfazer devolve ele", async () => {
    const { CatalogoPlaquinhas } = await import("../CatalogoPlaquinhas");
    const aoMudar = vi.fn();
    render(<CatalogoPlaquinhas catalogo={catalogo} podeCriar podeEditar podeExcluir aoMudar={aoMudar} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Inativar Arroz" })); });
    expect(aoMudar).toHaveBeenLastCalledWith(expect.objectContaining({ id: "Arroz", isActive: false }));
    expect(screen.getByRole("status")).toHaveTextContent("“Arroz” saiu da busca");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Desfazer/ })); });
    expect(aoMudar).toHaveBeenLastCalledWith(expect.objectContaining({ id: "Arroz", isActive: true }));
    expect(screen.queryByText(/saiu da busca/)).toBeNull();
  });
});

describe("prévia", () => {
  test("vazia explica o que fazer em vez de mostrar uma folha em branco", async () => {
    const { PreviaFolhas } = await import("../PreviaFolhas");
    render(<PreviaFolhas resumo="" alerta={null} tema="white" vazia textoVazia="Abra uma lista salva."><div>folha</div></PreviaFolhas>);
    expect(screen.getByText("A prévia aparece aqui")).toBeInTheDocument();
    expect(screen.getByText("Abra uma lista salva.")).toBeInTheDocument();
    expect(screen.getByText("folha").closest("[hidden]")).not.toBeNull();
  });
});

const relatorio = {
  period: { start: "2026-09-05", end: "2026-10-04", windowDays: 30, servedDays: 20 },
  ranking: [{ itemId: "Penne ao molho rosé", days: 12, share: 0.6, lastDay: "2026-10-04" }],
  staples: [],
  repeating: ["Penne ao molho rosé"],
  forgotten: [
    { itemId: "Salmão ao molho de alcaparras", daysInHistory: 6, lastDay: "2026-09-10", daysSince: 24 },
    { itemId: "Penne antigo", daysInHistory: 5, lastDay: "2026-09-01", daysSince: 33 },
  ],
};

describe("lembretes na hora de montar a folha", () => {
  test("lembra o esquecido que não está na folha e põe com um toque; prato inativo não é lembrado", async () => {
    const { LembretesDoBuffet } = await import("../LembretesDoBuffet");
    const porId = new Map(catalogo.map((p) => [p.id, p]));
    const onAdicionar = vi.fn();
    render(<LembretesDoBuffet relatorio={relatorio} porId={porId} naFolha={new Map()} onAdicionar={onAdicionar} />);
    fireEvent.click(screen.getByRole("button", { name: /Salmão ao molho de alcaparras/ }));
    expect(onAdicionar).toHaveBeenCalledWith("Salmão ao molho de alcaparras");
    expect(screen.queryByText(/Penne antigo/)).toBeNull();
    expect(screen.queryByText(/Saindo demais/)).toBeNull();
  });

  test("avisa quando um prato da folha está saindo demais", async () => {
    const { LembretesDoBuffet } = await import("../LembretesDoBuffet");
    const porId = new Map(catalogo.map((p) => [p.id, p]));
    render(<LembretesDoBuffet relatorio={relatorio} porId={porId} naFolha={new Map([["Penne ao molho rosé", 1], ["Salmão ao molho de alcaparras", 1]])} onAdicionar={vi.fn()} />);
    expect(screen.getByText(/saiu em 12 dos 20 dias de buffet/)).toBeInTheDocument();
    expect(screen.queryByText(/Faz tempo que não sai/)).toBeNull();
  });

  test("sem nada a dizer, não ocupa espaço", async () => {
    const { LembretesDoBuffet } = await import("../LembretesDoBuffet");
    const { container } = render(<LembretesDoBuffet relatorio={{ ...relatorio, repeating: [], forgotten: [] }} porId={new Map()} naFolha={new Map()} onAdicionar={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("aba de acompanhamento", () => {
  test("sem impressões registradas explica de onde vêm os números", async () => {
    const { AcompanhamentoPratos } = await import("../AcompanhamentoPratos");
    render(<AcompanhamentoPratos ativa catalogo={catalogo} podeExcluir versao={0} aoMudar={vi.fn()} />);
    expect(await screen.findByText("Ainda sem registros")).toBeInTheDocument();
    expect(screen.getByText(/Cada vez que a cozinha imprime as plaquinhas/)).toBeInTheDocument();
  });
});

describe("arquivo para gráfica", () => {
  test("página = corte + 2 mm de sangria + margem das marcas, em cada formato", async () => {
    const { paginaDaGrafica } = await import("../ArquivoGrafica");
    expect(paginaDaGrafica("std")).toEqual({ largura: 90, altura: 65 });
    expect(paginaDaGrafica("sauce")).toEqual({ largura: 79, altura: 54 });
  });

  test("uma página por prato, com a quantidade escrita, a sangria na cor do tema e as 8 marcas de corte", async () => {
    const { ArquivoGrafica } = await import("../ArquivoGrafica");
    const pratos = [
      { key: "a", namePt: "Arroz", nameEn: "White rice", category: "Arroz e grãos", qty: 3 },
      { key: "b", namePt: "Penne ao molho rosé", nameEn: "Penne in rosé sauce", category: "Massas", qty: 1 },
    ];
    const { container } = render(<ArquivoGrafica pratos={pratos} formato="std" tema="gold" mostrarCategoria tamanhos={new Map()} />);
    const paginas = container.querySelectorAll(".plq-grafica-pagina");
    expect(paginas).toHaveLength(2);
    expect(paginas[0]).toHaveTextContent("Arroz · Qtd. 3 · corte 74 × 49 mm");
    expect(paginas[1]).toHaveTextContent("2/2 (4 no total)");
    expect(paginas[0].querySelector(".plq-grafica-sangria--gold")).not.toBeNull();
    expect(paginas[0].querySelectorAll(".plq-marca")).toHaveLength(8);
  });
});
