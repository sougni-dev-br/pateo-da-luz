import { describe, expect, it } from "vitest";
import { descricaoDoPeriodo, leituraDaVariacao, percentualParaTexto, textoDaVariacao, textoParaPercentual } from "../formato";

describe("textoDaVariacao", () => {
  it("mostra sinal e uma casa decimal em pt-BR", () => {
    expect(textoDaVariacao(0.0483)).toBe("+4,8%");
    expect(textoDaVariacao(-0.0661)).toBe("−6,6%");
    expect(textoDaVariacao(0)).toBe("0,0%");
  });
  it("sem comparação mostra traço", () => {
    expect(textoDaVariacao(null)).toBe("—");
  });
  it("variação minúscula que arredonda para zero não ganha sinal", () => {
    expect(textoDaVariacao(0.0001)).toBe("0,0%");
    expect(textoDaVariacao(-0.0001)).toBe("0,0%");
  });
});

describe("leituraDaVariacao", () => {
  it("classifica como a aba Painel executivo da planilha", () => {
    expect(leituraDaVariacao(0.035)).toBe("Aumento");
    expect(leituraDaVariacao(-0.066)).toBe("Redução");
    expect(leituraDaVariacao(0)).toBe("Estável");
    expect(leituraDaVariacao(0.0001)).toBe("Estável");
    expect(leituraDaVariacao(null)).toBeNull();
  });
});

describe("descricaoDoPeriodo", () => {
  it("resume meses seguidos como intervalo", () => {
    expect(descricaoDoPeriodo([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe("janeiro a outubro");
  });
  it("lista meses soltos", () => {
    expect(descricaoDoPeriodo([1, 3, 4])).toBe("janeiro, março e abril");
  });
  it("trata um mês e nenhum", () => {
    expect(descricaoDoPeriodo([5])).toBe("maio");
    expect(descricaoDoPeriodo([])).toBe("");
  });
});

describe("percentuais dos campos de premissa", () => {
  it("converte texto em fração e de volta", () => {
    expect(textoParaPercentual("10")).toBe(0.1);
    expect(textoParaPercentual("5,5")).toBe(0.055);
    expect(textoParaPercentual(" -3% ")).toBe(-0.03);
    expect(textoParaPercentual("0")).toBe(0);
    expect(percentualParaTexto(0.055)).toBe("5,5");
    expect(percentualParaTexto(-0.03)).toBe("-3");
    expect(percentualParaTexto(0)).toBe("0");
  });

  it("recusa o que não é número", () => {
    expect(textoParaPercentual("")).toBeNull();
    expect(textoParaPercentual("abc")).toBeNull();
    expect(textoParaPercentual("1,2,3")).toBeNull();
    expect(textoParaPercentual("-")).toBeNull();
  });
});
