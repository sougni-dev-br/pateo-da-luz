import { describe, expect, it } from "vitest";
import { montarResultadoCompleto } from "../dashboard-resultado.js";

const base = { net: 100000, purchasesTotal: 40000, smallExpenses: 1000, payrollPayments: 20000, taxPaymentsPorGrupo: { IMPOSTOS: 4000, SEM_GRUPO: 1000 } };

describe("montarResultadoCompleto", () => {
  it("subtrai compras, folha, impostos e ocupação do faturamento líquido", () => {
    const r = montarResultadoCompleto({ ...base, porGrupoDeCompra: { LOCACAO: 10000 } });
    expect(r.purchases).toBe(30000);
    expect(r.occupancy).toBe(10000);
    expect(r.value).toBe(100000 - 30000 - 1000 - 20000 - 5000 - 10000);
    expect(r.marginPercent).toBeCloseTo(34, 5);
  });

  it("não conta duas vezes o que já estava dentro das compras", () => {
    const r = montarResultadoCompleto({
      ...base,
      porGrupoDeCompra: { LOCACAO: 10000, IMPOSTOS: 2000, PESSOAL: 1500, VALE_TRANSPORTE: 500 },
    });
    expect(r.purchases).toBe(26000);
    expect(r.payroll).toBe(22000);
    expect(r.taxes).toBe(7000);
    // o total gasto é o mesmo de antes: só mudou de linha
    expect(r.purchases + r.payroll + r.taxes + r.occupancy + r.smallExpenses).toBe(40000 + 1000 + 20000 + 5000);
  });

  it("guia de FGTS (grupo Pessoal) conta como folha, não como imposto", () => {
    const r = montarResultadoCompleto({ ...base, taxPaymentsPorGrupo: { IMPOSTOS: 3000, PESSOAL: 1500, SEM_GRUPO: 500 }, porGrupoDeCompra: {} });
    expect(r.payroll).toBe(21500);
    expect(r.taxes).toBe(3500);
    expect(r.value).toBe(100000 - 40000 - 1000 - 21500 - 3500);
  });

  it("energia, água, gás e telefonia entram em ocupação junto com aluguel e condomínio", () => {
    const r = montarResultadoCompleto({ ...base, porGrupoDeCompra: { LOCACAO: 7000, TARIFAS_PUBLICAS: 3000 } });
    expect(r.occupancy).toBe(10000);
    expect(r.purchases).toBe(30000);
  });

  it("sem faturamento a margem é nula", () => {
    const r = montarResultadoCompleto({ ...base, net: 0, porGrupoDeCompra: {} });
    expect(r.marginPercent).toBeNull();
    expect(r.value).toBeLessThan(0);
  });
});
