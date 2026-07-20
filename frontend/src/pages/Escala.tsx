import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus, Printer, RefreshCw, Save } from "lucide-react";
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
  turno: "#ea580c",     // laranja vibrante (distinto da folga)
  eventoPequeno: "#0d9488", // teal vibrante (Evento pequeno)
  eventoMedio: "#7c3aed",   // violeta vibrante (Evento médio)
  eventoGrande: "#db2777",  // fúcsia/rosa vibrante (Evento grande)
  ferias: "#2563eb",    // azul
  domingo: "#ff8a8a",   // vermelho/rosa
  feriado: "#8fd14f",   // verde
};

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
  "Cozinha": ["Quente", "Fria"],
  "Salão": ["Buffet", "Bar", "Atendente"],
  "Pia": ["Manhã", "Tarde"],
};

const UNSAVED_CONFIRM = "Você tem alterações não salvas na escala. Sair sem salvar vai descartá-las. Deseja continuar?";

function keyOf(employeeId: string, day: number) {
  return `${employeeId}|${day}`;
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

  // Ciclo da célula do funcionário: vazio → F (folga) → T (turno/cobertura) → vazio.
  function toggle(employeeId: string, day: number) {
    if (!canEdit) return;
    setMarks((prev) => {
      const next = new Map(prev);
      const k = keyOf(employeeId, day);
      const cur = next.get(k);
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
      setNotice({ tone: "success", message: `Escala salva — ${res.count} folga(s) e ${res.events} evento(s) em ${MONTHS[month - 1]}.` });
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

  // Só FOLGA reduz dia trabalhado. TURNO (cobertura) é dia trabalhado — igual o backend,
  // que no cálculo do VT só subtrai type "FOLGA".
  function isFolga(employeeId: string, day: number): boolean {
    return marks.get(keyOf(employeeId, day)) === "FOLGA";
  }

  function holidaysWorked(emp: ScheduleEmployee): number {
    if (!data) return 0;
    return data.days.filter((d) => d.isHoliday && withinEmployment(emp, year, month, d.day) && !isFolga(emp.id, d.day) && !isFerias(emp.id, d.day)).length;
  }

  // Total de dias trabalhados no mês (dias do vínculo que não são folga nem férias).
  // Gerencial — só na tela, nunca na impressão.
  function workedDays(emp: ScheduleEmployee): number {
    if (!data) return 0;
    return data.days.filter((d) => withinEmployment(emp, year, month, d.day) && !isFolga(emp.id, d.day) && !isFerias(emp.id, d.day)).length;
  }

  // Impressão para o mural: HTML autocontido, sem qualquer info de gratuidade
  // (domingo/feriado aparecem só como destaque neutro). Impresso via iframe.
  function handlePrint() {
    if (!data) return;
    const dayHead = data.days.map((d) => {
      const ev = dateEvents.get(d.day);
      const cls = ev ? `ev-${ev.toLowerCase()}` : d.isHoliday ? "hol" : d.isSunday ? "sun" : "";
      return `<th class="${cls}">${d.day}<br><span>${PRINT_DOW[d.dow]}</span></th>`;
    }).join("");
    const holidayList = data.days.filter((d) => d.isHoliday && d.holidayName).map((d) => `${d.day} — ${d.holidayName}`).join(" · ");
    const rows = sectorGroups.map((g) => {
      const sec = `<tr class="sector"><td colspan="${data.days.length + 1}">${g.sector}</td></tr>`;
      const subsHtml = g.subs.map((sub) => {
        const subHead = sub.subgroup ? `<tr class="subsector"><td colspan="${data.days.length + 1}">${sub.subgroup}</td></tr>` : "";
        const emps = sub.employees.map((emp) => {
          const cells = data.days.map((d) => {
            const within = withinEmployment(emp, year, month, d.day);
            const isFeriasDay = isFerias(emp.id, d.day);
            const mark = marks.get(keyOf(emp.id, d.day));
            const isFolgaDay = !isFeriasDay && mark === "FOLGA";
            const isTurnoDay = !isFeriasDay && mark === "TURNO";
            const cls = !within ? "out" : isFeriasDay ? "ferias" : isFolgaDay ? "folga" : isTurnoDay ? "turno" : d.isHoliday ? "hol" : d.isSunday ? "sun" : "";
            const label = within ? (isFeriasDay ? "Fér" : isFolgaDay ? "F" : isTurnoDay ? "T" : "") : "";
            return `<td class="${cls}">${label}</td>`;
          }).join("");
          return `<tr><td class="name"><b>${fullName(emp)}</b></td>${cells}</tr>`;
        }).join("");
        return subHead + emps;
      }).join("");
      return sec + subsHtml;
    }).join("");
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>Escala ${MONTHS[month - 1]} ${year}</title>
<style>
:root{color-scheme:light}
*{font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:landscape;margin:9mm}
h1{font-size:17px;margin:0 0 2px}.sub{font-size:11px;color:#555;margin:0 0 8px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #999;text-align:center;font-size:10px;padding:2px 1px}
td.name,th.name{text-align:left;white-space:nowrap;padding:3px 6px;min-width:150px}
th span{font-size:8px;color:#666;font-weight:normal}
tr.sector td{background:#eee;text-align:left;font-weight:bold;text-transform:uppercase;font-size:10px}
tr.subsector td{background:#f6f6f6;text-align:left;font-weight:600;font-size:9px;padding-left:18px;color:#555}
td.folga{background:${COLORS.folga};color:#fff;font-weight:bold}
td.turno{background:${COLORS.turno};color:#fff;font-weight:bold}
td.ferias{background:${COLORS.ferias};color:#fff;font-weight:bold;font-size:8px}
td.sun,th.sun{background:${COLORS.domingo}}td.hol,th.hol{background:${COLORS.feriado}}
th.ev-pequeno{background:${COLORS.eventoPequeno};color:#fff}th.ev-medio{background:${COLORS.eventoMedio};color:#fff}th.ev-grande{background:${COLORS.eventoGrande};color:#fff}
th.ev-pequeno span,th.ev-medio span,th.ev-grande span{color:#eee}
td.out{background:repeating-linear-gradient(45deg,#fff,#fff 3px,#eee 3px,#eee 6px)}
.legend{margin-top:10px;font-size:11px}.legend span{margin-right:16px;display:inline-block;margin-bottom:3px}
.box{display:inline-block;width:12px;height:12px;border:1px solid #999;vertical-align:-2px;margin-right:4px;text-align:center;line-height:11px;font-size:8px;font-weight:bold}
.foot{margin-top:7px;font-size:10px;color:#555}
</style></head><body>
<h1>Escala de trabalho — ${MONTHS[month - 1]} ${year}</h1>
<div class="sub">Pateo da Luz</div>
<table><thead><tr><th class="name">Funcionário</th>${dayHead}</tr></thead><tbody>${rows}</tbody></table>
<div class="legend"><span><span class="box" style="background:${COLORS.folga};color:#fff">F</span>Folga</span><span><span class="box" style="background:${COLORS.turno};color:#fff">T</span>Turno (cobertura)</span><span><span class="box" style="background:${COLORS.ferias}"></span>Férias</span><span><span class="box" style="background:${COLORS.domingo}"></span>Domingo</span><span><span class="box" style="background:${COLORS.feriado}"></span>Feriado</span><span><span class="box" style="background:${COLORS.eventoPequeno}"></span>Evento pequeno</span><span><span class="box" style="background:${COLORS.eventoMedio}"></span>Evento médio</span><span><span class="box" style="background:${COLORS.eventoGrande}"></span>Evento grande</span></div>
${holidayList ? `<div class="foot"><b>Feriados de ${MONTHS[month - 1]}:</b> ${holidayList}</div>` : ""}
</body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open(); doc.write(html); doc.close();
    iframe.contentWindow?.focus();
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 1500);
    }, 350);
  }

  const NAME_COL = 172;
  const CELL = 34;

  const stickyNameStyle: CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
    minWidth: NAME_COL, maxWidth: NAME_COL, borderRight: "1px solid var(--border-strong, var(--border))",
    padding: "6px 10px", textAlign: "left"
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
      color: eventBg ? "#fff" : (m.isSunday || m.isHoliday ? "#1f2937" : "var(--muted)"),
      boxShadow: "inset 0 -1px 0 var(--border)",
      cursor: canEdit ? "pointer" : "default"
    };
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Pessoal</PanelEyebrow>
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarDays size={18} /> Escala mensal
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", whiteSpace: "nowrap" }}>
            <Button variant="secondary" onClick={() => goMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            <strong style={{ minWidth: 118, textAlign: "center" }}>{MONTHS[month - 1]} {year}</strong>
            <Button variant="secondary" onClick={() => goMonth(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
            <Button variant="secondary" onClick={handleReload} aria-label="Recarregar"><RefreshCw size={15} /></Button>
            <Button variant="secondary" leadingIcon={<Printer size={14} />} onClick={handlePrint}>Imprimir</Button>
            {canEdit && <Button leadingIcon={<Save size={14} />} onClick={handleSave} disabled={!dirty || saving}>{saving ? "Salvando..." : "Salvar escala"}</Button>}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--muted)", margin: "0 0 10px", alignItems: "center" }}>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.folga, verticalAlign: "-2px", marginRight: 5 }} />Folga (F)</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.turno, verticalAlign: "-2px", marginRight: 5 }} />Turno / cobertura (T)</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.ferias, verticalAlign: "-2px", marginRight: 5 }} />Férias</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.domingo, verticalAlign: "-2px", marginRight: 5 }} />Domingo</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.feriado, verticalAlign: "-2px", marginRight: 5 }} />Feriado</span>
          <span style={{ width: "100%", height: 0 }} />
          <strong style={{ fontSize: 11, color: "var(--ink, inherit)" }}>Eventos (na data):</strong>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.eventoPequeno, verticalAlign: "-2px", marginRight: 5 }} />Evento pequeno</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.eventoMedio, verticalAlign: "-2px", marginRight: 5 }} />Evento médio</span>
          <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: COLORS.eventoGrande, verticalAlign: "-2px", marginRight: 5 }} />Evento grande</span>
          {canEdit && <span style={{ fontSize: 11, opacity: 0.85 }}>Célula do funcionário: clique cicla — → F → T → —. Cabeçalho da data: clique cicla o evento — → Pequeno → Médio → Grande → —</span>}
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {loading && <EmptyState title="Carregando escala..." />}
        {!loading && data && data.employees.length === 0 && (
          <EmptyState
            title="Nenhum funcionário na escala"
            description="Só entram aqui funcionários ativos com 'Entra na escala' ligado no cadastro. Verifique em Funcionários."
          />
        )}

        {!loading && data && data.employees.length > 0 && (
          <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...stickyNameStyle, top: 0, zIndex: 6, boxShadow: "inset 0 -1px 0 var(--border)", fontSize: 11, color: "var(--muted)" }}>Funcionário</th>
                  <th style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--surface)", minWidth: 52, maxWidth: 52, textAlign: "center", padding: "4px 2px", fontSize: 10, fontWeight: 500, color: "var(--muted)", boxShadow: "inset 0 -1px 0 var(--border)", borderLeft: "1px solid var(--border)" }} title="Total de dias trabalhados no mês (só na tela)">Trab.</th>
                  {data.days.map((d) => {
                    const ev = dateEvents.get(d.day);
                    const evTitle = ev ? `${EVENT_LABEL[ev]}${canEdit ? " — clique para trocar" : ""}` : (canEdit ? "Clique para marcar evento" : undefined);
                    return (
                      <th key={d.day} style={headStyle(d, ev)} title={evTitle ?? d.holidayName ?? undefined} onClick={canEdit ? () => toggleDateEvent(d.day) : undefined}>
                        <div style={{ fontWeight: 500, color: ev ? "#fff" : "var(--ink, inherit)" }}>{d.day}</div>
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
                      <td colSpan={data.days.length + 2} style={{ background: "var(--paper-soft, var(--surface-2))", padding: "5px 10px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", position: "sticky", left: 0 }}>
                        {group.sector}
                      </td>
                    </tr>
                    {group.subs.map((sub) => (
                      <Fragment key={group.sector + "|" + (sub.subgroup ?? "_")}>
                        {sub.subgroup && (
                          <tr>
                            <td colSpan={data.days.length + 2} style={{ padding: "3px 10px 3px 22px", fontSize: 10.5, fontWeight: 600, color: "var(--muted)", position: "sticky", left: 0, background: "var(--surface)" }}>
                              {sub.subgroup}
                            </td>
                          </tr>
                        )}
                    {sub.employees.map((emp) => (
                      <tr key={emp.id}>
                        <td style={stickyNameStyle}>
                          <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: NAME_COL - 20 }} title={fullName(emp)}>{fullName(emp)}</div>
                          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                            {REGIME_SHORT[emp.scheduleRegime] ?? ""}{emp.shiftStart ? ` · ${emp.shiftStart}${emp.shiftEnd ? `–${emp.shiftEnd}` : ""}` : ""}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, fontSize: 10.5, color: "var(--muted)" }} title="Folgas a mais por feriado trabalhado">
                            <span>Folga feriado:</span>
                            {canEdit && <button type="button" aria-label="Menos uma folga" onClick={() => handleComp(emp.id, -1)} style={compBtn}><Minus size={11} /></button>}
                            <strong style={{ color: "var(--ink, inherit)", minWidth: 10, textAlign: "center" }}>{comp.get(emp.id) ?? 0}</strong>
                            {canEdit && <button type="button" aria-label="Mais uma folga" onClick={() => handleComp(emp.id, 1)} style={compBtn}><Plus size={11} /></button>}
                            {holidaysWorked(emp) > 0 && <span style={{ color: "#9a6410" }} title="Feriados trabalhados neste mês">· {holidaysWorked(emp)} trab.</span>}
                          </div>
                        </td>
                        <td style={{ minWidth: 52, maxWidth: 52, textAlign: "center", fontWeight: 600, borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)" }} title="Dias trabalhados no mês">{workedDays(emp)}</td>
                        {data.days.map((d) => {
                          const within = withinEmployment(emp, year, month, d.day);
                          const isFeriasDay = isFerias(emp.id, d.day);
                          const mark = marks.get(keyOf(emp.id, d.day));
                          const isFolgaDay = !isFeriasDay && mark === "FOLGA";
                          const isTurnoDay = !isFeriasDay && mark === "TURNO";
                          const bg = !within
                            ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(128,128,128,0.12) 3px, rgba(128,128,128,0.12) 6px)"
                            : isFeriasDay
                              ? COLORS.ferias
                              : isFolgaDay
                                ? COLORS.folga
                                : isTurnoDay
                                  ? COLORS.turno
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
                              : isTurnoDay
                                ? "Turno estendido (cobertura)"
                                : d.holidayName ?? (d.isSunday ? "Domingo" : undefined);
                          return (
                            <td
                              key={d.day}
                              onClick={clickable ? () => toggle(emp.id, d.day) : undefined}
                              title={title}
                              style={{
                                minWidth: CELL, width: CELL, height: 34, textAlign: "center",
                                borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
                                background: bg, cursor: clickable && canEdit ? "pointer" : "default",
                                color: "#fff", fontWeight: 600, userSelect: "none",
                                fontSize: isFeriasDay ? 9 : undefined
                              }}
                            >
                              {within ? (isFeriasDay ? "Fér" : isFolgaDay ? "F" : isTurnoDay ? "T" : "") : ""}
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
