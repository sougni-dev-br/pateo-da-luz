import { render as renderRaw, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import type { ApuracaoRescisao } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { ApuracaoRescisaoPainel } from "../ApuracaoRescisao";
import { camposDaForma, camposDaModalidade, dicaFormaPagamento, formaPagamentoDe, OPCOES_FORMA_PAGAMENTO } from "../formaPagamento";
import { mudouCampoComHistorico, textoDoValor, type CamposComHistorico } from "../historicoCadastroFormato";
import { dicaValesRescisao } from "../rescisaoFormato";

describe("forma de pagamento do sem registro (cadastro)", () => {
  test("três opções, com os textos da tela", () => {
    expect(OPCOES_FORMA_PAGAMENTO.map((o) => o.label)).toEqual([
      "Recebe só no pagamento (até o 5º dia útil)", "Recebe adiantamento no dia 20", "Recebe por quinzena (dias 15 e 30)",
    ]);
  });

  test("lê os dois campos do cadastro; a quinzena prevalece se as duas estiverem marcadas", () => {
    expect(formaPagamentoDe({ recebeAdiantamento: false, pagamentoQuinzenal: false })).toBe("PAGAMENTO");
    expect(formaPagamentoDe({ recebeAdiantamento: true })).toBe("ADIANTAMENTO");
    expect(formaPagamentoDe({ recebeAdiantamento: false, pagamentoQuinzenal: true })).toBe("QUINZENA");
    expect(formaPagamentoDe({ recebeAdiantamento: true, pagamentoQuinzenal: true })).toBe("QUINZENA");
  });

  test("grava os dois campos, nunca os dois marcados", () => {
    expect(camposDaForma("PAGAMENTO")).toEqual({ recebeAdiantamento: false, pagamentoQuinzenal: false });
    expect(camposDaForma("ADIANTAMENTO")).toEqual({ recebeAdiantamento: true, pagamentoQuinzenal: false });
    expect(camposDaForma("QUINZENA")).toEqual({ recebeAdiantamento: false, pagamentoQuinzenal: true });
  });

  test("mudar para CLT zera a quinzena (o campo some e o backend recusaria); Não-CLT mantém", () => {
    expect(camposDaModalidade("CLT", { recebeAdiantamento: false, pagamentoQuinzenal: true })).toEqual({ modality: "CLT", pagamentoQuinzenal: false });
    expect(camposDaModalidade("NAO_CLT", { recebeAdiantamento: false, pagamentoQuinzenal: true })).toEqual({ modality: "NAO_CLT", pagamentoQuinzenal: true });
  });

  test("a dica explica o desconto na lista do dia 30", () => {
    expect(dicaFormaPagamento("QUINZENA")).toContain("metade do salário base no dia 15");
  });
});

describe("histórico do cadastro: pagamento por quinzena", () => {
  const original: CamposComHistorico = { baseSalary: "2.000,00", salarioCombinado: "", modality: "NAO_CLT", position: "Garçom", recebeAdiantamento: false };
  test("mudar para quinzena pede \"vale a partir de\"", () => {
    expect(mudouCampoComHistorico(original, { ...original, pagamentoQuinzenal: true })).toBe(true);
    expect(mudouCampoComHistorico(original, { ...original, pagamentoQuinzenal: false })).toBe(false);
  });
  test("texto do valor na lista do histórico", () => {
    expect(textoDoValor("pagamentoQuinzenal", "true")).toBe("Recebe por quinzena");
    expect(textoDoValor("pagamentoQuinzenal", "false")).toBe("Não recebe por quinzena");
  });
});

const base: ApuracaoRescisao = {
  saida: "2026-09-22", semRegistro: true,
  vt: { total: 0, dias: [], semDetalhe: [], observacao: null },
  vales: { itens: [], descontos: 0, creditos: 0, liquido: 0, entraNaRescisao: true },
  gorjeta: { periodo: "x", status: "OPEN", pontos: 2, valorPonto: 93.4, gorjeta: 186.8, pendente: false, diasSalario: 22, salarioProporcional: 1466.74 },
  gorjetaObservacao: null,
  sugestao: { salario: 1466.74, gorjeta: 186.8, creditos: 0, vales: 1000, valesRotulo: "1ª quinzena 15/09", adiantamento: 0, primeiraQuinzena: 1000, vtDesconto: 0, bruto: 1653.54 },
  adiantamento: null,
  primeiraQuinzena: { valor: 1000, data: "2026-09-15" },
};

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);

describe("apuração da rescisão: 1ª quinzena", () => {
  test("mostra a 1ª quinzena já paga e o líquido já sem ela", () => {
    render(<ApuracaoRescisaoPainel apuracao={base} aberto />);
    expect(screen.getByText("1ª quinzena já paga")).toBeTruthy();
    expect(screen.getByText(/paga em 15\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/653,54/)).toBeTruthy(); // 1.653,54 − 1.000
  });

  test("sem quinzena (ou apuração antiga, sem o campo) a linha não aparece", () => {
    render(<ApuracaoRescisaoPainel apuracao={{ ...base, primeiraQuinzena: undefined }} aberto />);
    expect(screen.queryByText("1ª quinzena já paga")).toBeNull();
  });

  test("valor oculto sem a permissão de Funcionários", () => {
    render(<ApuracaoRescisaoPainel apuracao={{ ...base, primeiraQuinzena: { valor: null, data: "2026-09-15" }, dadosPessoaisOcultos: true }} aberto />);
    expect(screen.getByText(/valor oculto: exige a permissão de ver Funcionários/)).toBeTruthy();
  });

  test("dica dos vales da janela da rescisão", () => {
    expect(dicaValesRescisao({ adiantamento: 0, primeiraQuinzena: 1000 })).toBe("aba Vales da gorjeta + 1ª quinzena já pago no mês");
    expect(dicaValesRescisao({ adiantamento: 880, primeiraQuinzena: 0 })).toBe("aba Vales da gorjeta + adiantamento salarial já pago no mês");
    expect(dicaValesRescisao(null)).toBe("lançados na aba Vales da gorjeta");
  });
});
