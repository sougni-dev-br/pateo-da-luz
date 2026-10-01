import { describe, expect, it } from "vitest";
import { ERRO_DUAS_FORMAS_PAGAMENTO, lerFormaPagamento } from "../employee.routes.js";
import { alteracoes, cadastroVigenteEm, desserializar, ROTULO_CAMPO, serializar } from "../cadastro-historico.js";

// Forma de pagamento do sem registro: só no pagamento, adiantamento no dia 20 ou quinzena.
describe("lerFormaPagamento", () => {
  it("não mexe quando o corpo não traz os campos", () => {
    expect(lerFormaPagamento({ firstName: "Rafa" })).toEqual({ dados: {} });
  });

  it("grava a quinzena (e desmarca o adiantamento junto)", () => {
    expect(lerFormaPagamento({ pagamentoQuinzenal: true, recebeAdiantamento: false }))
      .toEqual({ dados: { pagamentoQuinzenal: true, recebeAdiantamento: false } });
  });

  it("recusa o que não é booleano (texto \"true\" não vira quinzena)", () => {
    for (const v of ["false", "true", 1, 0, null, ""]) {
      expect(lerFormaPagamento({ pagamentoQuinzenal: v })).toHaveProperty("erro");
    }
  });

  it("recusa adiantamento e quinzena juntos no corpo", () => {
    expect(lerFormaPagamento({ pagamentoQuinzenal: true, recebeAdiantamento: true })).toEqual({ erro: ERRO_DUAS_FORMAS_PAGAMENTO });
  });

  it("recusa marcar a quinzena em quem já recebe adiantamento sem desmarcá-lo (e vice-versa)", () => {
    expect(lerFormaPagamento({ pagamentoQuinzenal: true }, { recebeAdiantamento: true, pagamentoQuinzenal: false }))
      .toEqual({ erro: ERRO_DUAS_FORMAS_PAGAMENTO });
    expect(lerFormaPagamento({ recebeAdiantamento: true }, { recebeAdiantamento: false, pagamentoQuinzenal: true }))
      .toEqual({ erro: ERRO_DUAS_FORMAS_PAGAMENTO });
  });

  it("troca de adiantamento para quinzena numa gravação só", () => {
    expect(lerFormaPagamento({ pagamentoQuinzenal: true, recebeAdiantamento: false }, { recebeAdiantamento: true, pagamentoQuinzenal: false }))
      .toEqual({ dados: { pagamentoQuinzenal: true, recebeAdiantamento: false } });
  });

  it("a mensagem de erro do adiantamento continua a mesma", () => {
    expect(lerFormaPagamento({ recebeAdiantamento: "sim" })).toEqual({ erro: "Informe se recebe adiantamento salarial (sim ou não)." });
  });
});

describe("pagamentoQuinzenal no histórico do cadastro", () => {
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  it("vira uma linha do histórico quando muda, com rótulo próprio", () => {
    expect(alteracoes({ pagamentoQuinzenal: false }, { pagamentoQuinzenal: true }))
      .toEqual([{ campo: "pagamentoQuinzenal", valorAnterior: "false", valorNovo: "true" }]);
    expect(alteracoes({ pagamentoQuinzenal: true }, { pagamentoQuinzenal: true })).toEqual([]);
    expect(ROTULO_CAMPO.pagamentoQuinzenal).toBe("Pagamento por quinzena");
  });

  it("serializa como sim/não e volta como booleano", () => {
    expect(serializar("pagamentoQuinzenal", true)).toBe("true");
    expect(serializar("pagamentoQuinzenal", false)).toBe("false");
    expect(desserializar("pagamentoQuinzenal", "true")).toBe(true);
    expect(desserializar("pagamentoQuinzenal", "false")).toBe(false);
  });

  it("o valor vigente no mês é o daquele mês", () => {
    const linhas = [{ campo: "pagamentoQuinzenal", valorAnterior: "false", valorNovo: "true", vigenteDesde: d("2026-10-01"), createdAt: d("2026-10-01") }];
    expect(cadastroVigenteEm({ pagamentoQuinzenal: true }, linhas, d("2026-09-30")).pagamentoQuinzenal).toBe(false);
    expect(cadastroVigenteEm({ pagamentoQuinzenal: true }, linhas, d("2026-10-31")).pagamentoQuinzenal).toBe(true);
  });
});
