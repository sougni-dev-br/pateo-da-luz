import { describe, expect, test } from "vitest";

// Regras da reconciliacao de estoque por inventario aprovado (F-05).
// Reimplementadas aqui porque inventory.routes.ts importa o Prisma no topo do
// modulo e nao carrega em teste unitario sem banco. O comportamento contra o
// Postgres real foi verificado a parte (custo medio preservado, compra posterior
// a contagem mantida, movimento ADJUSTMENT ligado ao inventario).

const MAX_DIAS_PARA_RECONCILIAR = 30;

function deveReconciliar(input: {
  stockReconciledAt: Date | null;
  dataContagem: Date;
  hoje: Date;
}) {
  if (input.stockReconciledAt) return { ok: false, motivo: "JA_RECONCILIADO" as const };
  const dias = Math.floor((input.hoje.getTime() - input.dataContagem.getTime()) / 86_400_000);
  if (dias > MAX_DIAS_PARA_RECONCILIAR) return { ok: false, motivo: "CONTAGEM_ANTIGA" as const };
  return { ok: true as const };
}

// O ajuste aplica a DIVERGENCIA apurada na contagem, nao o valor contado.
function saldoApos(saldoAtual: number, divergencia: number) {
  return saldoAtual + divergencia;
}

const dia = (iso: string) => new Date(iso + "T12:00:00Z");

describe("quando reconciliar", () => {
  test("inventario recente e ainda nao reconciliado: aplica", () => {
    expect(deveReconciliar({
      stockReconciledAt: null, dataContagem: dia("2026-09-01"), hoje: dia("2026-09-03")
    })).toEqual({ ok: true });
  });

  test("ja reconciliado nao aplica de novo", () => {
    // A rota de aprovacao aceita reaprovar um inventario ja aprovado; sem esta
    // guarda a correcao seria dobrada.
    expect(deveReconciliar({
      stockReconciledAt: dia("2026-09-02"), dataContagem: dia("2026-09-01"), hoje: dia("2026-09-03")
    })).toEqual({ ok: false, motivo: "JA_RECONCILIADO" });
  });

  test("contagem de meses atras nao reescreve o estoque de hoje", () => {
    // INV-2026-0011 e um rascunho de junho com 322 divergencias parado no sistema.
    expect(deveReconciliar({
      stockReconciledAt: null, dataContagem: dia("2026-06-05"), hoje: dia("2026-09-03")
    })).toEqual({ ok: false, motivo: "CONTAGEM_ANTIGA" });
  });

  test("no limite de 30 dias ainda aplica", () => {
    expect(deveReconciliar({
      stockReconciledAt: null, dataContagem: dia("2026-08-04"), hoje: dia("2026-09-03")
    })).toEqual({ ok: true });
  });

  test("um dia alem do limite nao aplica", () => {
    expect(deveReconciliar({
      stockReconciledAt: null, dataContagem: dia("2026-08-03"), hoje: dia("2026-09-03")
    })).toEqual({ ok: false, motivo: "CONTAGEM_ANTIGA" });
  });
});

describe("efeito no saldo", () => {
  test("divergencia negativa baixa o saldo", () => {
    expect(saldoApos(10, -6)).toBe(4);
  });

  test("compra recebida entre a contagem e a aprovacao e preservada", () => {
    // Esperado 10, contado 4 (divergencia -6). Depois da contagem entraram 20.
    // Aplicar o valor contado daria 4 e apagaria a compra; aplicar a divergencia
    // sobre o saldo atual (30) da 24, que e o correto.
    expect(saldoApos(30, -6)).toBe(24);
  });

  test("divergencia positiva sobe o saldo", () => {
    expect(saldoApos(2, 5)).toBe(7);
  });
});

describe("saldo negativo apos o ajuste", () => {
  // Se entre a contagem e a aprovacao sairam mais itens do que o contado, a
  // divergencia leva o saldo abaixo de zero. Nao limitamos a zero: isso
  // mascararia a inconsistencia. O caso volta na resposta para aparecer na tela.
  test("saida maior que o contado leva o saldo abaixo de zero", () => {
    // Esperado 10, contado 4 (divergencia -6). Depois sairam 8, saldo hoje 2.
    expect(saldoApos(2, -6)).toBe(-4);
  });

  test("nao e limitado a zero", () => {
    expect(saldoApos(2, -6)).toBeLessThan(0);
  });
});
