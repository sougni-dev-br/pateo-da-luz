import { describe, expect, test } from "vitest";
import { montarParcelas, quantidadeEfetivaDeParcelas } from "../parcelas";
import { dividirValor, FormaPagamento, formaPermiteParcelamento, somarDias } from "../formas-pagamento";

const BOLETO: FormaPagamento = { id: "1", name: "BOLETO", type: "BANK_SLIP", group: "boleto" };
const PIX: FormaPagamento = { id: "2", name: "PIX", type: "PIX", group: "pix" };
const FATURADO: FormaPagamento = { id: "3", name: "FATURADO", type: "OTHER", group: "faturado" };
const DINHEIRO: FormaPagamento = { id: "4", name: "DINHEIRO", type: "CASH", group: "dinheiro" };

describe("quantidadeEfetivaDeParcelas", () => {
  test("forma que não parcela cai para 1, mesmo pedindo mais", () => {
    expect(quantidadeEfetivaDeParcelas(PIX, 6)).toBe(1);
    expect(quantidadeEfetivaDeParcelas(DINHEIRO, 3)).toBe(1);
  });

  test("forma que parcela respeita o pedido", () => {
    expect(quantidadeEfetivaDeParcelas(BOLETO, 3)).toBe(3);
    expect(quantidadeEfetivaDeParcelas(FATURADO, 12)).toBe(12);
  });

  test("0, negativo, NaN e forma ausente nunca geram grade vazia", () => {
    // A tela chama isso com Number(campo || 1), e campo vazio vira NaN.
    expect(quantidadeEfetivaDeParcelas(BOLETO, 0)).toBe(1);
    expect(quantidadeEfetivaDeParcelas(BOLETO, -4)).toBe(1);
    expect(quantidadeEfetivaDeParcelas(BOLETO, Number.NaN)).toBe(1);
    expect(quantidadeEfetivaDeParcelas(null, 5)).toBe(1);
  });
});

describe("montarParcelas — o caso que motivou a regra de centavos", () => {
  test("BOLETO 2x de 7.150,07 fecha exatamente", () => {
    const parcelas = montarParcelas({
      forma: BOLETO,
      total: 7150.07,
      parcelasPedidas: 2,
      dataCompra: "2026-09-15",
      vencimento: { modo: "escada", diasAteAPrimeira: 15 }
    });

    expect(parcelas).toEqual([
      { installment: 1, dueDate: "2026-09-30", amount: "3575.03" },
      { installment: 2, dueDate: "2026-10-30", amount: "3575.04" }
    ]);
  });

  test("a soma das parcelas devolve o total, para várias divisões quebradas", () => {
    for (const [total, quantidade] of [[7150.07, 2], [7150.07, 3], [100, 3], [1000.01, 7], [0.05, 4]] as const) {
      const parcelas = montarParcelas({
        forma: BOLETO, total, parcelasPedidas: quantidade,
        dataCompra: "2026-09-15", vencimento: { modo: "escada", diasAteAPrimeira: 30 }
      });
      const soma = parcelas.reduce((acumulado, parcela) => acumulado + Number(parcela.amount), 0);
      expect(Number(soma.toFixed(2))).toBe(total);
    }
  });

  test("a última parcela é quem absorve a sobra", () => {
    const parcelas = montarParcelas({
      forma: BOLETO, total: 100, parcelasPedidas: 3,
      dataCompra: "2026-09-15", vencimento: { modo: "escada", diasAteAPrimeira: 30 }
    });
    expect(parcelas.map((parcela) => parcela.amount)).toEqual(["33.33", "33.33", "33.34"]);
  });

  test("PIX devolve uma parcela só, com o total inteiro", () => {
    const parcelas = montarParcelas({
      forma: PIX, total: 7150.07, parcelasPedidas: 4,
      dataCompra: "2026-09-15", vencimento: { modo: "escada", diasAteAPrimeira: 0 }
    });
    expect(parcelas).toEqual([{ installment: 1, dueDate: "2026-09-15", amount: "7150.07" }]);
  });
});

describe("montarParcelas — vencimentos em escada de 30 dias", () => {
  test("primeira no prazo combinado, seguintes de 30 em 30", () => {
    const parcelas = montarParcelas({
      forma: BOLETO, total: 300, parcelasPedidas: 3,
      dataCompra: "2026-09-15", vencimento: { modo: "escada", diasAteAPrimeira: 15 }
    });
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-09-30", "2026-10-30", "2026-11-29"]);
  });

  test("atravessa a virada do ano sem pular dia", () => {
    const parcelas = montarParcelas({
      forma: BOLETO, total: 200, parcelasPedidas: 2,
      dataCompra: "2026-12-20", vencimento: { modo: "escada", diasAteAPrimeira: 30 }
    });
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2027-01-19", "2027-02-18"]);
  });

  test("data já ajustada à mão não é sobrescrita quando o valor muda", () => {
    // O usuário mexeu no vencimento da 2ª e depois corrigiu o total da compra:
    // a grade é remontada, mas a data dele tem que sobreviver.
    const parcelas = montarParcelas({
      forma: BOLETO, total: 900, parcelasPedidas: 3,
      dataCompra: "2026-09-15",
      vencimento: { modo: "escada", diasAteAPrimeira: 15, datasExistentes: [undefined, "2026-11-05", undefined] }
    });
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-09-30", "2026-11-05", "2026-11-29"]);
  });

  test("data existente vazia não conta como escolha do usuário", () => {
    const parcelas = montarParcelas({
      forma: BOLETO, total: 200, parcelasPedidas: 2,
      dataCompra: "2026-09-15",
      vencimento: { modo: "escada", diasAteAPrimeira: 15, datasExistentes: ["", ""] }
    });
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-09-30", "2026-10-30"]);
  });

  test("sobra de datas existentes de uma grade maior é ignorada", () => {
    const parcelas = montarParcelas({
      forma: BOLETO, total: 200, parcelasPedidas: 2,
      dataCompra: "2026-09-15",
      vencimento: { modo: "escada", diasAteAPrimeira: 15, datasExistentes: ["2026-10-01", "2026-11-01", "2026-12-01"] }
    });
    expect(parcelas).toHaveLength(2);
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-10-01", "2026-11-01"]);
  });
});

describe("montarParcelas — dias combinados com o fornecedor", () => {
  test("usa os dias do cadastro", () => {
    const parcelas = montarParcelas({
      forma: FATURADO, total: 300, parcelasPedidas: 3,
      dataCompra: "2026-09-15", vencimento: { modo: "dias", dias: [15, 30, 60] }
    });
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-09-30", "2026-10-15", "2026-11-14"]);
  });

  test("pedindo mais parcelas do que dias, as extras seguem de 30 em 30 a partir do último", () => {
    const parcelas = montarParcelas({
      forma: BOLETO, total: 400, parcelasPedidas: 4,
      dataCompra: "2026-09-15", vencimento: { modo: "dias", dias: [15, 30] }
    });
    // 15, 30, depois 60 e 90 (30 + 30 e 30 + 60).
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-09-30", "2026-10-15", "2026-11-14", "2026-12-14"]);
  });

  test("lista de dias vazia começa em 60 dias, não em 30", () => {
    // Quina herdada: sem nenhum dia na lista a extrapolação parte de um "último
    // dia" fictício de 30 e já soma outros 30, então a 1ª parcela cai em 60.
    // Está aqui como está no código, não como deveria ser — mexer nisso é
    // mudança de regra, não refactor.
    const parcelas = montarParcelas({
      forma: BOLETO, total: 200, parcelasPedidas: 2,
      dataCompra: "2026-09-15", vencimento: { modo: "dias", dias: [] }
    });
    expect(parcelas.map((parcela) => parcela.dueDate)).toEqual(["2026-11-14", "2026-12-14"]);
  });
});

// ---------------------------------------------------------------------------
// Caracterização: as expressões abaixo são as de rebuildInstallments e
// rebuildInstallmentsWithDays em Purchases.tsx *antes* da extração, congeladas.
// Servem para provar que montarParcelas não mudou nenhum número. Não edite —
// se uma regra mudar de propósito, este confronto tem que quebrar.
// ---------------------------------------------------------------------------

function escadaAntiga(
  method: FormaPagamento | null, total: number, requestedCount: number,
  purchaseDate: string, installmentLeadDays: number, installments: Array<{ dueDate: string }>
) {
  const somarDiasAntigo = (inputDate: string, days: number) => {
    const baseDate = inputDate ? new Date(`${inputDate}T12:00:00`) : new Date();
    baseDate.setDate(baseDate.getDate() + days);
    return baseDate.toISOString().slice(0, 10);
  };
  const count = formaPermiteParcelamento(method) ? Math.max(1, requestedCount || 1) : 1;
  const amounts = dividirValor(total, count).map((valor) => valor.toFixed(2));
  const baseDueDate = somarDiasAntigo(purchaseDate, installmentLeadDays);
  return amounts.map((amount, index) => ({
    installment: index + 1,
    dueDate: installments[index]?.dueDate || somarDiasAntigo(baseDueDate, index * 30),
    amount
  }));
}

function diasAntigo(
  method: FormaPagamento | null, total: number, count: number, days: number[], purchaseDate: string
) {
  const effectiveCount = formaPermiteParcelamento(method) ? Math.max(1, count) : 1;
  const amounts = dividirValor(total, effectiveCount).map((valor) => valor.toFixed(2));
  return amounts.map((amount, index) => {
    const dayOffset = days[index] ?? (days[days.length - 1] ?? 30) + (index - days.length + 1) * 30;
    return { installment: index + 1, dueDate: somarDias(purchaseDate, dayOffset), amount };
  });
}

describe("caracterização — montarParcelas bate com o cálculo anterior", () => {
  const FORMAS = [BOLETO, PIX, FATURADO, DINHEIRO];
  const TOTAIS = [0, 0.01, 100, 209, 7150.07, 1000.01, 33.33, 1234567.89];
  const QUANTIDADES = [0, 1, 2, 3, 4, 6, 8, 12];
  const DATAS = ["2026-09-15", "2026-01-31", "2026-02-28", "2026-12-20"];

  test("modo escada, sem datas já escolhidas", () => {
    for (const forma of FORMAS) {
      for (const total of TOTAIS) {
        for (const quantidade of QUANTIDADES) {
          for (const dataCompra of DATAS) {
            for (const lead of [0, 7, 15, 30]) {
              expect(montarParcelas({
                forma, total, parcelasPedidas: quantidade, dataCompra,
                vencimento: { modo: "escada", diasAteAPrimeira: lead }
              })).toEqual(escadaAntiga(forma, total, quantidade, dataCompra, lead, []));
            }
          }
        }
      }
    }
  });

  test("modo escada, preservando datas já escolhidas", () => {
    const existentes = [{ dueDate: "" }, { dueDate: "2026-11-05" }, { dueDate: "" }, { dueDate: "2027-01-02" }];
    for (const forma of FORMAS) {
      for (const quantidade of QUANTIDADES) {
        expect(montarParcelas({
          forma, total: 7150.07, parcelasPedidas: quantidade, dataCompra: "2026-09-15",
          vencimento: { modo: "escada", diasAteAPrimeira: 15, datasExistentes: existentes.map((e) => e.dueDate) }
        })).toEqual(escadaAntiga(forma, 7150.07, quantidade, "2026-09-15", 15, existentes));
      }
    }
  });

  test("modo dias do fornecedor", () => {
    for (const forma of FORMAS) {
      for (const total of TOTAIS) {
        for (const quantidade of QUANTIDADES) {
          for (const dias of [[], [30], [15, 30], [30, 60, 90], [7, 14, 21, 28]]) {
            expect(montarParcelas({
              forma, total, parcelasPedidas: quantidade, dataCompra: "2026-09-15",
              vencimento: { modo: "dias", dias }
            })).toEqual(diasAntigo(forma, total, quantidade, dias, "2026-09-15"));
          }
        }
      }
    }
  });
});
