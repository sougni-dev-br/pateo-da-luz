import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { BuffetMenuSection } from "../../../../api/client";
import { CampoCm } from "../CampoCm";
import { FaceCardapio } from "../FaceCardapio";
import { TAMANHO_DISPLAY, facesParaImprimir, gruposDasFaces, layoutDaFolha, pendenciasDoCardapio } from "../cardapioFormato";
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
