import { describe, expect, it } from "vitest";
import { diasDoMes, erpCobreOMes, mesclarFontes, mesesEncerradosAte, montarComparativo, variacao, type MesDoSalao } from "../planejamento-comparativo.js";

// Valores reais de jan e fev da planilha de planejamento (Base mensal), sem serviço.
const jan25: MesDoSalao = { ano: 2025, mes: 1, vendasAlmoco: 12960.21, vendasJantar: 32954.72, clientesAlmoco: 166, clientesJantar: 454, servico: 4554.72, fonte: "HISTORICO" };
const jan26: MesDoSalao = { ano: 2026, mes: 1, vendasAlmoco: 25838.72, vendasJantar: 42233.67, clientesAlmoco: 332, clientesJantar: 640, servico: 7051.28, fonte: "ERP" };
const fev25: MesDoSalao = { ano: 2025, mes: 2, vendasAlmoco: 86678.26, vendasJantar: 46836.43, clientesAlmoco: 1009, clientesJantar: 656, servico: 13210.88, fonte: "HISTORICO" };
const fev26: MesDoSalao = { ano: 2026, mes: 2, vendasAlmoco: 66344.63, vendasJantar: 40291.59, clientesAlmoco: 797, clientesJantar: 616, servico: 10552.05, fonte: "ERP" };
const mar25: MesDoSalao = { ...fev25, mes: 3 };
const mar26: MesDoSalao = { ...fev26, mes: 3 };

describe("variacao", () => {
  it("devolve fração e recusa base zerada ou ausente", () => {
    expect(variacao(110, 100)).toBe(0.1);
    expect(variacao(50, 0)).toBeNull();
    expect(variacao(null, 100)).toBeNull();
    expect(variacao(100, null)).toBeNull();
  });
});

describe("mesesEncerradosAte", () => {
  it("considera encerrado só o que vem antes do mês de hoje", () => {
    const e = mesesEncerradosAte("2026-11-23", [2025, 2026]);
    expect(e.has("2026-10")).toBe(true);
    expect(e.has("2026-11")).toBe(false);
    expect(e.has("2025-12")).toBe(true);
    expect(e.size).toBe(12 + 10);
  });
});

describe("montarComparativo", () => {
  const encerrados = mesesEncerradosAte("2026-11-23", [2025, 2026]);
  const MES_ATUAL = "2026-11";

  it("calcula vendas, clientes e ticket por turno e as variações do mês", () => {
    const { meses } = montarComparativo([jan25, jan26], 2025, 2026, encerrados, MES_ATUAL);
    const jan = meses[0];
    expect(jan.comparavel).toBe(true);
    expect(jan.base.vendas.total).toBe(45914.93);
    expect(jan.comparado.vendas.total).toBe(68072.39);
    expect(jan.variacao.vendas.total).toBeCloseTo(0.4826, 3);
    expect(jan.base.clientes.total).toBe(620);
    expect(jan.base.ticket.almoco).toBeCloseTo(78.07, 2);
    expect(jan.comparado.ticket.jantar).toBeCloseTo(65.99, 2);
  });

  it("soma o acumulado e recalcula o ticket pela razão, não pela média dos tickets", () => {
    const { acumulado } = montarComparativo([jan25, jan26, fev25, fev26], 2025, 2026, encerrados, MES_ATUAL);
    expect(acumulado.mesesComparados).toEqual([1, 2]);
    expect(acumulado.base.vendas.total).toBeCloseTo(45914.93 + 133514.69, 2);
    expect(acumulado.base.clientes.total).toBe(620 + 1665);
    expect(acumulado.base.ticket.total).toBeCloseTo((45914.93 + 133514.69) / (620 + 1665), 2);
    const mediaSimples = (74.056 + 80.189) / 2;
    expect(acumulado.base.ticket.total).not.toBeCloseTo(mediaSimples, 1);
  });

  it("deixa o mês em andamento fora do acumulado", () => {
    const hoje = mesesEncerradosAte("2026-03-10", [2025, 2026]);
    const r = montarComparativo([jan25, jan26, fev25, fev26, mar25, mar26], 2025, 2026, hoje, "2026-03");
    expect(r.meses[2].emAndamento).toBe(true);
    expect(r.meses[2].comparavel).toBe(false);
    expect(r.acumulado.mesesComparados).toEqual([1, 2]);
  });

  it('mês futuro com dado só no ano-base não é em andamento', () => {
    const r = montarComparativo([jan25, jan26, { ...fev25, mes: 12 }], 2025, 2026, encerrados, MES_ATUAL);
    expect(r.meses[11].emAndamento).toBe(false);
    expect(r.meses[11].comparavel).toBe(false);
  });

  it("não compara mês sem dado em um dos anos", () => {
    const r = montarComparativo([jan25, jan26, fev26], 2025, 2026, encerrados, MES_ATUAL);
    expect(r.meses[1].comparavel).toBe(false);
    expect(r.meses[1].variacao.vendas.total).toBeNull();
    expect(r.acumulado.mesesComparados).toEqual([1]);
  });

  it("mantém nulos nos meses sem nenhuma informação", () => {
    const r = montarComparativo([jan25, jan26], 2025, 2026, encerrados, MES_ATUAL);
    expect(r.meses[5].base.vendas.total).toBeNull();
    expect(r.meses[5].base.fonte).toBeNull();
    expect(r.meses).toHaveLength(12);
  });

  it("acumulado vazio não quebra e não inventa variação", () => {
    const r = montarComparativo([], 2025, 2026, encerrados, MES_ATUAL);
    expect(r.acumulado.base.vendas.total).toBe(0);
    expect(r.acumulado.variacao.vendas.total).toBeNull();
    expect(r.acumulado.base.ticket.total).toBeNull();
  });

  it("calcula a variação do ticket sobre o valor sem arredondar (acumulado jan-out da planilha: +3,5%)", () => {
    const base: MesDoSalao = { ano: 2025, mes: 1, vendasAlmoco: 1733691.25, vendasJantar: 575681.98, clientesAlmoco: 18959, clientesJantar: 7757, servico: 0, fonte: "HISTORICO" };
    const comp: MesDoSalao = { ano: 2026, mes: 1, vendasAlmoco: 1625918.43, vendasJantar: 530814.73, clientesAlmoco: 16769, clientesJantar: 7326, servico: 0, fonte: "ERP" };
    const { acumulado } = montarComparativo([base, comp], 2025, 2026, new Set(["2025-01", "2026-01"]), "2026-11");
    expect(Math.round((acumulado.variacao.ticket.total ?? 0) * 1000) / 10).toBe(3.5);
  });

  it("mês em andamento não mostra variação, em qualquer dos anos (ano corrente como referência)", () => {
    const hoje = mesesEncerradosAte("2026-03-10", [2025, 2026]);
    const r = montarComparativo([mar25, mar26, jan25, jan26], 2026, 2025, hoje, "2026-03");
    expect(r.meses[2].emAndamento).toBe(true);
    expect(r.meses[2].comparavel).toBe(false);
    expect(r.meses[2].variacao.vendas.total).toBeNull();
    expect(r.meses[0].variacao.vendas.total).not.toBeNull();
  });

  it("mês com venda sem clientes registrados fica sem clientes e ticket e fora do acumulado", () => {
    const incompleto: MesDoSalao = { ...jan26, clientesIncompletos: true };
    const r = montarComparativo([jan25, incompleto, fev25, fev26], 2025, 2026, encerrados, MES_ATUAL);
    expect(r.meses[0].incompleto).toBe(true);
    expect(r.meses[0].comparavel).toBe(false);
    expect(r.meses[0].comparado.clientes.total).toBeNull();
    expect(r.meses[0].comparado.ticket.total).toBeNull();
    expect(r.meses[0].comparado.vendas.total).toBe(68072.39);
    expect(r.acumulado.mesesComparados).toEqual([2]);
  });
});

describe("cobertura do mês no ERP", () => {
  it("calcula dias do mês e exige 90% deles", () => {
    expect(diasDoMes(2026, 2)).toBe(28);
    expect(diasDoMes(2026, 10)).toBe(31);
    expect(erpCobreOMes(28, 2026, 10)).toBe(true);
    expect(erpCobreOMes(27, 2026, 10)).toBe(false);
    expect(erpCobreOMes(26, 2026, 2)).toBe(true);
    expect(erpCobreOMes(25, 2026, 2)).toBe(false);
  });
});

describe("mesclarFontes", () => {
  const erpCheio: MesDoSalao = { ...jan26, ano: 2025, diasComVenda: 31 };
  const erpParcial: MesDoSalao = { ...jan26, ano: 2025, vendasAlmoco: 100, diasComVenda: 5 };

  it("o ERP vence quando o faturamento diário cobre o mês", () => {
    const r = mesclarFontes([erpCheio], [jan25]);
    expect(r).toHaveLength(1);
    expect(r[0].fonte).toBe("ERP");
  });

  it("o histórico completo vence um mês só parcial no ERP", () => {
    const r = mesclarFontes([erpParcial], [jan25]);
    expect(r).toHaveLength(1);
    expect(r[0].fonte).toBe("HISTORICO");
    expect(r[0].vendasAlmoco).toBe(12960.21);
  });

  it("sem histórico, o parcial do ERP é o que existe", () => {
    const r = mesclarFontes([erpParcial], []);
    expect(r).toHaveLength(1);
    expect(r[0].fonte).toBe("ERP");
  });

  it("histórico preenche os meses que o ERP não tem", () => {
    const r = mesclarFontes([erpCheio], [{ ...jan25, mes: 2 }]);
    expect(r.map((m) => `${m.ano}-${m.mes}-${m.fonte}`).sort()).toEqual(["2025-1-ERP", "2025-2-HISTORICO"]);
  });
});
