import type { PlanejamentoComentario, PlanejamentoComparativo, PlanejamentoTurnos } from "../../../api/client";

// Dados só fictícios, para os testes dos comentários.
export function comentarioFicticio(parcial: Partial<PlanejamentoComentario> = {}): PlanejamentoComentario {
  return {
    id: "c1", anoBase: 2025, anoComparado: 2026, mes: 10, metrica: "VENDAS", turno: "TOTAL", texto: "Teste fictício", naImpressao: true,
    autorId: "u1", autorNome: "Ana Teste", criadoEm: "2026-11-01T13:00:00.000Z", editadoEm: null, atualizadoEm: "2026-11-01T13:00:00.000Z",
    epoca: { valorBase: null, valorComparado: null, variacao: null }, podeEditar: true, podeApagar: true, ...parcial
  };
}

const turnos = (v: number): PlanejamentoTurnos => ({ almoco: v / 2, jantar: v / 2, total: v });
const grandezas = (v: number) => ({ vendas: turnos(v * 1000), clientes: turnos(v), ticket: turnos(50) });
const lado = (v: number) => ({ ...grandezas(v), servico: 0, fonte: "ERP" as const, parcial: false });

export function comparativoFicticio(): PlanejamentoComparativo {
  const meses = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1, emAndamento: false, comparavel: true, incompleto: false, base: lado(100), comparado: lado(110), variacao: grandezas(0.1)
  }));
  return {
    anoBase: 2025, anoComparado: 2026, hoje: "2026-12-31", meses,
    acumulado: { base: { ...grandezas(1200), servico: 0 }, comparado: { ...grandezas(1320), servico: 0 }, variacao: grandezas(0.1), mesesComparados: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }
  };
}
