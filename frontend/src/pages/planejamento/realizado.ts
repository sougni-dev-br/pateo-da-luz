import type { PlanejamentoGrupoDeGasto, PlanejamentoLinhaDeGasto, PlanejamentoRealizadoDoGrupo } from "../../api/client";
import { ROTULO_DO_GRUPO } from "./formato";

// Aplica o realizado do DRE às linhas de gasto do cenário. Mexe só na PRIMEIRA linha de cada grupo marcado (um grupo
// com várias linhas não tem como ser dividido sozinho) e cria a linha se o grupo ainda não tem. Devolve cópias.

export type ModoDoPreenchimento = "MEDIA" | "MESMO_MES";

const mesesPreenchidos = (): number[] => Array(12).fill(0) as number[];

function nomeLivre(base: string, gastos: readonly PlanejamentoLinhaDeGasto[]): string {
  const usados = new Set(gastos.map((g) => g.nome.trim().toLowerCase()));
  if (!usados.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidato = `${base} (${n})`;
    if (!usados.has(candidato.toLowerCase())) return candidato;
  }
}

/** Só vira sugestão o que o cenário aceita ao salvar: valor em R$ não negativo e percentual entre 0% e 100%. */
export function temSugestao(g: PlanejamentoRealizadoDoGrupo): boolean {
  return g.media !== null && g.media >= 0;
}

function valoresDaLinha(linha: PlanejamentoLinhaDeGasto, sugestao: PlanejamentoRealizadoDoGrupo, modo: ModoDoPreenchimento): number[] | null {
  if (linha.modo === "PERCENTUAL") {
    const p = sugestao.percentualDaReceita;
    return p === null || p < 0 || p > 1 ? null : (Array(12).fill(p) as number[]);
  }
  if (!temSugestao(sugestao) || sugestao.media === null) return null;
  const media = sugestao.media;
  if (modo === "MEDIA") return Array(12).fill(media) as number[];
  // Mesmo mês: só vale o realizado dos meses que entraram na média; mês fechado sem lançamento (ou ainda aberto) recebe a média.
  return sugestao.valoresPorMes.map((v, i) => (v !== null && sugestao.mesesConsiderados.includes(i + 1) ? v : media));
}

export function aplicarRealizado(
  gastos: readonly PlanejamentoLinhaDeGasto[],
  sugestoes: readonly PlanejamentoRealizadoDoGrupo[],
  modo: ModoDoPreenchimento
): { gastos: PlanejamentoLinhaDeGasto[]; gruposAplicados: PlanejamentoGrupoDeGasto[] } {
  let resultado = gastos.map((g) => ({ ...g, valores: [...g.valores] }));
  const aplicados: PlanejamentoGrupoDeGasto[] = [];

  for (const sugestao of sugestoes) {
    const indice = resultado.findIndex((g) => g.grupo === sugestao.grupo);
    if (indice >= 0) {
      const valores = valoresDaLinha(resultado[indice], sugestao, modo);
      if (valores === null) continue;
      resultado = resultado.map((g, i) => (i === indice ? { ...g, valores } : g));
      aplicados.push(sugestao.grupo);
      continue;
    }
    // Grupo sem linha: cria uma FIXA (tributos nasce em % das vendas, como nas linhas padrão).
    const nova: PlanejamentoLinhaDeGasto = {
      grupo: sugestao.grupo,
      nome: nomeLivre(ROTULO_DO_GRUPO[sugestao.grupo] ?? sugestao.grupo, resultado),
      modo: sugestao.grupo === "TRIBUTOS" ? "PERCENTUAL" : "FIXO",
      valores: mesesPreenchidos()
    };
    const valores = valoresDaLinha(nova, sugestao, modo);
    if (valores === null) continue;
    resultado = [...resultado, { ...nova, valores }];
    aplicados.push(sugestao.grupo);
  }
  return { gastos: resultado, gruposAplicados: aplicados };
}
