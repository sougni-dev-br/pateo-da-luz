import { describe, expect, test } from "vitest";
import type { TipReciboVale } from "../../api/client";
import { textoDoRecibo } from "./reciboVale";

const base: TipReciboVale = {
  codigo: "VALE-2026-00012", vez: 1,
  empresa: { razaoSocial: "PATEO FREI CANECA BAR E FORNERIA LTDA", fantasia: "Pateo da Luz Frei", cnpj: "46878233000192", endereco: "", cidade: "São Paulo" },
  funcionario: { nome: "Fulano de Tal", cpf: null, funcao: "Atendimento" },
  vale: { tipo: "ADIANTAMENTO", valor: 150, data: "2026-09-10", descricao: "Adiantamento de quinzena" },
  apuracao: { codigo: "GOR-2026-0003", periodo: "Gorjeta 26/08–25/09" },
  emitidoEm: "2026-09-10T15:00:00.000Z", emitidoPor: "Eli",
};

describe("texto do recibo", () => {
  test("adiantamento: recebeu, por extenso, com autorização de desconto", () => {
    expect(textoDoRecibo(base).replace(/\u00a0/g, " ")).toBe(
      "Recebi de PATEO FREI CANECA BAR E FORNERIA LTDA, CNPJ 46.878.233/0001-92, a importância de R$ 150,00 (cento e cinquenta reais), "
      + "a título de adiantamento, referente a Adiantamento de quinzena, e autorizo o desconto desse valor da minha gorjeta da apuração "
      + "GOR-2026-0003 (Gorjeta 26/08–25/09).",
    );
  });

  test("consumo: declara que adquiriu", () => {
    const t = textoDoRecibo({ ...base, vale: { ...base.vale, tipo: "VALE_CONSUMO", valor: 37.5, descricao: "Bebidas" } }).replace(/\u00a0/g, " ");
    expect(textoDoRecibo({ ...base, vale: { ...base.vale, valor: 80 } })).toContain("R$\u00a080,00");
    expect(t).toMatch(/^Declaro que adquiri de PATEO FREI CANECA/);
    expect(t).toContain("o valor de R$ 37,50 (trinta e sete reais e cinquenta centavos)");
    expect(t).toContain("autorizo o desconto");
  });
});
