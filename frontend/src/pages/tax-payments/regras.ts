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

// Mês digitado no filtro de competência: vazio, válido (AAAA-MM com 4 dígitos) ou inválido (ano de 5 ou 6 dígitos, que o campo
// de mês aceita). Inválido não pode virar filtro: a lista voltaria inteira com o texto "competência em —".
export function mesDoFiltro(valor: string): "vazio" | "valido" | "invalido" {
  if (!valor) return "vazio";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(valor) ? "valido" : "invalido";
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
export type LinhaCobertura = { mes: string; grupo: string; categoriaId?: string | null; qtd: number; pagas: number; vencidas: number; valor: number };

export type EstadoCelula = "pago" | "aberto" | "vencido" | "vazio";

export type CelulaGrade = { mes: string; estado: EstadoCelula; qtd: number; valor: number; lacuna: boolean };

export type LinhaGrade = { grupo: string; categoriaId: string | null; celulas: CelulaGrade[]; mensal: boolean };

// Ordem em que o dono pensa nos impostos; o resto vem em ordem alfabética.
const ORDEM_GRUPOS = ["Simples Nacional", "FGTS", "INSS", "IRRF / DARF", "GARE / ICMS", "IPTU"];

function posicaoDoGrupo(grupo: string): number {
  const i = ORDEM_GRUPOS.indexOf(grupo);
  return i < 0 ? ORDEM_GRUPOS.length : i;
}

// Um imposto "mensal" tem guia em 3 ou mais competências da janela. Só nele a ausência de um mês
// conta como lacuna (IPTU e taxas anuais não têm guia todo mês).
const MESES_PARA_SER_MENSAL = 3;

const semAcento = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Sem guia todo mês por natureza: o parcelamento acaba, o IPTU e as taxas são anuais ou parceladas. Para eles a falta de um
// mês não é lacuna (senão "falta lançar" ficaria aceso para sempre depois da última parcela).
const SEM_REGRA_MENSAL = new Set(["parcelamentos tributarios", "iptu", "taxas municipais"]);

// O DARF da Receita junta INSS e IRRF num documento só e a categoria é uma por guia: no mês sem IRRF a guia fica em INSS,
// e no mês em que só a linha do IRRF mudou a guia inteira cai em IRRF / DARF. Um lado cobre o outro.
const PAR_DO_DARF: Record<string, string> = { "inss": "irrf / darf", "irrf / darf": "inss" };

export function montarGrade(cobertura: LinhaCobertura[], meses: string[], hoje: string): LinhaGrade[] {
  const ultimoEsperado = mesAnterior(mesDaData(hoje));
  const grupos = [...new Set(cobertura.map((c) => c.grupo))].sort(
    (a, b) => posicaoDoGrupo(a) - posicaoDoGrupo(b) || a.localeCompare(b, "pt-BR")
  );

  return grupos.map((grupo) => {
    const doGrupo = cobertura.filter((c) => c.grupo === grupo);
    const porMes = new Map(doGrupo.map((c) => [c.mes, c]));
    // "Sem categoria" junta guias de naturezas diferentes: não vale como imposto mensal.
    const mensal = grupo !== "Sem categoria" && !SEM_REGRA_MENSAL.has(semAcento(grupo)) && porMes.size >= MESES_PARA_SER_MENSAL;
    const par = PAR_DO_DARF[semAcento(grupo)];
    const mesesDoPar = new Set(par ? cobertura.filter((c) => semAcento(c.grupo) === par && c.qtd > 0).map((c) => c.mes) : []);
    const primeiro = [...porMes.keys()].sort()[0];

    const celulas = meses.map<CelulaGrade>((mes) => {
      const c = porMes.get(mes);
      if (!c || c.qtd === 0) {
        const lacuna = mensal && mes >= primeiro && mes <= ultimoEsperado && !mesesDoPar.has(mes);
        return { mes, estado: "vazio", qtd: 0, valor: 0, lacuna };
      }
      const estado: EstadoCelula = c.vencidas > 0 ? "vencido" : c.pagas < c.qtd ? "aberto" : "pago";
      return { mes, estado, qtd: c.qtd, valor: c.valor, lacuna: false };
    });
    return { grupo, categoriaId: doGrupo.find((c) => c.categoriaId)?.categoriaId ?? null, celulas, mensal };
  });
}

// ─── falta de guia de UMA empresa ───────────────────────────────────────────────
// A grade acima é de todas as empresas: se a Empresa A lançou o FGTS do mês e a B não, a célula mostra "1" e a falta da B
// passa. Cada CNPJ recolhe a sua guia, então aqui se confere empresa por empresa, de forma conservadora (para não acusar
// falta que não existe):
//  - só empresa com guia identificada em 3 ou mais meses do imposto (as que apareceram uma vez não são cobradas) e que
//    ainda lança: sem guia nos 3 últimos meses esperados ela é tratada como encerrada (ex.: CNPJ antigo);
//  - só a partir do primeiro mês dela e até o mês anterior ao de hoje;
//  - só o mês em que ALGUÉM tem a guia (se ninguém tem, a grade já acusa) e em que nenhuma guia está sem empresa
//    (guia antiga sem empresa pode ser dela);
//  - INSS e IRRF / DARF contam como um imposto só: é o mesmo DARF.
export type CoberturaEmpresa = { mes: string; grupo: string; empresaId: string | null; empresa: string | null; qtd: number };

export type LacunaDeEmpresa = { grupo: string; empresaId: string; empresa: string; meses: string[] };

function grupoLogico(grupo: string): string {
  const g = semAcento(grupo);
  return g === "inss" || g === "irrf / darf" ? "DARF" : grupo;
}

export function lacunasPorEmpresa(cobertura: CoberturaEmpresa[], meses: string[], hoje: string): LacunaDeEmpresa[] {
  const ultimoEsperado = mesAnterior(mesDaData(hoje));
  const porGrupo = new Map<string, CoberturaEmpresa[]>();
  for (const c of cobertura) {
    if (c.qtd <= 0) continue;
    const g = semAcento(c.grupo);
    if (g === "sem categoria" || SEM_REGRA_MENSAL.has(g)) continue;
    const logico = grupoLogico(c.grupo);
    porGrupo.set(logico, [...(porGrupo.get(logico) ?? []), c]);
  }

  const limiteDeAtividade = mesAnterior(mesAnterior(ultimoEsperado));
  const lacunas: LacunaDeEmpresa[] = [];
  for (const [grupo, linhas] of porGrupo) {
    const mesesComGuia = new Set(linhas.map((l) => l.mes));
    const mesesComGuiaSemEmpresa = new Set(linhas.filter((l) => !l.empresaId).map((l) => l.mes));
    const empresas = new Map<string, { nome: string; meses: Set<string> }>();
    for (const l of linhas) {
      if (!l.empresaId) continue;
      const e = empresas.get(l.empresaId) ?? { nome: l.empresa ?? "Empresa", meses: new Set<string>() };
      e.meses.add(l.mes);
      empresas.set(l.empresaId, e);
    }
    for (const [empresaId, e] of empresas) {
      if (e.meses.size < MESES_PARA_SER_MENSAL) continue;
      const ordenados = [...e.meses].sort();
      if (ordenados[ordenados.length - 1] < limiteDeAtividade) continue;
      const primeiro = ordenados[0];
      const faltando = meses.filter((m) => m >= primeiro && m <= ultimoEsperado && !e.meses.has(m) && mesesComGuia.has(m) && !mesesComGuiaSemEmpresa.has(m));
      if (faltando.length > 0) lacunas.push({ grupo, empresaId, empresa: e.nome, meses: faltando });
    }
  }
  return lacunas.sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR") || a.empresa.localeCompare(b.empresa, "pt-BR"));
}

// Por imposto mensal, os meses esperados (até o anterior ao de hoje) em que falta a guia.
export type LacunaDoImposto = { grupo: string; meses: string[] };

export function lacunasPorImposto(grade: LinhaGrade[]): LacunaDoImposto[] {
  return grade
    .map((linha) => ({ grupo: linha.grupo, meses: linha.celulas.filter((c) => c.lacuna).map((c) => c.mes) }))
    .filter((l) => l.meses.length > 0);
}

// Link para a guia em Contas a Pagar, onde a baixa é registrada: filtra pelo número do documento (ou pelo tipo)
// e pelo mês do vencimento, e abre em "Todos" para a guia aparecer aberta ou paga.
export function linkContasAPagar(guia: { id: string; documentNumber: string | null; documentType: string; dueDate: string }): string {
  const mes = mesDaData(guia.dueDate);
  // titulo + abrir=baixa: Contas a Pagar abre direto a baixa desta guia (a busca por texto fica de reserva);
  // origem=impostos mostra o caminho de volta.
  const params = new URLSearchParams({ busca: guia.documentNumber?.trim() || guia.documentType, aba: "todos", titulo: guia.id, abrir: "baixa", origem: "impostos" });
  if (mes) {
    params.set("de", `${mes}-01`);
    params.set("ate", ultimoDiaDoMes(mes));
  }
  return `/financeiro/contas-a-pagar?${params.toString()}`;
}
