import { CalendarDays, ChevronLeft, ChevronRight, Eye, EyeOff, Maximize2, Minimize2, Minus, Palette, Plus, Printer, RefreshCw, Save } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  EventSize, ScheduleData, ScheduleDateEvent, ScheduleDayType, ScheduleEmployee, ScheduleEntry,
  adjustHolidayComp, getSchedule, saveScheduleBulk
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Alert, Button, EmptyState, PanelEyebrow } from "../design-system";
import { useNavigationGuard } from "../lib/navigationGuard";
import { hasPermission } from "../lib/permissions";

const DOW_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];
const PRINT_DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const REGIME_SHORT: Record<string, string> = { SEIS_POR_UM: "6×1", CINCO_POR_DOIS: "5×2" };

// Paleta única da escala — MESMAS cores na tela e no mural impresso.
const COLORS = {
  folga: "#1f2937",     // escuro
  // FF e FBH vivem na MESMA família da folga de propósito: no mural as três
  // significam a mesma coisa — essa pessoa não trabalha hoje. Cor nova só para
  // elas aumentaria o que precisa ser decorado sem ganho de leitura; a distinção
  // fica nas letras, que quem precisa do detalhe lê de perto.
  folgaFeriado: "#334155",  // cinza um tom acima
  folgaBanco: "#475569",    // cinza dois tons acima
  falta: "#b91c1c",     // vermelho forte — X de falta (longe do salmao do domingo)
  atestado: "#7c3aed",  // violeta — AT de atestado (nao confunde com ferias azul)
  turno: "#ea580c",     // laranja vibrante (distinto da folga)
  // UMA cor por evento — a MESMA no cabeçalho da data e na coluna inteira,
  // igual domingo/feriado. Dois tons para o mesmo evento gerava dupla leitura.
  // Intensidade média/clara: pinta a coluna sem sufocar as marcas F/T.
  eventoPequeno: "#2dd4bf", // teal
  eventoMedio: "#fbbf24",   // âmbar
  eventoGrande: "#e879f9",  // magenta (longe do salmão do domingo)
  ferias: "#2563eb",    // azul
  domingo: "#ff8a8a",   // vermelho/rosa
  feriado: "#8fd14f",   // verde
};

// Catálogo das marcas da célula. Fonte ÚNICA para a paleta, a legenda, o
// desenho da célula e a impressão — antes cada um desses lugares repetia a
// própria lista, e bastava esquecer um para a marca sumir de algum canto.
type MarcaCelula = "FOLGA" | "FOLGA_FERIADO" | "FOLGA_BANCO_HORAS" | "TURNO" | "FALTA" | "ATESTADO";
const MARCAS: Array<{
  tipo: MarcaCelula;
  letra: string;
  nome: string;
  cor: string;
  /** Sai na escala impressa do mural? Falta e atestado NÃO saem. */
  noMural: boolean;
  /** Texto do title na célula. */
  ajuda: string;
}> = [
  { tipo: "FOLGA", letra: "F", nome: "Folga", cor: COLORS.folga, noMural: true, ajuda: "Folga" },
  { tipo: "FOLGA_FERIADO", letra: "FF", nome: "Folga de feriado", cor: COLORS.folgaFeriado, noMural: true, ajuda: "Folga de feriado — debita o saldo de feriado trabalhado" },
  { tipo: "FOLGA_BANCO_HORAS", letra: "FBH", nome: "Folga banco de horas", cor: COLORS.folgaBanco, noMural: true, ajuda: "Folga do banco de horas" },
  { tipo: "TURNO", letra: "T", nome: "Turno / cobertura", cor: COLORS.turno, noMural: true, ajuda: "Turno estendido (cobertura)" },
  { tipo: "FALTA", letra: "X", nome: "Falta", cor: COLORS.falta, noMural: false, ajuda: "Falta — desconta no próximo VT" },
  { tipo: "ATESTADO", letra: "AT", nome: "Atestado", cor: COLORS.atestado, noMural: false, ajuda: "Atestado médico — desconta no próximo VT" },
];
const MARCA_POR_TIPO = new Map(MARCAS.map((m) => [m.tipo, m]));
// Folga de qualquer origem: não trabalha, não paga condução.
const FOLGAS: MarcaCelula[] = ["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS"];

// Evento por data (do dia inteiro) — 3 tamanhos, marcados no cabeçalho.
const EVENT_COLOR: Record<EventSize, string> = {
  PEQUENO: COLORS.eventoPequeno, MEDIO: COLORS.eventoMedio, GRANDE: COLORS.eventoGrande,
};
const EVENT_LABEL: Record<EventSize, string> = {
  PEQUENO: "Evento pequeno", MEDIO: "Evento médio", GRANDE: "Evento grande",
};
// Ciclo do clique no cabeçalho: — → Pequeno → Médio → Grande → —
const EVENT_NEXT: Record<EventSize, EventSize | null> = { PEQUENO: "MEDIO", MEDIO: "GRANDE", GRANDE: null };

// Ordem fixa dos setores e das praças/subgrupos na escala (pedido do Eli).
const SECTOR_ORDER = ["Liderança", "Cozinha", "Salão", "Pia", "Pizzaria"];
const SUBGROUP_ORDER: Record<string, string[]> = {
  "Cozinha": ["Quente", "Fria", "Tarde"],
  "Salão": ["Buffet", "Bar", "Atendente"],
  "Pia": ["Manhã", "Tarde"],
};

// Descanso Semanal Remunerado (CLT art. 67 / Lei 605/49): um repouso de 24h por
// SEMANA. Daí sair 4 ou 5 folgas no mês, conforme quantas semanas ele tem.
//
// Tudo aqui é ALERTA, nunca trava: o Pateo não segue o 6×1 à risca (cobertura,
// troca entre a equipe, evento), então a tela aponta a diferença e quem decide
// é quem monta a escala. Salvar nunca fica bloqueado.
const REGRA_REGIME: Record<string, { maxSeguidos: number; folgasPorSemana: number }> = {
  SEIS_POR_UM: { maxSeguidos: 6, folgasPorSemana: 1 },
  CINCO_POR_DOIS: { maxSeguidos: 5, folgasPorSemana: 2 },
};
const REGRA_PADRAO = REGRA_REGIME.SEIS_POR_UM;

// Com que frequência a folga precisa cair num DOMINGO (os prazos vêm das
// configurações da folha, porque quem os fecha na prática é a convenção
// coletiva da categoria):
//
//   Mulher — a cada 2 semanas  (CLT art. 386, escala quinzenal; o TST tem
//            anulado cláusulas coletivas que igualam homens e mulheres aqui)
//   Demais — a cada 3 semanas  (Lei 10.101/2000 art. 6º p. único, aplicada por
//            analogia a bares e restaurantes)
// Domingos trabalhados seguidos que a regra tolera = (semanas permitidas − 1):
// folgar a cada 2 semanas significa emendar no máximo 1 domingo.
// Sexo não informado usa o limite da mulher — errar para o lado do descanso.
function limiteDomingos(gender: string, cfg: { mulher: number; geral: number }): number {
  const semanas = gender === "MASCULINO" ? cfg.geral : cfg.mulher;
  return Math.max(0, semanas - 1);
}

// Quantas semanas o mês tem, contando os domingos: cada domingo abre uma semana.
// É o que faz um mês prever 4 folgas e outro 5 — e é uma contagem que dá para
// conferir no calendário, diferente de dividir dias por 7 (que dá 4 para
// qualquer mês de 28 a 34 dias e nunca produziria o caso das 5 folgas).
function semanasDoMes(year: number, month: number, filtro?: (dia: number) => boolean): number {
  const dias = new Date(year, month, 0).getDate();
  let n = 0;
  for (let d = 1; d <= dias; d++) {
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() !== 0) continue;
    if (filtro && !filtro(d)) continue;
    n += 1;
  }
  return n;
}

const UNSAVED_CONFIRM = "Você tem alterações não salvas na escala. Sair sem salvar vai descartá-las. Deseja continuar?";

function keyOf(employeeId: string, day: number) {
  return `${employeeId}|${day}`;
}
// Escapa texto livre antes de entrar no HTML do mural. Nome, setor e praça são
// digitados à mão no cadastro e vão parar num document.write — sem isto, um "<"
// no nome de alguém quebra a folha impressa, e um <script> executa.
function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function fullName(e: { firstName: string; lastName: string; displayName?: string | null }) {
  return e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();
}
function dateMs(year: number, month: number, day: number) {
  return Date.UTC(year, month - 1, day);
}
function withinEmployment(e: ScheduleEmployee, year: number, month: number, day: number) {
  const t = dateMs(year, month, day);
  if (e.admissionDate) {
    const a = new Date(e.admissionDate).getTime();
    if (!isNaN(a) && t < a) return false;
  }
  if (e.terminationDate) {
    const term = new Date(e.terminationDate).getTime();
    if (!isNaN(term) && t > term) return false;
  }
  return true;
}

export function Escala() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "schedule", "edit");
  const { notice, setNotice } = useNotice();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<ScheduleData | null>(null);
  const [marks, setMarks] = useState<Map<string, ScheduleDayType>>(new Map());
  const [dateEvents, setDateEvents] = useState<Map<number, EventSize>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comp, setComp] = useState<Map<string, number>>(new Map());
  // Modo "montar escala": o painel vira overlay de tela cheia (some o menu),
  // dando o máximo de área para enxergar o mês inteiro de uma vez.
  const [fullscreen, setFullscreen] = useState(false);
  // Densidade: em tela cheia o que importa é caber gente na tela, então legenda
  // e os detalhes sob o nome (turno, folga-feriado) começam recolhidos.
  const [showLegend, setShowLegend] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  // Marca selecionada na paleta. null = o clique volta a ciclar F → T → vazio.
  const [pincel, setPincel] = useState<MarcaCelula | null>(null);
  const [regraDomingo, setRegraDomingo] = useState({ mulher: 2, geral: 3 });

  // Entrar em tela cheia recolhe legenda e detalhes (densidade máxima para
  // montar a escala); sair devolve os dois. Usado pelo botão E pelo Esc.
  function setFullscreenMode(next: boolean) {
    setFullscreen(next);
    setShowLegend(!next);
    setShowDetails(!next);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await getSchedule(year, month);
      setData(d);
      const m = new Map<string, ScheduleDayType>();
      d.entries.forEach((e) => m.set(keyOf(e.employeeId, e.day), e.type));
      setMarks(m);
      const de = new Map<number, EventSize>();
      d.dateEvents.forEach((e) => de.set(e.day, e.size));
      setDateEvents(de);
      const cm = new Map<string, number>();
      d.employees.forEach((e) => cm.set(e.id, e.holidayCompBalance));
      setComp(cm);
      setRegraDomingo(d.regraDomingo ?? { mulher: 2, geral: 3 });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar escala.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [year, month]);

  // Proteção contra perda de edições: avisa antes de fechar/recarregar a aba
  // (ou navegar por URL) com alterações não salvas — diálogo nativo do navegador.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Tela cheia: ESC sai e o fundo não rola junto.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreenMode(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  function handleReload() {
    if (dirty && !window.confirm(UNSAVED_CONFIRM)) return;
    void load();
  }

  // Blindagem: confirma antes de sair da tela pelo menu com edições não salvas.
  useNavigationGuard(dirty, UNSAVED_CONFIRM);

  // Agrupamento em 2 níveis: setor (ordem canônica) → praça/subgrupo (ordem
  // canônica) → funcionários. Setores/subgrupos fora da lista canônica vão ao
  // fim, na ordem de aparição. Sem subgrupo = funcionários direto sob o setor.
  const sectorGroups = useMemo(() => {
    if (!data) return [];
    const bySector = new Map<string, Map<string, ScheduleEmployee[]>>();
    const seen: string[] = [];
    for (const emp of data.employees) {
      const sector = emp.sector || "Sem setor";
      const sub = emp.subgroup || "";
      if (!bySector.has(sector)) { bySector.set(sector, new Map()); seen.push(sector); }
      const subs = bySector.get(sector)!;
      if (!subs.has(sub)) subs.set(sub, []);
      subs.get(sub)!.push(emp);
    }
    const orderedSectors = [
      ...SECTOR_ORDER.filter((s) => bySector.has(s)),
      ...seen.filter((s) => !SECTOR_ORDER.includes(s)),
    ];
    return orderedSectors.map((sector) => {
      const subsMap = bySector.get(sector)!;
      const canon = SUBGROUP_ORDER[sector] ?? [];
      const orderedKeys = [
        ...canon.filter((k) => subsMap.has(k)),
        ...Array.from(subsMap.keys()).filter((k) => k !== "" && !canon.includes(k)),
        ...(subsMap.has("") ? [""] : []),
      ];
      return {
        sector,
        subs: orderedKeys.map((k) => ({ subgroup: k || null, employees: subsMap.get(k)! })),
      };
    });
  }, [data]);

  // Dias de férias (vindos do backend como PayrollItem FERIAS) — sombreados, read-only.
  const feriasSet = useMemo(() => {
    const s = new Set<string>();
    for (const v of data?.vacationDays ?? []) s.add(keyOf(v.employeeId, v.day));
    return s;
  }, [data]);
  function isFerias(employeeId: string, day: number): boolean {
    return feriasSet.has(keyOf(employeeId, day));
  }

  // Duas formas de marcar, e isso é de propósito:
  //
  // 1. Sem pincel selecionado, o clique CICLA vazio → F → T → vazio. É o gesto
  //    de sempre e resolve 90% do mês (folga e cobertura).
  // 2. Com um pincel selecionado na paleta, o clique APLICA aquela marca —
  //    clicar de novo na mesma célula limpa.
  //
  // O ciclo não foi estendido para as seis marcas porque sete estados custariam
  // seis cliques para limpar uma célula. A paleta também é muito mais rápida
  // para montar o mês: escolhe F uma vez e sai clicando.
  function toggle(employeeId: string, day: number) {
    if (!canEdit) return;
    setMarks((prev) => {
      const next = new Map(prev);
      const k = keyOf(employeeId, day);
      const cur = next.get(k);
      if (pincel) {
        if (cur === pincel) next.delete(k);
        else next.set(k, pincel);
        return next;
      }
      if (!cur) next.set(k, "FOLGA");
      else if (cur === "FOLGA") next.set(k, "TURNO");
      else next.delete(k);
      return next;
    });
    setDirty(true);
  }

  // Evento da DATA inteira (cabeçalho). Ciclo: — → Pequeno → Médio → Grande → —.
  function toggleDateEvent(day: number) {
    if (!canEdit) return;
    setDateEvents((prev) => {
      const next = new Map(prev);
      const cur = next.get(day);
      if (!cur) next.set(day, "PEQUENO");
      else {
        const nx = EVENT_NEXT[cur];
        if (nx) next.set(day, nx);
        else next.delete(day);
      }
      return next;
    });
    setDirty(true);
  }

  function goMonth(delta: number) {
    if (dirty && !window.confirm(UNSAVED_CONFIRM)) return;
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  }

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const entries: ScheduleEntry[] = Array.from(marks.entries()).map(([k, type]) => {
        const sep = k.lastIndexOf("|");
        return { employeeId: k.slice(0, sep), day: Number(k.slice(sep + 1)), type };
      });
      const events: ScheduleDateEvent[] = Array.from(dateEvents.entries()).map(([day, size]) => ({ day, size }));
      const res = await saveScheduleBulk(year, month, entries, events);
      // A contagem de faltas sai separada: elas mexem em dinheiro (descontam no
      // VT seguinte), e o aviso antigo só falava em folgas — quem marcava uma
      // falta salvava sem nenhuma confirmação de que ela tinha sido registrada.
      const tipos = Array.from(marks.values());
      const faltas = tipos.filter((t) => t === "FALTA").length;
      const atestados = tipos.filter((t) => t === "ATESTADO").length;
      const ausencias = [
        faltas > 0 ? `${faltas} falta(s)` : null,
        atestados > 0 ? `${atestados} atestado(s)` : null,
      ].filter(Boolean).join(" e ");
      setNotice({
        tone: "success",
        message: `Escala salva — ${res.count} marcação(ões) e ${res.events} evento(s) em ${MONTHS[month - 1]}`
          + (ausencias ? `, incluindo ${ausencias} que vão descontar no próximo VT.` : "."),
      });
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar escala.");
    } finally {
      setSaving(false);
    }
  }

  async function handleComp(employeeId: string, delta: number) {
    if (!canEdit) return;
    try {
      const res = await adjustHolidayComp(employeeId, delta);
      setComp((prev) => new Map(prev).set(employeeId, res.holidayCompBalance));
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao ajustar folga." });
    }
  }

  // FOLGA e FALTA reduzem dia trabalhado; TURNO (cobertura) é dia trabalhado.
  // Espelha o backend, que no VT desconta folga, férias e falta.
  function isFolga(employeeId: string, day: number): boolean {
    const m = marks.get(keyOf(employeeId, day));
    return !!m && (FOLGAS as string[]).includes(m);
  }

  // Falta e atestado: em ambos a pessoa não veio, então nenhum conta como dia
  // trabalhado nem paga condução.
  function isAusencia(employeeId: string, day: number): boolean {
    const m = marks.get(keyOf(employeeId, day));
    return m === "FALTA" || m === "ATESTADO";
  }
  // Folgas de feriado tiradas no mês — só para o resumo sob o nome.
  function folgasFeriadoNoMes(emp: ScheduleEmployee): number {
    if (!data) return 0;
    return data.days.filter((d) => marks.get(keyOf(emp.id, d.day)) === "FOLGA_FERIADO").length;
  }

  function holidaysWorked(emp: ScheduleEmployee): number {
    if (!data) return 0;
    return data.days.filter((d) => d.isHoliday && withinEmployment(emp, year, month, d.day) && !isFolga(emp.id, d.day) && !isFerias(emp.id, d.day)).length;
  }

  // Marcações dos meses vizinhos, indexadas por "empId|AAAA-MM-DD". Só leitura:
  // a validação da virada precisa delas, a edição não as alcança.
  const borderByKey = useMemo(() => {
    const m = new Map<string, ScheduleDayType>();
    for (const b of data?.borderDays ?? []) m.set(`${b.employeeId}|${b.date}`, b.type);
    return m;
  }, [data]);

  // Meses vizinhos que TÊM escala montada. Ausência de marcação significa "dia
  // trabalhado" — regra correta dentro de um mês montado, desastrosa fora dele:
  // um mês que ninguém preencheu ainda viraria 30 dias seguidos de trabalho e
  // acusaria todo mundo. Sem escala no vizinho, a sequência simplesmente para na
  // virada em vez de inventar dias.
  const mesesVizinhosComEscala = useMemo(() => {
    const m = new Set<string>();
    for (const b of data?.borderDays ?? []) m.add(`${b.employeeId}|${b.date.slice(0, 7)}`);
    return m;
  }, [data]);

  // Validação do descanso. Percorre uma janela que começa 10 dias ANTES do mês e
  // termina 10 dias DEPOIS, para pegar a sequência que atravessa a virada — quem
  // trabalha 27 a 30/09 e 1º a 4/10 emendou 8 dias, e olhando só um mês cada
  // metade parece inofensiva.
  type Validacao = { maiorSequencia: number; folgas: number; previstas: number; semanas: number; maxSeguidos: number; excede: boolean; compensacoes: number; diferenca: number; domingosSeguidos: number; piorDomingos: number; limiteDomingos: number; excedeDomingo: boolean; sexoIgnorado: boolean };
  function validacao(emp: ScheduleEmployee): Validacao {
    const regra = REGRA_REGIME[emp.scheduleRegime] ?? REGRA_PADRAO;
    if (!data) return { maiorSequencia: 0, folgas: 0, previstas: 0, semanas: 0, maxSeguidos: regra.maxSeguidos, excede: false, compensacoes: 0, diferenca: 0, domingosSeguidos: 0, piorDomingos: 0, limiteDomingos: 1, excedeDomingo: false, sexoIgnorado: false };

    const inicio = new Date(Date.UTC(year, month - 1, 1 - 10));
    const fim = new Date(Date.UTC(year, month - 1, data.daysInMonth + 10));
    let seq = 0;
    let maior = 0;
    let sequenciaTocaOMes = false;
    let inicioSeqNoMes = false;

    for (let t = inicio.getTime(); t <= fim.getTime(); t += 86400000) {
      const dia = new Date(t);
      const noMes = dia.getUTCFullYear() === year && dia.getUTCMonth() === month - 1;
      const iso = dia.toISOString().slice(0, 10);
      // Dia de mês vizinho sem escala montada: não dá para afirmar que foi
      // trabalhado. Corta a sequência em vez de chutar.
      if (!noMes && !mesesVizinhosComEscala.has(`${emp.id}|${iso.slice(0, 7)}`)) {
        if (sequenciaTocaOMes) maior = Math.max(maior, seq);
        seq = 0;
        sequenciaTocaOMes = false;
        continue;
      }
      const dentroDoVinculo = withinEmployment(emp, dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate());
      const marca = noMes
        ? marks.get(keyOf(emp.id, dia.getUTCDate()))
        : borderByKey.get(`${emp.id}|${iso}`);
      const descansa = !dentroDoVinculo
        || (noMes && isFerias(emp.id, dia.getUTCDate()))
        || (!!marca && marca !== "TURNO");

      if (descansa) {
        if (sequenciaTocaOMes) maior = Math.max(maior, seq);
        seq = 0;
        sequenciaTocaOMes = false;
        inicioSeqNoMes = false;
        continue;
      }
      seq += 1;
      if (noMes) sequenciaTocaOMes = true;
      if (seq === 1 && noMes) inicioSeqNoMes = true;
    }
    if (sequenciaTocaOMes) maior = Math.max(maior, seq);
    void inicioSeqNoMes;

    // Folgas previstas = semanas do mês × folgas por semana. Só as semanas
    // dentro do vínculo contam: quem entrou dia 20 não deve as 4 do mês cheio.
    const semanas = semanasDoMes(year, month, (d) => withinEmployment(emp, year, month, d));
    const previstas = semanas * regra.folgasPorSemana;

    // O DSR conta SÓ a folga comum (F). FF e FBH são COMPENSAÇÃO — de feriado
    // trabalhado e de banco de horas — e não substituem o descanso da semana.
    //
    // Misturar os três inflava a conta e produzia alarme falso ao contrário:
    // quem trabalhou num feriado e tirou a folga compensatória no mesmo mês
    // aparecia com "+1 folga a mais", quando na verdade estava exatamente certo
    // — a semana do feriado precisa MESMO ter duas folgas (o DSR + a
    // compensação), ou o feriado vira pagamento em dobro.
    const noVinculo = (d: number) => withinEmployment(emp, year, month, d);
    const folgas = data.days.filter((d) => noVinculo(d.day) && marks.get(keyOf(emp.id, d.day)) === "FOLGA").length;
    const compensacoes = data.days.filter((d) => {
      const m = marks.get(keyOf(emp.id, d.day));
      return noVinculo(d.day) && (m === "FOLGA_FERIADO" || m === "FOLGA_BANCO_HORAS");
    }).length;

    // ── Folga em domingo ──
    // Percorre os domingos do histórico + os do mês exibido e conta quantos
    // seguem TRABALHADOS. "SEM_ESCALA" zera a contagem em vez de somar: mês que
    // ninguém montou não é prova de que a pessoa trabalhou.
    const limiteDom = limiteDomingos(emp.gender, regraDomingo);
    const domingos: Array<"FOLGA" | "TRABALHOU" | "SEM_ESCALA"> = [];
    for (const h of data.sundayHistory) {
      if (h.employeeId === emp.id) domingos.push(h.status);
    }
    for (const d of data.days) {
      if (d.dow !== 0) continue;
      if (!withinEmployment(emp, year, month, d.day)) { domingos.push("SEM_ESCALA"); continue; }
      domingos.push(isFolga(emp.id, d.day) || isFerias(emp.id, d.day) ? "FOLGA" : "TRABALHOU");
    }
    let domSeguidos = 0;
    let piorDom = 0;
    for (const st of domingos) {
      if (st === "TRABALHOU") { domSeguidos += 1; piorDom = Math.max(piorDom, domSeguidos); }
      else domSeguidos = 0;
    }

    return {
      maiorSequencia: maior,
      folgas,
      previstas,
      semanas,
      maxSeguidos: regra.maxSeguidos,
      excede: maior > regra.maxSeguidos,
      compensacoes,
      diferenca: folgas - previstas,
      domingosSeguidos: domSeguidos,
      piorDomingos: piorDom,
      limiteDomingos: limiteDom,
      excedeDomingo: piorDom > limiteDom,
      sexoIgnorado: emp.gender === "NAO_INFORMADO",
    };
  }

  // Total de dias trabalhados no mês (dias do vínculo que não são folga nem férias).
  // Gerencial — só na tela, nunca na impressão.
  function workedDays(emp: ScheduleEmployee): number {
    if (!data) return 0;
    return data.days.filter((d) => withinEmployment(emp, year, month, d.day) && !isFolga(emp.id, d.day) && !isAusencia(emp.id, d.day) && !isFerias(emp.id, d.day)).length;
  }

  // Problemas de descanso, recalculados a cada clique. A validação é ao vivo:
  // avisa enquanto a escala é montada, não só depois de salvar.
  const problemas = useMemo(() => {
    if (!data) return [] as Array<{ emp: ScheduleEmployee; v: ReturnType<typeof validacao> }>;
    return data.employees
      .map((emp) => ({ emp, v: validacao(emp) }))
      .filter((x) => x.v.excede || x.v.diferenca !== 0 || x.v.excedeDomingo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, marks, feriasSet, borderByKey, year, month]);

  // Impressão para o mural: HTML autocontido, sem qualquer info de gratuidade
  // (domingo/feriado aparecem só como destaque neutro). Impresso via iframe.
  function handlePrint() {
    if (!data) return;
    const dayHead = data.days.map((d) => {
      const ev = dateEvents.get(d.day);
      const cls = ev ? `ev-${ev.toLowerCase()}` : d.isHoliday ? "hol" : d.isSunday ? "sun" : "";
      return `<th class="${cls}">${d.day}<br><span>${PRINT_DOW[d.dow]}</span></th>`;
    }).join("");
    const holidayList = data.days.filter((d) => d.isHoliday && d.holidayName).map((d) => `${d.day} — ${escapeHtml(d.holidayName)}`).join(" · ");
    const rows = sectorGroups.map((g) => {
      const sec = `<tr class="sector"><td colspan="${data.days.length + 1}">${escapeHtml(g.sector)}</td></tr>`;
      const subsHtml = g.subs.map((sub) => {
        const subHead = sub.subgroup ? `<tr class="subsector"><td colspan="${data.days.length + 1}">${escapeHtml(sub.subgroup)}</td></tr>` : "";
        const emps = sub.employees.map((emp) => {
          const cells = data.days.map((d) => {
            const within = withinEmployment(emp, year, month, d.day);
            const isFeriasDay = isFerias(emp.id, d.day);
            const mark = marks.get(keyOf(emp.id, d.day));
            // O catálogo diz quem vai para o mural. FALTA e ATESTADO têm
            // noMural=false: a escala impressa fica na parede, à vista de todo
            // mundo — expor quem faltou ou quem teve atestado médico ali é
            // constranger a pessoa na frente da equipe (e, no caso do atestado,
            // expor informação de saúde). As duas continuam na tela e no cálculo
            // do VT; só não são publicadas.
            const mk = isFeriasDay ? undefined : MARCA_POR_TIPO.get(mark as MarcaCelula);
            const mkPrint = mk && mk.noMural ? mk : undefined;
            const evd = dateEvents.get(d.day);
            const cls = !within ? "out" : isFeriasDay ? "ferias" : mkPrint ? `m-${mkPrint.tipo.toLowerCase()}` : evd ? `evd-${evd.toLowerCase()}` : d.isHoliday ? "hol" : d.isSunday ? "sun" : "";
            const label = within ? (isFeriasDay ? "Fér" : mkPrint ? mkPrint.letra : "") : "";
            return `<td class="${cls}">${label}</td>`;
          }).join("");
          return `<tr><td class="name"><b>${escapeHtml(fullName(emp))}</b></td>${cells}</tr>`;
        }).join("");
        return subHead + emps;
      }).join("");
      return sec + subsHtml;
    }).join("");
    // Mural precisa ser legível de longe: usa a maior fonte que ainda cabe em UMA
    // página paisagem. Quanto mais linhas (setores + praças + funcionários), menor.
    const printRows = sectorGroups.reduce(
      (n, g) => n + 1 + g.subs.reduce((m, s) => m + (s.subgroup ? 1 : 0) + s.employees.length, 0),
      0
    );
    // Limites calibrados medindo o layout real. Linhas de setor/praça são
    // compactas (só rótulo), então sobra altura para as linhas de funcionário.
    const S = printRows <= 16
      ? { cell: 18, pad: 9, name: 17, dow: 12, sector: 14, sub: 12, title: 26, legend: 14, box: 16, nameW: 130 }
      : printRows <= 24
        ? { cell: 16, pad: 5, name: 15, dow: 11, sector: 13, sub: 11, title: 23, legend: 13, box: 15, nameW: 122 }
        : printRows <= 32
          ? { cell: 14, pad: 2, name: 13, dow: 10, sector: 11, sub: 10, title: 19, legend: 11, box: 12, nameW: 110 }
          : { cell: 12, pad: 1, name: 12, dow: 9, sector: 10, sub: 9, title: 18, legend: 11, box: 12, nameW: 104 };

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>Escala ${MONTHS[month - 1]} ${year}</title>
<style>
:root{color-scheme:light}
*{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:landscape;margin:6mm}
h1{font-size:${S.title}px;margin:0 0 2px}.sub{font-size:${S.legend}px;color:#444;margin:0 0 6px}
table{border-collapse:collapse;width:100%}
tr{page-break-inside:avoid}
th,td{border:1px solid #777;text-align:center;font-size:${S.cell}px;padding:${S.pad}px 1px;font-weight:bold}
td.name,th.name{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:${S.pad}px 6px;width:${S.nameW}px;max-width:${S.nameW}px;font-size:${S.name}px}
th span{font-size:${S.dow}px;color:#555;font-weight:normal}
tr.sector td{background:#e2e2e2;text-align:left;font-weight:bold;text-transform:uppercase;font-size:${S.sector}px;letter-spacing:.04em;padding:2px 6px}
tr.subsector td{background:#f1f1f1;text-align:left;font-weight:600;font-size:${S.sub}px;padding:1px 6px 1px 20px;color:#444}
${MARCAS.filter((m) => m.noMural).map((m) => `td.m-${m.tipo.toLowerCase()}{background:${m.cor};color:#fff}`).join('\n')}
td.ferias{background:${COLORS.ferias};color:#fff;font-size:${Math.round(S.cell * 0.72)}px}
td.sun,th.sun{background:${COLORS.domingo}}td.hol,th.hol{background:${COLORS.feriado}}
th.ev-pequeno,td.evd-pequeno{background:${COLORS.eventoPequeno}}
th.ev-medio,td.evd-medio{background:${COLORS.eventoMedio}}
th.ev-grande,td.evd-grande{background:${COLORS.eventoGrande}}
th.ev-pequeno span,th.ev-medio span,th.ev-grande span{color:#333}
td.out{background:repeating-linear-gradient(45deg,#fff,#fff 3px,#e6e6e6 3px,#e6e6e6 6px)}
.legend{margin-top:8px;font-size:${S.legend}px;font-weight:600}.legend span{margin-right:18px;display:inline-block;margin-bottom:3px}
.box{display:inline-block;width:${S.box}px;height:${S.box}px;border:1px solid #777;vertical-align:-3px;margin-right:5px;text-align:center;line-height:${S.box - 2}px;font-size:${Math.round(S.box * 0.66)}px;font-weight:bold}
.foot{margin-top:6px;font-size:${S.legend - 1}px;color:#444}
</style></head><body>
<h1>Escala de trabalho — ${MONTHS[month - 1]} ${year}</h1>
<div class="sub">Pateo da Luz</div>
<table><thead><tr><th class="name">Funcionário</th>${dayHead}</tr></thead><tbody>${rows}</tbody></table>
<div class="legend">${MARCAS.filter((m) => m.noMural).map((m) => `<span><span class="box" style="background:${m.cor};color:#fff">${m.letra}</span>${m.nome}</span>`).join("")}<span><span class="box" style="background:${COLORS.ferias}"></span>Férias</span><span><span class="box" style="background:${COLORS.domingo}"></span>Domingo</span><span><span class="box" style="background:${COLORS.feriado}"></span>Feriado</span><span><span class="box" style="background:${COLORS.eventoPequeno}"></span>Evento pequeno</span><span><span class="box" style="background:${COLORS.eventoMedio}"></span>Evento médio</span><span><span class="box" style="background:${COLORS.eventoGrande}"></span>Evento grande</span></div>
${holidayList ? `<div class="foot"><b>Feriados de ${MONTHS[month - 1]}:</b> ${holidayList}</div>` : ""}
</body></html>`;
    const iframe = document.createElement("iframe");
    // Tem que ter o tamanho da ÁREA IMPRIMÍVEL (A4 paisagem menos as margens do
    // @page). Com 0x0 o layout mede errado e o auto-ajuste abaixo não funciona.
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:285mm;height:198mm;border:0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open(); doc.write(html); doc.close();
    iframe.contentWindow?.focus();
    setTimeout(() => {
      // Rede de segurança: se mesmo no menor tamanho passar da página, encolhe
      // proporcionalmente para caber em UMA folha (mural é sempre 1 página).
      const avail = iframe.clientHeight;
      const kids = Array.from(doc.body.children) as HTMLElement[];
      const content = kids.length ? Math.max(...kids.map((el) => el.getBoundingClientRect().bottom)) : 0;
      if (content > avail && avail > 0) {
        doc.body.style.setProperty("zoom", String(Math.max(0.45, (avail / content) * 0.99)));
      }
      iframe.contentWindow?.print();
      setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1500);
    }, 350);
  }

  // Em tela cheia a coluna de nome encolhe: sem o menu lateral, o que importa é
  // caber o mês inteiro sem rolar pro lado (os nomes exibidos são curtos).
  const NAME_COL = fullscreen ? 130 : 172;
  const TRAB_COL = fullscreen ? 44 : 52;
  const CELL = 34;

  const stickyNameStyle: CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
    minWidth: NAME_COL, maxWidth: NAME_COL, borderRight: "1px solid var(--border-strong, var(--border))",
    padding: showDetails ? "6px 10px" : "2px 10px", textAlign: "left"
  };
  const swatch: CSSProperties = {
    display: "inline-block", width: 12, height: 12, borderRadius: 3,
    verticalAlign: "-2px", marginRight: 5
  };
  const compBtn: CSSProperties = {
    width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--border-strong, var(--border))", borderRadius: 4, background: "var(--surface-2)",
    cursor: "pointer", padding: 0, color: "var(--ink, inherit)"
  };

  function headStyle(m: { isSunday: boolean; isHoliday: boolean }, event?: EventSize): CSSProperties {
    const eventBg = event ? EVENT_COLOR[event] : null;
    const bg = eventBg ?? (m.isHoliday ? COLORS.feriado : m.isSunday ? COLORS.domingo : "var(--surface)");
    return {
      position: "sticky", top: 0, zIndex: 4,
      minWidth: CELL, width: CELL, textAlign: "center", padding: "4px 0", fontSize: 11,
      background: bg,
      color: eventBg || m.isSunday || m.isHoliday ? "#1f2937" : "var(--muted)",
      boxShadow: "inset 0 -1px 0 var(--border)",
      cursor: canEdit ? "pointer" : "default"
    };
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section
        className="panel"
        style={fullscreen ? {
          position: "fixed", inset: 0, zIndex: 60, margin: 0, borderRadius: 0,
          maxWidth: "none", overflow: "auto", background: "var(--surface)", padding: 16
        } : undefined}
      >
        <div className="section-heading" style={fullscreen ? { marginBottom: 8 } : undefined}>
          <div>
            {!fullscreen && <PanelEyebrow>Pessoal</PanelEyebrow>}
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, ...(fullscreen ? { fontSize: 15, margin: 0 } : null) }}>
              <CalendarDays size={fullscreen ? 15 : 18} /> Escala mensal
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", whiteSpace: "nowrap" }}>
            <Button variant="secondary" onClick={() => goMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            <strong style={{ minWidth: 118, textAlign: "center" }}>{MONTHS[month - 1]} {year}</strong>
            <Button variant="secondary" onClick={() => goMonth(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
            <Button
              variant="secondary"
              onClick={() => setShowDetails((v) => !v)}
              aria-label={showDetails ? "Ocultar detalhes sob o nome" : "Mostrar detalhes sob o nome"}
              title={showDetails ? "Ocultar turno e folga-feriado (linhas mais baixas)" : "Mostrar turno e folga-feriado sob o nome"}
            >
              {showDetails ? <EyeOff size={15} /> : <Eye size={15} />}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowLegend((v) => !v)}
              aria-label={showLegend ? "Ocultar legenda" : "Mostrar legenda"}
              title={showLegend ? "Ocultar a legenda de cores" : "Mostrar a legenda de cores"}
            >
              <Palette size={15} />
            </Button>
            <Button variant="secondary" onClick={handleReload} aria-label="Recarregar"><RefreshCw size={15} /></Button>
            <Button variant="secondary" leadingIcon={<Printer size={14} />} onClick={handlePrint}>Imprimir</Button>
            <Button
              variant="secondary"
              leadingIcon={fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onClick={() => setFullscreenMode(!fullscreen)}
              title={fullscreen ? "Sair da tela cheia (Esc)" : "Montar a escala em tela cheia"}
            >
              {fullscreen ? "Sair" : "Tela cheia"}
            </Button>
            {canEdit && <Button leadingIcon={<Save size={14} />} onClick={handleSave} disabled={!dirty || saving}>{saving ? "Salvando..." : "Salvar escala"}</Button>}
          </div>
        </div>

        {data && (
          <div style={{ margin: "0 0 10px" }}>
            <Alert tone={problemas.length > 0 ? "warning" : "info"}>
              <strong>
                {MONTHS[month - 1]} tem {semanasDoMes(year, month)} semanas — prevê {semanasDoMes(year, month)} folga(s) por pessoa no 6×1
                {data.employees.some((e) => e.scheduleRegime === "CINCO_POR_DOIS") && ` e ${semanasDoMes(year, month) * 2} no 5×2`}.
              </strong>
              {problemas.length === 0 ? (
                <div style={{ marginTop: 3, fontSize: "0.92em" }}>Todo mundo bate com o previsto.</div>
              ) : (
                <>
                  <div style={{ marginTop: 4, fontSize: "0.92em", display: "grid", gap: 2 }}>
                    {problemas.map(({ emp, v }) => (
                      <div key={emp.id}>
                        <strong>{fullName(emp)}</strong>
                        {v.diferenca !== 0 && ` — ${v.folgas} folga(s), previsto ${v.previstas} (${v.diferenca > 0 ? "+" : ""}${v.diferenca})`}
                        {v.compensacoes > 0 && ` [+${v.compensacoes} compensação(ões) FF/FBH, fora da conta do DSR]`}
                        {v.diferenca !== 0 && v.excede && " ·"}
                        {v.excede && ` ${v.maiorSequencia} dias seguidos (referência: ${v.maxSeguidos})`}
                        {v.excedeDomingo && (v.diferenca !== 0 || v.excede) && " ·"}
                        {v.excedeDomingo && ` ${v.piorDomingos} domingos seguidos sem folgar (limite ${v.limiteDomingos}${v.sexoIgnorado ? ", sexo não cadastrado" : ""})`}
                      </div>
                    ))}
                  </div>
                  {/* O Pateo não segue o 6×1 à risca — cobertura, troca e evento
                      mudam a escala de propósito. Por isso a tela informa a
                      diferença e não impede nada. */}
                  <div style={{ marginTop: 5, fontSize: "0.85em", opacity: 0.85 }}>
                    É só conferência — nada aqui impede salvar a escala.
                  </div>
                </>
              )}
            </Alert>
          </div>
        )}

        {canEdit && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "0 0 10px" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 2 }}>Marcar com:</span>
            {MARCAS.map((m) => {
              const ativo = pincel === m.tipo;
              return (
                <button
                  key={m.tipo}
                  type="button"
                  title={m.ajuda}
                  onClick={() => setPincel(ativo ? null : m.tipo)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                    padding: "4px 10px", borderRadius: 999, font: "inherit", fontSize: 12,
                    fontWeight: ativo ? 700 : 500,
                    border: `1px solid ${ativo ? m.cor : "var(--border)"}`,
                    background: ativo ? m.cor : "transparent",
                    color: ativo ? "#fff" : "var(--text, inherit)",
                  }}
                >
                  <span style={{
                    display: "inline-grid", placeItems: "center", width: 20, height: 16, borderRadius: 3,
                    background: ativo ? "rgba(255,255,255,0.25)" : m.cor, color: "#fff", fontSize: 10, fontWeight: 700,
                  }}>{m.letra}</span>
                  {m.nome}
                </button>
              );
            })}
            {/* Sem pincel o clique volta a ciclar F → T → vazio, que é o gesto
                de sempre e resolve a maior parte do mês. */}
            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
              {pincel
                ? "clique nas células para aplicar · clicar de novo limpa"
                : "nenhum selecionado — o clique cicla — → F → T → —"}
            </span>
          </div>
        )}

        {showLegend && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--muted)", margin: "0 0 10px", alignItems: "center" }}>
            {MARCAS.map((m) => (
              <span key={m.tipo}>
                <span style={{ ...swatch, background: m.cor }} />
                {m.nome} ({m.letra}){m.noMural ? "" : " — não sai no mural"}
              </span>
            ))}
            <span><span style={{ ...swatch, background: COLORS.ferias }} />Férias</span>
            <span><span style={{ ...swatch, background: COLORS.domingo }} />Domingo</span>
            <span><span style={{ ...swatch, background: COLORS.feriado }} />Feriado</span>
            <span style={{ width: "100%", height: 0 }} />
            <strong style={{ fontSize: 11, color: "var(--ink, inherit)" }}>Eventos (na data):</strong>
            {(["PEQUENO", "MEDIO", "GRANDE"] as EventSize[]).map((sz) => (
              <span key={sz}>
                <span style={{ ...swatch, background: EVENT_COLOR[sz] }} />
                {EVENT_LABEL[sz]}
              </span>
            ))}
            {canEdit && <span style={{ fontSize: 11, opacity: 0.85 }}>Célula do funcionário: clique cicla — → F → T → X → AT → —. Cabeçalho da data: clique cicla o evento — → Pequeno → Médio → Grande → —</span>}
          </div>
        )}

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando escala..." />}
        {!loading && data && data.employees.length === 0 && (
          <EmptyState
            title="Nenhum funcionário na escala"
            description="Só entram aqui funcionários ativos com 'Entra na escala' ligado no cadastro. Verifique em Funcionários."
          />
        )}

        {!loading && data && data.employees.length > 0 && (
          <div style={{
            overflow: "auto",
            // Em tela cheia o topo da grade muda conforme a legenda esteja
            // aberta ou recolhida — reservar fixo desperdiçaria ~100px.
            maxHeight: fullscreen ? `calc(100vh - ${showLegend ? 185 : 105}px)` : "70vh",
            border: "1px solid var(--border)", borderRadius: 10
          }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...stickyNameStyle, top: 0, zIndex: 6, boxShadow: "inset 0 -1px 0 var(--border)", fontSize: 11, color: "var(--muted)" }}>Funcionário</th>
                  <th style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--surface)", minWidth: TRAB_COL, maxWidth: TRAB_COL, textAlign: "center", padding: "4px 2px", fontSize: 10, fontWeight: 500, color: "var(--muted)", boxShadow: "inset 0 -1px 0 var(--border)", borderLeft: "1px solid var(--border)" }} title="Total de dias trabalhados no mês (só na tela)">Trab.</th>
                  {data.days.map((d) => {
                    const ev = dateEvents.get(d.day);
                    const evTitle = ev ? `${EVENT_LABEL[ev]}${canEdit ? " — clique para trocar" : ""}` : (canEdit ? "Clique para marcar evento" : undefined);
                    return (
                      <th key={d.day} style={headStyle(d, ev)} title={evTitle ?? d.holidayName ?? undefined} onClick={canEdit ? () => toggleDateEvent(d.day) : undefined}>
                        <div style={{ fontWeight: 500, color: ev ? "#1f2937" : "var(--ink, inherit)" }}>{d.day}</div>
                        <div>{DOW_LETTERS[d.dow]}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sectorGroups.map((group) => (
                  <Fragment key={group.sector}>
                    <tr>
                      <td colSpan={data.days.length + 2} style={{ background: "var(--paper-soft, var(--surface-2))", padding: showDetails ? "5px 10px" : "2px 10px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", position: "sticky", left: 0 }}>
                        {group.sector}
                      </td>
                    </tr>
                    {group.subs.map((sub) => (
                      <Fragment key={group.sector + "|" + (sub.subgroup ?? "_")}>
                        {sub.subgroup && (
                          <tr>
                            <td colSpan={data.days.length + 2} style={{ padding: showDetails ? "3px 10px 3px 22px" : "1px 10px 1px 22px", fontSize: 10.5, fontWeight: 600, color: "var(--muted)", position: "sticky", left: 0, background: "var(--surface)" }}>
                              {sub.subgroup}
                            </td>
                          </tr>
                        )}
                    {sub.employees.map((emp) => (
                      <tr key={emp.id}>
                        <td style={stickyNameStyle}>
                          {(() => {
                            const turno = `${REGIME_SHORT[emp.scheduleRegime] ?? ""}${emp.shiftStart ? ` · ${emp.shiftStart}${emp.shiftEnd ? `–${emp.shiftEnd}` : ""}` : ""}`;
                            // Recolhido: a info vai para o tooltip do nome, para continuar
                            // acessível sem custar altura de linha.
                            const nomeTitle = showDetails
                              ? fullName(emp)
                              : `${fullName(emp)}${turno ? ` — ${turno}` : ""} — Folga feriado: ${comp.get(emp.id) ?? 0}${holidaysWorked(emp) > 0 ? ` · ${holidaysWorked(emp)} feriado(s) trabalhado(s)` : ""}`;
                            return (
                              <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: NAME_COL - 20 }} title={nomeTitle}>{fullName(emp)}</div>
                            );
                          })()}
                          {showDetails && (
                            <>
                              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                                {REGIME_SHORT[emp.scheduleRegime] ?? ""}{emp.shiftStart ? ` · ${emp.shiftStart}${emp.shiftEnd ? `–${emp.shiftEnd}` : ""}` : ""}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 10.5, color: "var(--muted)" }} title="Folgas a mais por feriado trabalhado">
                                <span>Folga feriado:</span>
                                {canEdit && <button type="button" aria-label="Menos uma folga" onClick={() => handleComp(emp.id, -1)} style={compBtn}><Minus size={11} /></button>}
                                {/* Saldo negativo = tirou folga de feriado sem ter
                                    crédito. Não bloqueia (pode ser adiantamento
                                    combinado), mas precisa saltar aos olhos. */}
                                <strong
                                  title={(comp.get(emp.id) ?? 0) < 0 ? "Folga de feriado tirada sem saldo — confira" : undefined}
                                  style={{
                                    color: (comp.get(emp.id) ?? 0) < 0 ? "var(--danger, #b00)" : "var(--ink, inherit)",
                                    minWidth: 10, textAlign: "center",
                                  }}
                                >{comp.get(emp.id) ?? 0}</strong>
                                {canEdit && <button type="button" aria-label="Mais uma folga" onClick={() => handleComp(emp.id, 1)} style={compBtn}><Plus size={11} /></button>}
                                {holidaysWorked(emp) > 0 && <span style={{ color: "#9a6410" }} title="Feriados trabalhados neste mês">· {holidaysWorked(emp)} trab.</span>}
                              </div>
                            </>
                          )}
                        </td>
                        {(() => {
                          // A coluna de dias trabalhados vira o sinal de alerta:
                          // é a que já se olha ao montar a escala, então o
                          // problema aparece na linha da pessoa, não só no topo.
                          const v = validacao(emp);
                          const ruim = v.excede || v.diferenca !== 0 || v.excedeDomingo;
                          const aviso = [
                            v.diferenca !== 0 ? `${v.folgas} folga(s), previsto ${v.previstas} para ${v.semanas} semana(s)` : null,
                            v.excede ? `${v.maiorSequencia} dias seguidos (referência: ${v.maxSeguidos})` : null,
                            v.excedeDomingo ? `${v.piorDomingos} domingos seguidos sem folgar (limite ${v.limiteDomingos})` : null,
                          ].filter(Boolean).join(" · ");
                          return (
                            <td
                              style={{
                                minWidth: TRAB_COL, maxWidth: TRAB_COL, textAlign: "center", fontWeight: 600,
                                borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
                                // Âmbar, não vermelho: é conferência, não erro.
                                color: ruim ? "#b45309" : undefined,
                              }}
                              title={ruim ? aviso : "Dias trabalhados no mês"}
                            >
                              {workedDays(emp)}
                              {ruim && <span style={{ marginLeft: 3 }} aria-label="confira o descanso">⚠</span>}
                            </td>
                          );
                        })()}
                        {data.days.map((d) => {
                          const within = withinEmployment(emp, year, month, d.day);
                          const isFeriasDay = isFerias(emp.id, d.day);
                          const mark = marks.get(keyOf(emp.id, d.day));
                          const marca = isFeriasDay ? undefined : MARCA_POR_TIPO.get(mark as MarcaCelula);
                          const dayEvent = dateEvents.get(d.day);
                          const bg = !within
                            ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(128,128,128,0.12) 3px, rgba(128,128,128,0.12) 6px)"
                            : isFeriasDay
                              ? COLORS.ferias
                              : marca
                                ? marca.cor
                                : dayEvent
                                  ? EVENT_COLOR[dayEvent]
                                  : d.isHoliday
                                    ? COLORS.feriado
                                    : d.isSunday
                                      ? COLORS.domingo
                                      : "transparent";
                          const clickable = within && !isFeriasDay;
                          const title = !within
                            ? "Fora do vínculo"
                            : isFeriasDay
                              ? "Férias (gerenciado na Folha)"
                              : marca
                                ? marca.ajuda
                                : dayEvent
                                  ? EVENT_LABEL[dayEvent]
                                  : d.holidayName ?? (d.isSunday ? "Domingo" : undefined);
                          return (
                            <td
                              key={d.day}
                              onClick={clickable ? () => toggle(emp.id, d.day) : undefined}
                              title={title}
                              style={{
                                minWidth: CELL, width: CELL, height: showDetails ? 34 : 26, textAlign: "center",
                                borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
                                background: bg, cursor: clickable && canEdit ? "pointer" : "default",
                                color: "#fff", fontWeight: 600, userSelect: "none",
                                fontSize: isFeriasDay ? 9 : marca ? [undefined, undefined, 9, 8][marca.letra.length] : undefined
                              }}
                            >
                              {within ? (isFeriasDay ? "Fér" : marca ? marca.letra : "") : ""}
                            </td>
                          );
                        })}
                      </tr>
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dirty && (
          <div style={{
            position: "sticky", bottom: 8, marginTop: 12, zIndex: 4,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "10px 14px", borderRadius: 10,
            background: "var(--gold-tint, #fdf1d6)", border: "1px solid var(--gold-dark, #9a6410)",
            color: "var(--gold-dark, #9a6410)", fontSize: 13, fontWeight: 600, boxShadow: "var(--shadow-soft, 0 2px 8px rgba(0,0,0,0.08))"
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>⚠ Você tem alterações não salvas na escala.</span>
            {canEdit && <Button leadingIcon={<Save size={14} />} onClick={handleSave} disabled={saving} style={{ marginLeft: "auto" }}>{saving ? "Salvando..." : "Salvar agora"}</Button>}
          </div>
        )}
      </section>
    </div>
  );
}
