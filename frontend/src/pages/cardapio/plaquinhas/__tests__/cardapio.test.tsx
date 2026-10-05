import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { BuffetMenuSection } from "../../../../api/client";
import { CampoCm } from "../CampoCm";
import { FaceCardapio } from "../FaceCardapio";
import { FONTE_MAX_PRATO, TAMANHO_DISPLAY, facesParaImprimir, gruposDasFaces, inglesDoTitulo, layoutDaFolha, pendenciasDoCardapio } from "../cardapioFormato";
import { esperarImagens } from "../impressao";

const secao = (face: "front" | "back", titlePt: string, items: Array<[string, string]>, titleEn = "Title"): BuffetMenuSection =>
  ({ face, titlePt, titleEn, items: items.map(([namePt, nameEn]) => ({ namePt, nameEn })) });

describe("encaixe das faces na folha A4", () => {
  test("display de acrílico (9,4 × 9,0 cm): 6 por folha, em pé, frente e verso lado a lado", () => {
    expect(TAMANHO_DISPLAY).toEqual({ largura: 94, altura: 90 });
    expect(layoutDaFolha(94, 90)).toEqual({ orientacao: "portrait", colunas: 2, linhas: 3, porFolha: 6 });
  });

  test("tamanho da planilha (9,2 × 7,6 cm): 6 por folha, em pé, frente e verso lado a lado", () => {
    expect(layoutDaFolha(92, 76)).toEqual({ orientacao: "portrait", colunas: 2, linhas: 3, porFolha: 6 });
  });

  test("A5 cabe uma por folha; face deitada escolhe a folha deitada", () => {
    expect(layoutDaFolha(148, 210)?.porFolha).toBe(1);
    expect(layoutDaFolha(260, 180)?.orientacao).toBe("landscape");
  });

  test("maior que a folha não tem encaixe", () => {
    expect(layoutDaFolha(250, 250)).toBeNull();
  });
});

describe("faces por display", () => {
  const entradas = secao("front", "Entradas", [["Saladinha do Pateo", "Pateo side salad"]]);
  const doces = secao("back", "Doces", [["Brigadeiro", "Brigadeiro (chocolate truffle)"]]);

  test("mesmo cardápio: com seção no verso, cada display leva frente e verso, nessa ordem", () => {
    const grupos = gruposDasFaces([entradas, doces], "same");
    const faces = facesParaImprimir(grupos, 2, "same");
    expect(faces.map((f) => f.chave)).toEqual(["1-front", "1-back", "2-front", "2-back"]);
    expect(grupos.map((g) => [g.chave, g.comLogo, g.secoes.length])).toEqual([["front", true, 1], ["back", false, 1]]);
  });

  test("mesmo cardápio: sem nada no verso, só a frente", () => {
    const faces = facesParaImprimir(gruposDasFaces([entradas], "same"), 3, "same");
    expect(faces.map((f) => f.face)).toEqual(["front", "front", "front"]);
  });

  test("um display por seção: cada seção ocupa frente e verso do seu display, com logo nas duas", () => {
    const grupos = gruposDasFaces([entradas, doces], "perSection");
    expect(grupos.map((g) => [g.chave, g.rotulo, g.comLogo])).toEqual([["s0", "em “Entradas”", true], ["s1", "em “Doces”", true]]);
    const faces = facesParaImprimir(grupos, 2, "perSection");
    expect(faces.map((f) => `${f.display}${f.face[0]}:${f.grupo}`)).toEqual(["1f:s0", "1b:s0", "2f:s0", "2b:s0", "3f:s1", "3b:s1", "4f:s1", "4b:s1"]);
  });

  test("um display por prato: cada prato é um display com a seção em cima, e a letra pode crescer", () => {
    const bebidas = secao("front", "Bebidas", [["Café", "Brewed coffee"], ["Leite integral", "Whole milk"]]);
    const grupos = gruposDasFaces([bebidas, doces], "perItem");
    expect(grupos.map((g) => g.rotulo)).toEqual(["em “Café”", "em “Leite integral”", "em “Brigadeiro”"]);
    expect(grupos[1].secoes).toEqual([{ ...bebidas, items: [bebidas.items[1]] }]);
    expect(grupos.every((g) => g.comLogo && g.maxPt === FONTE_MAX_PRATO)).toBe(true);
    const faces = facesParaImprimir(grupos, 1, "perItem");
    expect(faces.map((f) => `${f.display}${f.face[0]}`)).toEqual(["1f", "1b", "2f", "2b", "3f", "3b"]);
  });

  test("um por prato com quantidade: cada prato sai quantas vezes foi pedido", () => {
    const bebidas: BuffetMenuSection = { face: "front", titlePt: "Bebidas", titleEn: "Drinks", items: [{ namePt: "Café", nameEn: "Brewed coffee", qty: 3 }, { namePt: "Leite", nameEn: "Milk" }] };
    const grupos = gruposDasFaces([bebidas], "perItem");
    expect(grupos.map((g) => g.copias)).toEqual([3, 1]);
    const faces = facesParaImprimir(grupos, 5, "perItem");
    expect(faces.filter((f) => f.face === "front").map((f) => f.grupo)).toEqual(["s0:0", "s0:0", "s0:0", "s0:1"]);
  });

  test("com as chaves de edição, o display escolhido continua o mesmo depois de apagar um prato antes dele", () => {
    const sec = (itens: string[]) => [secao("front", "Doces", itens.map((n) => [n, n] as [string, string]))];
    const antes = gruposDasFaces(sec(["Brigadeiro", "Beijinho", "Pudim"]), "perItem", [{ secao: "a", itens: ["k1", "k2", "k3"] }]);
    const depois = gruposDasFaces(sec(["Brigadeiro", "Pudim"]), "perItem", [{ secao: "a", itens: ["k1", "k3"] }]);
    const pudimAntes = antes.find((g) => g.secoes[0].items[0].namePt === "Pudim")!.chave;
    expect(depois.find((g) => g.chave === pudimAntes)?.secoes[0].items[0].namePt).toBe("Pudim");
  });

  test("igual em todos com tudo no verso: o verso vira a frente, sem frente em branco", () => {
    const grupos = gruposDasFaces([secao("back", "Doces", [["Pudim", "Pudding"]])], "same");
    expect(grupos.map((g) => [g.chave, g.comLogo, g.secoes.length])).toEqual([["front", true, 1]]);
  });

  test("seis seções num display cada: 12 faces, cabem em duas folhas no tamanho do display", () => {
    const seis = Array.from({ length: 6 }, (_, i) => secao("front", `Seção ${i + 1}`, [["Café", "Brewed coffee"]]));
    const faces = facesParaImprimir(gruposDasFaces(seis, "perSection"), 1, "perSection");
    expect(faces).toHaveLength(12);
    expect(Math.ceil(faces.length / layoutDaFolha(94, 90)!.porFolha)).toBe(2);
  });
});

describe("o que impede salvar ou imprimir", () => {
  test("cardápio completo não tem pendência", () => {
    expect(pendenciasDoCardapio("Evento", [secao("front", "Entradas", [["Saladinha do Pateo", "Pateo side salad"]])])).toEqual([]);
  });

  test("aponta prato sem inglês pelo nome, título sem inglês e seção vazia", () => {
    const p = pendenciasDoCardapio("", [
      secao("back", "Pratos", [["Polvo grelhado", " "]]),
      secao("front", "Entradas", [], ""),
    ]);
    expect(p).toEqual([
      "Dê um nome para o cardápio.",
      "Pratos: falta o inglês de “Polvo grelhado”.",
      "Entradas: falta o título em inglês.",
      "Entradas: adicione pelo menos um prato.",
    ]);
  });
});

describe("face do cardápio", () => {
  test("frente leva o logo e só as seções do grupo, em português e inglês", () => {
    const secoes = [
      secao("front", "Entradas", [["Saladinha do Pateo", "Pateo side salad"]], "Starters"),
      secao("back", "Sobremesas", [["Pudim de leite", "Milk pudding"]], "Desserts"),
    ];
    const [frente, verso] = gruposDasFaces(secoes, "same");
    const ajuste = { pt: 9, estoura: false };
    const { container, rerender } = render(<FaceCardapio secoes={frente.secoes} comLogo={frente.comLogo} tema="wine" largura={92} altura={76} ajuste={ajuste} />);
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.getByText("Saladinha do Pateo")).toBeTruthy();
    expect(screen.getByText("Starters")).toBeTruthy();
    expect(screen.queryByText("Pudim de leite")).toBeNull();
    expect((container.firstChild as HTMLElement).style.width).toBe("92mm");

    rerender(<FaceCardapio secoes={verso.secoes} comLogo={verso.comLogo} tema="gold" largura={92} altura={76} ajuste={{ pt: 7, estoura: true }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Milk pudding")).toBeTruthy();
    expect(container.querySelector(".cdp-face--estoura")).toBeTruthy();
  });
});

describe("medida em cm digitada", () => {
  test("aceita vírgula (\"9,\" já vale 9 cm), não repassa medida fora do intervalo e avisa", () => {
    const onMudar = vi.fn();
    render(<CampoCm rotulo="Largura (cm)" mm={92} minMm={40} maxMm={281} onMudar={onMudar} />);
    const campo = screen.getByLabelText("Largura (cm)") as HTMLInputElement;
    expect(campo.value).toBe("9,2");
    fireEvent.change(campo, { target: { value: "9," } });
    expect(onMudar).toHaveBeenLastCalledWith(90);
    fireEvent.change(campo, { target: { value: "9,5" } });
    expect(onMudar).toHaveBeenLastCalledWith(95);
    fireEvent.change(campo, { target: { value: "2" } });
    expect(onMudar).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Entre 4 e 28,1 cm")).toBeTruthy();
  });
});

describe("espera das imagens antes de imprimir", () => {
  test("não espera imagem já carregada e desiste depois de 1,5 s", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div class="area"><img class="pronta"><img class="lenta"></div>';
      Object.defineProperty(document.querySelector(".pronta"), "complete", { value: true });
      Object.defineProperty(document.querySelector(".lenta"), "complete", { value: false });
      let terminou = false;
      void esperarImagens(".area img").then(() => { terminou = true; });
      await vi.advanceTimersByTimeAsync(1400);
      expect(terminou).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(terminou).toBe(true);
    } finally {
      vi.useRealTimers();
      document.body.innerHTML = "";
    }
  });
});

describe("busca de prato na seção do cardápio", () => {
  const catalogo = [
    { id: "1", namePt: "Suco de laranja", nameEn: "Orange juice", category: "Bebidas", isActive: true },
    { id: "2", namePt: "Suco de uva", nameEn: "Grape juice", category: "Bebidas", isActive: true },
  ];
  const montar = async (podeCadastrar = true) => {
    const { BuscaPratoCardapio } = await import("../BuscaPratoCardapio");
    const onEscolher = vi.fn();
    const onCadastrar = vi.fn();
    render(<BuscaPratoCardapio catalogo={catalogo} jaNaSecao={new Set(["suco de uva"])} podeCadastrar={podeCadastrar} rotuloSecao="Bebidas" onEscolher={onEscolher} onCadastrar={onCadastrar} />);
    return { campo: screen.getByRole("combobox"), onEscolher, onCadastrar };
  };

  test("acha no catálogo pelo português ou inglês e traz o inglês junto; marca o que já está na seção", async () => {
    const { campo, onEscolher } = await montar();
    fireEvent.change(campo, { target: { value: "grape" } });
    expect(screen.getByText("já está")).toBeTruthy();
    fireEvent.change(campo, { target: { value: "laranja" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onEscolher).toHaveBeenCalledWith({ namePt: "Suco de laranja", nameEn: "Orange juice" });
    expect((campo as HTMLInputElement).value).toBe("");
  });

  test("prato fora do catálogo: usa só neste cardápio ou cadastra", async () => {
    const { campo, onEscolher, onCadastrar } = await montar();
    fireEvent.change(campo, { target: { value: "chá gelado de pêssego" } });
    fireEvent.click(screen.getByRole("option", { name: /só neste cardápio/ }));
    expect(onEscolher).toHaveBeenCalledWith({ namePt: "Chá gelado de pêssego", nameEn: "" });
    fireEvent.change(campo, { target: { value: "Bolo de fubá" } });
    fireEvent.click(screen.getByRole("option", { name: /Cadastrar “Bolo de fubá” no catálogo/ }));
    expect(onCadastrar).toHaveBeenCalledWith("Bolo de fubá");
  });

  test("sem permissão de criar, só oferece usar no cardápio", async () => {
    const { campo } = await montar(false);
    fireEvent.change(campo, { target: { value: "Bolo de fubá" } });
    expect(screen.queryByRole("option", { name: /Cadastrar/ })).toBeNull();
    expect(screen.getByRole("option", { name: /só neste cardápio/ })).toBeTruthy();
  });
});

describe("inglês do título da seção", () => {
  test("títulos conhecidos ganham o inglês sozinhos, sem ligar para acento ou maiúscula", () => {
    expect(inglesDoTitulo("Frutas")).toBe("Fruits");
    expect(inglesDoTitulo("  guarnicoes ")).toBe("Side dishes");
    expect(inglesDoTitulo("Bebidas")).toBe("Drinks");
    expect(inglesDoTitulo("Especial do chef")).toBeUndefined();
  });
});

describe("seção do cardápio", () => {
  test("prato pode ir para outra seção pela lista “Mover para…”", async () => {
    const { SecaoCardapio } = await import("../SecaoCardapio");
    const onMoverPrato = vi.fn();
    const secaoEdit = { chave: "a", face: "front" as const, titlePt: "Bebidas", titleEn: "Drinks", items: [{ chave: "i1", namePt: "Café", nameEn: "Brewed coffee" }] };
    render(<SecaoCardapio secao={secaoEdit} indice={0} total={2} catalogo={[]} porNome={new Map()} podeCadastrar={false} mostrarErros={false} mostrarFace
      primeiroDisplay={1} umPorPrato={false} abertaNoInicio outrasSecoes={[{ chave: "b", rotulo: "Doces" }]} onMoverPrato={onMoverPrato}
      onMudar={vi.fn()} onMover={vi.fn()} onRemover={vi.fn()} onCadastrar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Mover Café para outra seção"), { target: { value: "b" } });
    expect(onMoverPrato).toHaveBeenCalledWith("i1", "b");
  });
});
