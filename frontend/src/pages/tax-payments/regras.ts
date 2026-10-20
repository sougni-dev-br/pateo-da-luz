// Regras puras da tela de Impostos e Guias (sem React): prazo, meses, composição do "a pagar"
// e a grade de cobertura (quais meses já têm guia lançada).

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function diaParaNumero(iso: string): number | null {
  const m = DIA_ISO.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : null;
}

export type PrazoDaGuia = { texto: string; tom: "atraso" | "hoje" | "breve" | "folga" };

// "Vence em 3 dias" diz mais que 20/10/2026 para quem decide o que pagar primeiro.
export function prazoDaGuia(vencimento: string, hoje: string): PrazoDaGuia | null {
  const v = diaParaNumero(vencimento);
  const h = diaParaNumero(hoje);
  if (v == null || h == null) return null;
  const dias = v - h;
  if (dias === 0) return { texto: "vence hoje", tom: "hoje" };
  if (dias === 1) return { texto: "vence amanhã", tom: "breve" };
  if (dias > 1) return { texto: `vence em ${dias} dias`, tom: dias <= 7 ? "breve" : "folga" };
  if (dias === -1) return { texto: "venceu ontem", tom: "atraso" };
  return { texto: `venceu há ${-dias} dias`, tom: "atraso" };
}

// "2026-09" → "set/26"
export function rotuloMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  return m ? `${MESES_ABREV[Number(m[2]) - 1]}/${m[1].slice(2)}` : "—";
}

// "2026-09-01T00:00:00.000Z" → "2026-09"
export function mesDaData(valor: string | null | undefined): string {
  const m = valor ? DIA_ISO.exec(valor) : null;
  return m ? `${m[1]}-${m[2]}` : "";
}

// Campo de mês ("2026-09") → competência gravada ("2026-09-01").
export function competenciaDoMes(mes: string): string {
  return /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : "";
}

// Último dia do mês ("2026-09" → "2026-09-30"), para o filtro "até".
export function ultimoDiaDoMes(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return "";
  const dia = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

export function mesAnterior(mes: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── a pagar por faixa de vencimento ────────────────────────────────────────────
export type FaixaAPagar = { qtd: number; valor: number };
export type APagar = { vencido: FaixaAPagar; ate7: FaixaAPagar; ate30: FaixaAPagar; depois: FaixaAPagar };

export type FatiaAPagar = { chave: keyof APagar; rotulo: string; valor: number; qtd: number; pct: number };

const ROTULOS_FAIXA: Record<keyof APagar, string> = {
  vencido: "Vencido",
  ate7: "Vence em até 7 dias",
  ate30: "Vence em 8 a 30 dias",
  depois: "Vence depois",
};

export function composicaoAPagar(aPagar: APagar): { total: number; qtd: number; fatias: FatiaAPagar[] } {
  const chaves = Object.keys(ROTULOS_FAIXA) as Array<keyof APagar>;
  const total = chaves.reduce((s, c) => s + aPagar[c].valor, 0);
  const qtd = chaves.reduce((s, c) => s + aPagar[c].qtd, 0);
  return {
    total,
    qtd,
    fatias: chaves.map((chave) => ({
      chave,
      rotulo: ROTULOS_FAIXA[chave],
      valor: aPagar[chave].valor,
      qtd: aPagar[chave].qtd,
      pct: total > 0 ? Math.round((aPagar[chave].valor / total) * 100) : 0,
    })),
  };
}

// ─── cobertura: quais competências já têm guia ──────────────────────────────────
export type LinhaCobertura = { mes: string; grupo: string; qtd: number; pagas: number; vencidas: number; valor: number };

export type EstadoCelula = "pago" | "aberto" | "vencido" | "vazio";

export type CelulaGrade = { mes: string; estado: EstadoCelula; qtd: number; valor: number; lacuna: boolean };

export type LinhaGrade = { grupo: string; celulas: CelulaGrade[]; mensal: boolean };

// Ordem em que o dono pensa nos impostos; o resto vem em ordem alfabética.
const ORDEM_GRUPOS = ["Simples Nacional", "FGTS", "INSS", "IRRF / DARF", "GARE / ICMS", "IPTU"];

function posicaoDoGrupo(grupo: string): number {
  const i = ORDEM_GRUPOS.indexOf(grupo);
  return i < 0 ? ORDEM_GRUPOS.length : i;
}

// Um imposto "mensal" tem guia em 3 ou mais competências da janela. Só nele a ausência de um mês
// conta como lacuna (IPTU e taxas anuais não têm guia todo mês).
const MESES_PARA_SER_MENSAL = 3;

export function montarGrade(cobertura: LinhaCobertura[], meses: string[], hoje: string): LinhaGrade[] {
  const ultimoEsperado = mesAnterior(mesDaData(hoje));
  const grupos = [...new Set(cobertura.map((c) => c.grupo))].sort(
    (a, b) => posicaoDoGrupo(a) - posicaoDoGrupo(b) || a.localeCompare(b, "pt-BR")
  );

  return grupos.map((grupo) => {
    const doGrupo = cobertura.filter((c) => c.grupo === grupo);
    const porMes = new Map(doGrupo.map((c) => [c.mes, c]));
    // "Sem categoria" junta guias de naturezas diferentes: não vale como imposto mensal.
    const mensal = grupo !== "Sem categoria" && porMes.size >= MESES_PARA_SER_MENSAL;
    const primeiro = [...porMes.keys()].sort()[0];

    const celulas = meses.map<CelulaGrade>((mes) => {
      const c = porMes.get(mes);
      if (!c || c.qtd === 0) {
        const lacuna = mensal && mes >= primeiro && mes <= ultimoEsperado;
        return { mes, estado: "vazio", qtd: 0, valor: 0, lacuna };
      }
      const estado: EstadoCelula = c.vencidas > 0 ? "vencido" : c.pagas < c.qtd ? "aberto" : "pago";
      return { mes, estado, qtd: c.qtd, valor: c.valor, lacuna: false };
    });
    return { grupo, celulas, mensal };
  });
}

// Por imposto mensal, os meses esperados (até o anterior ao de hoje) em que falta a guia.
export type LacunaDoImposto = { grupo: string; meses: string[] };

export function lacunasPorImposto(grade: LinhaGrade[]): LacunaDoImposto[] {
  return grade
    .map((linha) => ({ grupo: linha.grupo, meses: linha.celulas.filter((c) => c.lacuna).map((c) => c.mes) }))
    .filter((l) => l.meses.length > 0);
}
