// Quem tem direito a férias agora: ciclos (períodos aquisitivos) completos e quanto tempo a empresa ainda tem para liberar.
import type { PeriodoFerias, PessoaFerias } from "../../../api/client";

export type SituacaoDoDireito = "vencido" | "perto" | "tempo";

export type LinhaDeDireito = {
  pessoa: PessoaFerias;
  /** Ciclos de 12 meses já completos desde a admissão (inclui os que já foram gozados). */
  ciclosCompletos: number;
  /** Ciclos completos que ainda têm dias a gozar, do mais antigo ao mais novo. */
  aGozar: PeriodoFerias[];
  diasPendentes: number;
  /** Último dia para o gozo começar (o do ciclo mais antigo) e quantos dias faltam. */
  limite: string;
  diasParaLimite: number | null;
  /** Último dia do ciclo mais antigo (o direito nasceu no dia seguinte). */
  completoEm: string;
  situacao: SituacaoDoDireito;
};

const DIA_MS = 86_400_000;
const paraIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Quantos ciclos de 12 meses a pessoa já completou até `hoje` (o último dia do ciclo já passou). */
export function ciclosCompletos(admissao: string | null, hoje: string): number {
  if (!admissao) return 0;
  const [ano, mes, dia] = admissao.split("-").map(Number);
  let n = 0;
  while (paraIso(Date.UTC(ano + n + 1, mes - 1, dia) - DIA_MS) < hoje) n++;
  return n;
}

const PENDENTE = (p: PeriodoFerias) => p.situacao !== "EM_AQUISICAO" && p.diasPendentes > 0 && !p.doHistorico;

function situacaoDe(periodos: PeriodoFerias[]): SituacaoDoDireito {
  if (periodos.some((p) => p.situacao === "VENCIDA")) return "vencido";
  return periodos.some((p) => p.situacao === "A_VENCER") ? "perto" : "tempo";
}

/** Quem tem ciclo completo com dias a gozar, do prazo mais curto ao mais longo. */
export function quemTemDireito(pessoas: PessoaFerias[], hoje: string): LinhaDeDireito[] {
  return pessoas
    .map((pessoa): LinhaDeDireito | null => {
      const aGozar = pessoa.periodos.filter(PENDENTE).sort((a, b) => a.aquisitivoInicio.localeCompare(b.aquisitivoInicio));
      if (aGozar.length === 0) return null;
      const primeiro = aGozar[0];
      return {
        pessoa, ciclosCompletos: ciclosCompletos(pessoa.admissao, hoje), aGozar,
        diasPendentes: aGozar.reduce((soma, p) => soma + p.diasPendentes, 0),
        limite: primeiro.limiteInicioGozo, diasParaLimite: primeiro.diasParaLimite, completoEm: primeiro.aquisitivoFim,
        situacao: situacaoDe(aGozar),
      };
    })
    .filter((l): l is LinhaDeDireito => l !== null)
    .sort((a, b) => a.limite.localeCompare(b.limite) || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR"));
}

export const contarPorSituacao = (linhas: LinhaDeDireito[]): Record<SituacaoDoDireito, number> => ({
  vencido: linhas.filter((l) => l.situacao === "vencido").length,
  perto: linhas.filter((l) => l.situacao === "perto").length,
  tempo: linhas.filter((l) => l.situacao === "tempo").length,
});

export type ItemDeDecisao = {
  pessoa: PessoaFerias;
  periodo: PeriodoFerias;
  /** O que pesa na decisão, em poucas palavras: "faltam 6 dias", "venceu há 20 dias". */
  destaque: string;
  /** Quão urgente é: pinta o destaque. */
  tom: "vencido" | "urgente" | "atencao" | "calmo";
  /** "começar até 01/11/2026". */
  prazo: string;
  /** "ciclo completo em 30/11/2025 · 30 dias a gozar". */
  detalhe: string;
};

const dataCurta = (iso: string) => iso.split("-").reverse().join("/");
const emDias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;
const detalheDoCiclo = (p: PeriodoFerias) => `ciclo completo em ${dataCurta(p.aquisitivoFim)} · ${emDias(p.diasPendentes || p.diasDireito)} a gozar`;

/**
 * O que decidir hoje, em duas listas:
 * - atraso: o prazo para começar as férias já venceu (ou a data programada passa dele);
 * - podeProgramar: ciclo completo, dias a gozar, e ainda há tempo; o prazo mais curto vem primeiro.
 */
export function decidirHoje(pessoas: PessoaFerias[], hoje: string): { atraso: ItemDeDecisao[]; podeProgramar: ItemDeDecisao[] } {
  const atraso: ItemDeDecisao[] = [];
  const podeProgramar: ItemDeDecisao[] = [];
  for (const pessoa of pessoas) {
    const noAtraso = new Set<string>();
    for (const periodo of pessoa.periodos) {
      if (periodo.situacao === "EM_AQUISICAO" || periodo.doHistorico) continue;
      if (periodo.situacao === "VENCIDA" && periodo.diasPendentes > 0) {
        const destaque = periodo.diasParaLimite === null ? "prazo vencido" : `venceu há ${emDias(-periodo.diasParaLimite)}`;
        atraso.push({ pessoa, periodo, destaque, tom: "vencido", prazo: `o prazo era ${dataCurta(periodo.limiteInicioGozo)}`, detalhe: detalheDoCiclo(periodo) });
        noAtraso.add(periodo.aquisitivoInicio);
      } else if (periodo.foraDoPrazo) {
        atraso.push({ pessoa, periodo, destaque: "programada fora do prazo", tom: "vencido", prazo: `o prazo era ${dataCurta(periodo.limiteInicioGozo)}`, detalhe: detalheDoCiclo(periodo) });
        noAtraso.add(periodo.aquisitivoInicio);
      }
    }
    const livre = pessoa.periodos.filter(PENDENTE).filter((p) => p.situacao !== "VENCIDA" && !noAtraso.has(p.aquisitivoInicio))
      .sort((a, b) => a.aquisitivoInicio.localeCompare(b.aquisitivoInicio))[0];
    if (livre) {
      const dias = livre.diasParaLimite;
      const tom = dias === null || dias > 90 ? "calmo" : dias > 30 ? "atencao" : "urgente";
      podeProgramar.push({ pessoa, periodo: livre, destaque: dias === null ? "" : `faltam ${emDias(dias)}`, tom, prazo: `começar até ${dataCurta(livre.limiteInicioGozo)}`, detalhe: detalheDoCiclo(livre) });
    }
  }
  const porPrazo = (a: ItemDeDecisao, b: ItemDeDecisao) => a.periodo.limiteInicioGozo.localeCompare(b.periodo.limiteInicioGozo) || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");
  return { atraso: atraso.sort(porPrazo), podeProgramar: podeProgramar.sort(porPrazo) };
}
