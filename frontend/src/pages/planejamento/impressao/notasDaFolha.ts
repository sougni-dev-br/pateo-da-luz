import type { PlanejamentoComentario, PlanejamentoComentarioMetrica, PlanejamentoComentarioTurno } from "../../../api/client";
import { chaveDoPonto, pontoDoComentario, rotuloDoPonto } from "../comentarios/ponto";

// Quais comentários saem na folha e com que número. Só os marcados "Sai na impressão" entram; os demais viram uma
// contagem. A numeração segue a ordem da folha: grandeza, turno (almoço, jantar, total), mês (acumulado por último).

export type NotaImpressa = { numero: number; rotulo: string; comentario: PlanejamentoComentario };
export type NotasDaFolha = { notas: readonly NotaImpressa[]; naoIncluidos: number; numerosDe: (chave: string) => readonly number[] };

const ORDEM_DA_METRICA: Record<PlanejamentoComentarioMetrica, number> = { VENDAS: 0, CLIENTES: 1, TICKET: 2 };
const ORDEM_DO_TURNO: Record<PlanejamentoComentarioTurno, number> = { ALMOCO: 0, JANTAR: 1, TOTAL: 2 };
const MES_DO_ACUMULADO = 13;

function comparar(a: PlanejamentoComentario, b: PlanejamentoComentario): number {
  return (
    ORDEM_DA_METRICA[a.metrica] - ORDEM_DA_METRICA[b.metrica] ||
    ORDEM_DO_TURNO[a.turno] - ORDEM_DO_TURNO[b.turno] ||
    (a.mes ?? MES_DO_ACUMULADO) - (b.mes ?? MES_DO_ACUMULADO) ||
    a.criadoEm.localeCompare(b.criadoEm)
  );
}

export function notasDaFolha(comentarios: readonly PlanejamentoComentario[], anoComparado: number): NotasDaFolha {
  const marcados = comentarios.filter((c) => c.naImpressao);
  const notas = [...marcados].sort(comparar).map((comentario, i) => ({ numero: i + 1, rotulo: rotuloDoPonto(pontoDoComentario(comentario), anoComparado), comentario }));
  const porCelula = new Map<string, number[]>();
  for (const nota of notas) {
    const chave = chaveDoPonto(pontoDoComentario(nota.comentario));
    porCelula.set(chave, [...(porCelula.get(chave) ?? []), nota.numero]);
  }
  return { notas, naoIncluidos: comentarios.length - marcados.length, numerosDe: (chave) => porCelula.get(chave) ?? [] };
}
