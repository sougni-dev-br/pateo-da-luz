import { describe, expect, test } from "vitest";
import type { TipComputation } from "../../../api/client";
import { classificarSaldo, destinoDosCentavos, ehArredondamento, limiteDeArredondamento, pessoasNoRateio, rotuloDoSaldoNaTela, textoArredondamento } from "../saldoPequeno";

const equipe = (n: number, extra: Array<Record<string, unknown>> = []) =>
  [...Array.from({ length: n }, (_, i) => ({ employeeId: `e${i}`, foraDaGorjeta: false, tipoCalculo: "MES" })), ...extra] as unknown as TipComputation["participants"];

describe("limite do arredondamento", () => {
  test("um centavo por pessoa, com mínimo de cinco centavos", () => {
    expect(limiteDeArredondamento(0)).toBe(0.05);
    expect(limiteDeArredondamento(3)).toBe(0.05);
    expect(limiteDeArredondamento(19)).toBe(0.19);
    expect(limiteDeArredondamento(30)).toBe(0.3);
  });
});

describe("ehArredondamento", () => {
  test("centavos até o limite são arredondamento; zero e o que passa do limite, não", () => {
    expect(ehArredondamento(0.01, 19)).toBe(true);
    expect(ehArredondamento(0.19, 19)).toBe(true);
    expect(ehArredondamento(0.2, 19)).toBe(false);
    expect(ehArredondamento(0.003, 19)).toBe(false);
    expect(ehArredondamento(0, 19)).toBe(false);
    expect(ehArredondamento(40, 19)).toBe(false);
  });
});

describe("pessoasNoRateio", () => {
  test("não conta quem só recebe salário nem quem está fora do período", () => {
    const p = equipe(3, [{ foraDaGorjeta: true, tipoCalculo: "MES" }, { foraDaGorjeta: false, tipoCalculo: "FORA_DO_PERIODO" }]);
    expect(pessoasNoRateio({ participants: p })).toBe(3);
    expect(pessoasNoRateio({ participants: undefined as never })).toBe(0);
  });
});

describe("classificarSaldo", () => {
  const c = (saldo: number, n = 19) => ({ saldo, participants: equipe(n) });
  test("estouro, zerado, arredondamento e livre", () => {
    expect(classificarSaldo(c(-3))).toEqual({ tipo: "estouro", valor: 3 });
    expect(classificarSaldo(c(-0.003)).tipo).toBe("zerado");
    expect(classificarSaldo(c(0)).tipo).toBe("zerado");
    expect(classificarSaldo(c(0.04))).toEqual({ tipo: "arredondamento", valor: 0.04 });
    expect(classificarSaldo(c(160)).tipo).toBe("livre");
  });
});

describe("quando algo além do arredondamento mexe no saldo, ele segue sendo livre", () => {
  const base = (n = 19) => equipe(n);
  test("gorjeta real no lugar da calculada", () => {
    const p = [...base(), { employeeId: "r", foraDaGorjeta: false, tipoCalculo: "MES", gorjetaReal: { valor: 400 } }] as unknown as TipComputation["participants"];
    expect(classificarSaldo({ saldo: 0.04, participants: p }).tipo).toBe("livre");
  });
  test("rescisão quitada abaixo do direito", () => {
    const p = [...base(), { employeeId: "q", foraDaGorjeta: false, tipoCalculo: "RESCISAO_QUITADA" }] as unknown as TipComputation["participants"];
    expect(classificarSaldo({ saldo: 0.04, participants: p }).tipo).toBe("livre");
  });
  test("sobra de quem saiu indo ao livre", () => {
    expect(classificarSaldo({ saldo: 0.04, participants: base(), sobraRescisaoParaSaldo: true, rescisoes: { valor: 100, pontos: 2 } }).tipo).toBe("livre");
    // Sem rescisão no período, o modo não muda nada.
    expect(classificarSaldo({ saldo: 0.04, participants: base(), sobraRescisaoParaSaldo: true, rescisoes: { valor: 0, pontos: 0 } }).tipo).toBe("arredondamento");
  });
  test("logo acima do limite, é livre", () => {
    expect(classificarSaldo({ saldo: 0.2, participants: base(19) }).tipo).toBe("livre");
    expect(classificarSaldo({ saldo: 0.19, participants: base(19) }).tipo).toBe("arredondamento");
  });
});

describe("rótulo do saldo nas telas do ciclo", () => {
  test("o mesmo nome em todas as telas", () => {
    expect(rotuloDoSaldoNaTela({ saldo: 0.03, participants: equipe(19) })).toBe("Arredondamento");
    expect(rotuloDoSaldoNaTela({ saldo: 40, participants: equipe(19) })).toBe("Saldo não distribuído");
    expect(rotuloDoSaldoNaTela({ saldo: -2, participants: equipe(19) })).toBe("Estouro");
  });
});

describe("destino dos centavos", () => {
  test("sem destino definido vale fundo, e o tempo do verbo segue o fechamento", () => {
    expect(destinoDosCentavos(undefined)).toBe("No fechamento entram no fundo de reserva.");
    expect(destinoDosCentavos("FUNDO", true)).toBe("Entraram no fundo de reserva no fechamento.");
    expect(destinoDosCentavos("LIVRE", true)).toBe("Ficaram no período como saldo livre.");
  });
  test("texto sem destino nenhum diz fundo, como o resumo", () => {
    expect(textoArredondamento({ saldo: 0.03 })).toMatch(/fundo de reserva/);
    expect(textoArredondamento({ saldo: 0.03, status: "CLOSED" })).toMatch(/Entraram no fundo/);
  });
});

describe("textoArredondamento", () => {
  test("diz de onde vêm os centavos e para onde vão, conforme o destino do período", () => {
    expect(textoArredondamento({ saldo: 0.03, destinoEfetivo: "FUNDO" })).toMatch(/arredondado ao centavo\. No fechamento entram no fundo de reserva\./);
    expect(textoArredondamento({ saldo: 0.03, destinoSobra: "LIVRE" })).toMatch(/Ficam no período como saldo livre\./);
    expect(textoArredondamento({ saldo: 0.03, destinoEfetivo: "REDISTRIBUIR" })).toMatch(/redistribuídos entre as pessoas/);
  });
});
