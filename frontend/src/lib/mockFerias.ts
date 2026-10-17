// RH → Férias para o modo ?mock-user=1 (só em dev, sem backend). Nomes fictícios; as datas são
// relativas a hoje, então a tela sempre mostra vencida, a vencer, programada e gozada.
// Guarda estado: programar, editar e cancelar pela tela mudam a lista, para ver o fluxo inteiro.
import type { ListaFerias, PeriodoFerias, ProgramacaoFerias, SituacaoFerias } from "../api/client";

const DIA = 86_400_000;
const paraMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);
const paraIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const somaDias = (iso: string, n: number) => paraIso(paraMs(iso) + n * DIA);
const diasEntre = (de: string, ate: string) => Math.round((paraMs(ate) - paraMs(de)) / DIA);
const somaMeses = (iso: string, meses: number) => {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  alvo.setUTCDate(Math.min(d, new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()));
  return paraIso(alvo.getTime());
};

const ALFA = "ALFA EXEMPLO COMERCIO DE ALIMENTOS LTDA";
const BETA = "BETA EXEMPLO BAR E FORNERIA LTDA";

type Gravada = { id: string; employeeId: string; aquisitivoInicio: string; gozoInicio: string | null; dias: number; diasAbono: number; status: "PROGRAMADA" | "GOZADA"; observacao: string | null };
type Pessoa = { id: string; nome: string; empresa: string; setor: string; /** dias da semana de repouso (0 = domingo); [0] = padrão */ repouso?: number[]; admissao: string };

const hoje = () => paraIso(Date.now());
/** Admissão há `anos` anos e `extra` dias (negativo = mais perto). */
const admitidoHa = (anos: number, extra: number) => somaDias(somaMeses(hoje(), -12 * anos), -extra);

function pessoas(): Pessoa[] {
  return [
    { id: "f1", setor: "Cozinha", nome: "Carla Exemplo", empresa: ALFA, admissao: admitidoHa(3, -10) },
    { id: "f2", setor: "Salão", repouso: [2], nome: "Bruno Exemplo", empresa: ALFA, admissao: admitidoHa(2, 330) },
    { id: "f3", setor: "Cozinha", nome: "Igor Exemplo", empresa: BETA, admissao: admitidoHa(2, 285) },
    { id: "f4", setor: "Salão", nome: "Ana Paula Exemplo", empresa: ALFA, admissao: admitidoHa(1, 100) },
    { id: "f5", setor: "Cozinha", nome: "Diego Exemplo", empresa: BETA, admissao: admitidoHa(1, 200) },
    { id: "f6", setor: "Cozinha", nome: "Elisa Exemplo", empresa: ALFA, admissao: admitidoHa(1, 150) },
    { id: "f7", setor: "Salão", nome: "Gisele Exemplo", empresa: BETA, admissao: admitidoHa(1, 120) },
    { id: "f8", setor: "Bar", repouso: [1], nome: "Fabiana Exemplo", empresa: ALFA, admissao: admitidoHa(1, 260) },
    { id: "f9", setor: "Salão", nome: "Joana Exemplo", empresa: BETA, admissao: admitidoHa(1, 60) },
    { id: "f10", setor: "Cozinha", nome: "Lucas Exemplo", empresa: ALFA, admissao: admitidoHa(1, 80) },
    { id: "f11", setor: "Bar", nome: "Helena Exemplo", empresa: BETA, admissao: somaDias(hoje(), -240) },
  ];
}

let gravadas: Gravada[] | null = null;
let proximoId = 1;

/** Programações de partida, em dias a partir de hoje (inicio) — escolhidas para o mapa de calor ter sobreposição. */
function sementes(): Gravada[] {
  const p = pessoas();
  const por = (id: string) => p.find((x) => x.id === id) as Pessoa;
  const aquisitivoDe = (id: string, n: number) => somaMeses(por(id).admissao, 12 * n);
  const linha = (id: string, n: number, deslocamento: number, dias: number, extra: Partial<Gravada> = {}): Gravada => ({
    id: `fp-${proximoId++}`, employeeId: id, aquisitivoInicio: aquisitivoDe(id, n), gozoInicio: somaDias(hoje(), deslocamento), dias, diasAbono: 0,
    status: "PROGRAMADA", observacao: null, ...extra,
  });
  return [
    linha("f5", 0, 30, 20, { diasAbono: 10 }),
    linha("f7", 0, 38, 15),
    linha("f6", 0, 44, 14),
    linha("f10", 0, 36, 12),
    linha("f8", 0, -50, 30, { status: "GOZADA" }),
    linha("f4", 0, -20, 10, { status: "GOZADA" }),
  ];
}

function programacaoNoPeriodo(g: Gravada): ProgramacaoFerias {
  const gozoFim = g.gozoInicio ? somaDias(g.gozoInicio, g.dias - 1) : null;
  return {
    id: g.id, aquisitivoInicio: g.aquisitivoInicio, gozoInicio: g.gozoInicio, gozoFim, dias: g.dias, diasAbono: g.diasAbono, status: g.status,
    observacao: g.observacao, passouDaData: g.status === "PROGRAMADA" && g.gozoInicio !== null && g.gozoInicio <= hoje(),
  };
}

function periodosDe(p: Pessoa, doPessoa: Gravada[]): PeriodoFerias[] {
  const h = hoje();
  const corte = somaMeses(h, -12);
  const periodos: PeriodoFerias[] = [];
  for (let n = 0; ; n++) {
    const inicio = somaMeses(p.admissao, 12 * n);
    if (inicio > h) break;
    const fim = somaDias(somaMeses(p.admissao, 12 * (n + 1)), -1);
    if (fim < corte) continue;
    const fimConcessivo = somaDias(somaMeses(inicio, 24), -1);
    const emAquisicao = fim >= h;
    const deste = doPessoa.filter((g) => g.aquisitivoInicio === inicio);
    const gozados = deste.filter((g) => g.status === "GOZADA").reduce((s, g) => s + g.dias, 0);
    const programados = deste.filter((g) => g.status === "PROGRAMADA").reduce((s, g) => s + g.dias, 0);
    const abono = deste.reduce((s, g) => s + g.diasAbono, 0);
    const pendentes = Math.max(0, 30 - gozados - programados - abono);
    const limite = somaDias(fimConcessivo, -(Math.min(pendentes > 0 && !emAquisicao ? pendentes : 30, 30) - 1));
    const foraDoPrazo = deste.some((g) => g.status === "PROGRAMADA" && g.gozoInicio !== null && somaDias(g.gozoInicio, g.dias - 1) > fimConcessivo);
    const diasParaLimite = !emAquisicao && pendentes > 0 ? diasEntre(h, limite) : null;
    let situacao: SituacaoFerias;
    let nivel: PeriodoFerias["nivel"] = "ok";
    if (emAquisicao) situacao = "EM_AQUISICAO";
    else if (pendentes > 0) {
      const d = diasParaLimite as number;
      if (d < 0) { situacao = "VENCIDA"; nivel = "perigo"; } else if (d <= 30) { situacao = "A_VENCER"; nivel = "perigo"; } else if (d <= 90) { situacao = "A_VENCER"; nivel = "atencao"; } else situacao = "DISPONIVEL";
    } else situacao = programados > 0 ? "PROGRAMADA" : "GOZADA";
    if (!emAquisicao && foraDoPrazo) nivel = "perigo";
    periodos.push({
      aquisitivoInicio: inicio, aquisitivoFim: fim, limiteInicioGozo: limite, fimConcessivo, diasDireito: 30, diasGozados: gozados,
      diasProgramados: programados, diasAbono: abono, diasPendentes: emAquisicao ? 30 : pendentes, situacao, nivel, diasParaLimite,
      diasParaCompletar: emAquisicao ? diasEntre(h, somaDias(fim, 1)) : null, foraDoPrazo, doHistorico: false, programacoes: deste.map(programacaoNoPeriodo),
    });
  }
  return periodos;
}

/** Só os feriados de data fixa (a API real traz também os móveis); basta para ver a regra funcionando. */
function feriadosFixos(): Record<string, string> {
  const fixos: Array<[string, string]> = [
    ["01-01", "Confraternização Universal"], ["01-25", "Aniversário de São Paulo"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalho"],
    ["07-09", "Revolução Constitucionalista"], ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
    ["11-15", "Proclamação da República"], ["11-20", "Consciência Negra"], ["12-25", "Natal"],
  ];
  const ano = Number(hoje().slice(0, 4));
  return Object.fromEntries([ano - 1, ano, ano + 1, ano + 2, ano + 3].flatMap((a) => fixos.map(([md, nome]) => [`${a}-${md}`, nome])));
}

const PESO = { perigo: 2, atencao: 1, ok: 0 } as const;

function montar(): ListaFerias {
  if (!gravadas) gravadas = sementes();
  const lista = pessoas().map((p) => {
    const periodos = periodosDe(p, (gravadas as Gravada[]).filter((g) => g.employeeId === p.id));
    const nivel = periodos.reduce<PeriodoFerias["nivel"]>((pior, per) => (PESO[per.nivel] > PESO[pior] ? per.nivel : pior), "ok");
    return { employeeId: p.id, nome: p.nome, empresa: p.empresa, setor: p.setor, repousoSemanal: p.repouso ?? [0], repousoPelaEscala: p.repouso !== undefined, admissao: p.admissao, nivel, periodos };
  });
  const todos = lista.flatMap((p) => p.periodos);
  return {
    hoje: hoje(), pessoas: lista, semDataDeAdmissao: [], feriados: feriadosFixos(),
    resumo: {
      vencidas: todos.filter((p) => p.situacao === "VENCIDA" || p.foraDoPrazo).length,
      aVencer: todos.filter((p) => p.situacao === "A_VENCER").length,
    },
  };
}

/** GET/POST /payroll/ferias, PATCH e DELETE /payroll/ferias/:id. */
export function mockFerias(url: string, method = "GET", corpo?: unknown): unknown | undefined {
  const u = new URL(url, "http://localhost");
  const m = /\/payroll\/ferias(?:\/([^/]+))?$/.exec(u.pathname);
  if (!m) return undefined;
  if (!gravadas) gravadas = sementes();
  const verbo = method.toUpperCase();
  const dados = typeof corpo === "string" && corpo ? (JSON.parse(corpo) as Record<string, unknown>) : {};
  if (verbo === "GET") return montar();
  if (verbo === "POST") {
    const nova: Gravada = {
      id: `fp-${proximoId++}`, employeeId: String(dados.employeeId), aquisitivoInicio: String(dados.aquisitivoInicio),
      gozoInicio: dados.semDatas ? null : String(dados.gozoInicio), dias: dados.semDatas ? 30 : Number(dados.dias), diasAbono: Number(dados.diasAbono ?? 0),
      status: dados.semDatas ? "GOZADA" : "PROGRAMADA", observacao: typeof dados.observacao === "string" ? dados.observacao : null,
    };
    gravadas = [...gravadas, nova];
    return { id: nova.id };
  }
  const id = m[1];
  if (verbo === "PATCH" && id) {
    gravadas = gravadas.map((g) => (g.id === id ? {
      ...g,
      ...(typeof dados.gozoInicio === "string" ? { gozoInicio: dados.gozoInicio } : {}),
      ...(typeof dados.dias === "number" ? { dias: dados.dias } : {}),
      ...(typeof dados.diasAbono === "number" ? { diasAbono: dados.diasAbono } : {}),
      ...(typeof dados.observacao === "string" ? { observacao: dados.observacao || null } : {}),
      ...(dados.status === "GOZADA" ? { status: "GOZADA" as const } : {}),
    } : g));
    return { id };
  }
  if (verbo === "DELETE" && id) {
    gravadas = gravadas.filter((g) => g.id !== id);
    return { ok: true };
  }
  return undefined;
}
