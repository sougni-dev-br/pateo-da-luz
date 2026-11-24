import { describe, expect, it } from "vitest";
import { lerBaseMensal } from "../historico-salao-parse.js";

const CAB = ["Ano", "Mês", "Vendas almoço", "Vendas jantar", "Vendas mesas", "TC almoço", "TC jantar", "TC total", "Serviço Doceira", "Arquivo de origem", "Dif. TC turnos"];

describe("lerBaseMensal", () => {
  it("lê uma linha completa e ignora o cabeçalho", () => {
    const r = lerBaseMensal([CAB, [2025, "Jan", 10000, 30000, 40000, 100, 300, 400, 1000, "fechamento-exemplo.xls", 0]]);
    expect(r.avisos).toEqual([]);
    expect(r.linhas).toEqual([
      { ano: 2025, mes: 1, vendasAlmoco: 10000, vendasJantar: 30000, clientesAlmoco: 100, clientesJantar: 300, servico: 1000, fonte: "fechamento-exemplo.xls" }
    ]);
  });

  it("ignora mês ainda não fechado, sem avisar", () => {
    const r = lerBaseMensal([[2026, "Nov", null, null, null, null, null, null, null, "Ainda não fechado"]]);
    expect(r.linhas).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("avisa quando o TC total difere da soma dos turnos e usa a soma (exemplo)", () => {
    const r = lerBaseMensal([[2025, "Dez", 60000, 40000, 100000, 300, 200, 505, 5000, "fechamento-exemplo.xls"]]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].clientesAlmoco + r.linhas[0].clientesJantar).toBe(500);
    expect(r.avisos[0]).toMatch(/TC total \(505\) difere/);
  });

  it("avisa quando Mesas não fecha com almoço + jantar", () => {
    const r = lerBaseMensal([[2025, "Fev", 100, 50, 999, 10, 5, 15, 0, null]]);
    expect(r.avisos[0]).toMatch(/Mesas/);
    expect(r.linhas[0].fonte).toBeNull();
  });

  it("recusa linha com turno faltando ou valor negativo", () => {
    const r = lerBaseMensal([
      [2025, "Mar", 100, null, null, 10, 5],
      [2025, "Abr", -1, 50, 49, 10, 5]
    ]);
    expect(r.linhas).toEqual([]);
    expect(r.avisos).toHaveLength(2);
  });

  it("avisa de mês desconhecido", () => {
    const r = lerBaseMensal([[2025, "Xyz", 1, 1, 2, 1, 1]]);
    expect(r.linhas).toEqual([]);
    expect(r.avisos[0]).toMatch(/não reconhecido/);
  });

  it("texto com ponto decimal não vira milhar, mas o formato pt-BR continua valendo", () => {
    const r = lerBaseMensal([
      [2025, "Jan", "1234.56", "100,50", null, 10, 5],
      [2025, "Fev", "1.234,56", "1.000", null, 10, 5]
    ]);
    expect(r.linhas[0].vendasAlmoco).toBe(1234.56);
    expect(r.linhas[0].vendasJantar).toBe(100.5);
    expect(r.linhas[1].vendasAlmoco).toBe(1234.56);
    expect(r.linhas[1].vendasJantar).toBe(1000);
  });
});
