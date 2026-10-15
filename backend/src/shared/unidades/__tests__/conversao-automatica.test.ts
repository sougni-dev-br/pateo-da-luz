import { describe, expect, it } from "vitest";
import { proporConversoes, type ProdutoParaConversao } from "../conversao-automatica.js";

function produto(p: Partial<ProdutoParaConversao> & Pick<ProdutoParaConversao, "nome" | "unidadeDeContagem">): ProdutoParaConversao {
  return { cadastradas: [], unidadesDaNota: [], precoNaContagem: null, ...p };
}
const nota = (unidade: string, precoPorUnidade: number | null = null, linhas = 1, valor = 100) => ({ unidade, linhas, valor, precoPorUnidade });

describe("proporConversoes", () => {
  it("caixa de sacos contados em UN: le o C800 e o preco confirma", () => {
    const [p] = proporConversoes(produto({
      nome: "SACO AMOSTRA TARJA 12X30 C800",
      unidadeDeContagem: "UN",
      unidadesDaNota: [nota("CX", 113.16)],
      precoNaContagem: 0.14
    }));
    expect(p).toMatchObject({ fromUnit: "CX", toUnit: "UN", factor: 800, confianca: "alta", precoConfirma: true, origem: "C800" });
  });

  it("farinha contada em KG comprada em UN: 1 UN = 5 KG", () => {
    const [p] = proporConversoes(produto({ nome: "FARINHA TRIGO 5KG", unidadeDeContagem: "KG", unidadesDaNota: [nota("UND")] }));
    expect(p).toMatchObject({ fromUnit: "UN", toUnit: "KG", factor: 5, confianca: "alta", precoConfirma: null });
  });

  it("gramas no nome viram a unidade de contagem em KG", () => {
    const [p] = proporConversoes(produto({ nome: "MOLHO TOMATE 340G", unidadeDeContagem: "KG", unidadesDaNota: [nota("UN")] }));
    expect(p.factor).toBe(0.34);
  });

  it("agua 500ML C/12 em CX, contada em L: 1 CX = 6 L", () => {
    const [p] = proporConversoes(produto({ nome: "AGUA MINERAL 500ML C/12", unidadeDeContagem: "L", unidadesDaNota: [nota("CAIXA")] }));
    expect(p).toMatchObject({ fromUnit: "CX", factor: 6, confianca: "alta" });
  });

  it("peca comprada a quilo e contada em UN: 1 KG = 1/5 UN", () => {
    const [p] = proporConversoes(produto({ nome: "QUEIJO PECA 5KG", unidadeDeContagem: "UN", unidadesDaNota: [nota("KG")] }));
    expect(p).toMatchObject({ fromUnit: "KG", toUnit: "UN", factor: 0.2, confianca: "alta" });
  });

  it("duzia e fixa", () => {
    expect(proporConversoes(produto({ nome: "OVOS BRANCOS", unidadeDeContagem: "UN", unidadesDaNota: [nota("DZ")] }))[0]).toMatchObject({ factor: 12, confianca: "alta" });
  });

  it("preco que desmente o nome rebaixa para o operador decidir", () => {
    // C/1000 com preco de 3x a unidade: o 1000 nao e da embalagem.
    const [p] = proporConversoes(produto({ nome: "GUARDANAPO C/1000", unidadeDeContagem: "UN", unidadesDaNota: [nota("PCT", 3)], precoNaContagem: 1 }));
    expect(p).toMatchObject({ factor: 1000, confianca: "baixa", precoConfirma: false });
  });

  it("duas quantidades no nome sao ambiguas", () => {
    const [p] = proporConversoes(produto({ nome: "CAPSULA C/10 CX C/50", unidadeDeContagem: "UN", unidadesDaNota: [nota("CX")] }));
    expect(p.confianca).toBe("baixa");
  });

  it("caixa sem quantidade no nome de produto contado em KG e ambigua", () => {
    const [p] = proporConversoes(produto({ nome: "ARROZ 5KG", unidadeDeContagem: "KG", unidadesDaNota: [nota("FD")] }));
    expect(p.confianca).toBe("baixa");
  });

  it("nao propoe o que ja converte nem quando o nome nao diz nada", () => {
    expect(proporConversoes(produto({
      nome: "SACO C800",
      unidadeDeContagem: "UN",
      cadastradas: [{ fromUnit: "CAIXA", toUnit: "UND", factor: 800 }],
      unidadesDaNota: [nota("CX"), nota("UN"), nota("UNIDADE")]
    }))).toEqual([]);
    expect(proporConversoes(produto({ nome: "FARINHA", unidadeDeContagem: "KG", unidadesDaNota: [nota("G"), nota("UN")] }))).toEqual([]);
  });

  it("grandezas diferentes nao convertem", () => {
    expect(proporConversoes(produto({ nome: "OLEO 900ML", unidadeDeContagem: "KG", unidadesDaNota: [nota("UN")] }))).toEqual([]);
  });

  it("grafias diferentes da mesma unidade viram uma proposta so", () => {
    const propostas = proporConversoes(produto({
      nome: "COPO C/50",
      unidadeDeContagem: "UN",
      unidadesDaNota: [nota("PCT", 5, 2, 10), nota("PACOTE", 5, 1, 5)]
    }));
    expect(propostas).toHaveLength(1);
    expect(propostas[0]).toMatchObject({ fromUnit: "PCT", linhas: 3, valor: 15 });
  });
});
