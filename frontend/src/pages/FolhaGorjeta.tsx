import { Check, ChevronLeft, ChevronRight, Lock, Maximize2, Minimize2, Plus, RefreshCw, Save, Unlock, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type TipComputation, type TipComputedParticipant, type TipRosterEmployee, type TipValeType,
  addTipVale, closeTipPeriodApi, getTipCommission, getTipRoster, openTipPeriod,
  removeTipParticipant, removeTipVale, reopenTipPeriodApi, saveTipParticipants, syncTipParticipants, updateTipPeriod,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Button, FormField, FormGrid, StatusBadge, Tabs } from "../design-system";
import { hasPermission } from "../lib/permissions";
import "./gorjeta/gorjeta.css";
import { AbaApuracao } from "./gorjeta/AbaApuracao";
import { AbaEquipe } from "./gorjeta/AbaEquipe";
import { AbaPagamento } from "./gorjeta/AbaPagamento";
import { AbaRelatorios } from "./gorjeta/AbaRelatorios";
import { Pendencias } from "./gorjeta/Pendencias";
import { ResumoApuracao } from "./gorjeta/ResumoApuracao";
import { type LocalRow, MONTHS, inputStyle, money, mutedStyle, panelStyle, toPayload, toRows } from "./gorjeta/gorjetaUtils";

type Aba = "apuracao" | "pagamento" | "equipe" | "relatorios";

type Parametros = {
  start: string; end: string; pool: string; deduction: string; pointsTotal: string; diasPadrao: string;
  descontaFalta: boolean; descontaAtestado: boolean; descontaFerias: boolean; descontaOutros: boolean;
  reservaPontos: string;
};

function parametrosDe(c: TipComputation): Parametros {
  return {
    start: c.periodStart.slice(0, 10), end: c.periodEnd.slice(0, 10),
    pool: String(c.grossPool), deduction: String(c.deductionPercent), pointsTotal: String(c.pointsBudget), diasPadrao: String(c.diasPadrao),
    descontaFalta: c.descontaFalta, descontaAtestado: c.descontaAtestado, descontaFerias: c.descontaFerias, descontaOutros: c.descontaOutros,
    reservaPontos: String(c.reservaPontos),
  };
}

export function FolhaGorjeta() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payroll-tips", "edit");
  const canApprove = hasPermission(user, "payroll-tips", "approve");
  const { notice, setNotice } = useNotice();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [aba, setAba] = useState<Aba>("apuracao");
  const [comp, setComp] = useState<TipComputation | null>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [params, setParams] = useState<Parametros | null>(null);
  const [roster, setRoster] = useState<TipRosterEmployee[]>([]);
  const [addEmpId, setAddEmpId] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  // Autosave: a edição agenda um salvamento; qualquer outra ação salva antes o que
  // estiver pendente (flush), para não sobrescrever um sync nem bater num período já fechado.
  const rowsRef = useRef<LocalRow[]>([]);
  rowsRef.current = rows;
  const pendente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emVoo = useRef<Promise<void> | null>(null);

  // Tela cheia: a página cobre a janela (e usa a tela cheia do navegador quando ele deixa).
  const raiz = useRef<HTMLDivElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);

  async function alternarTelaCheia() {
    if (!telaCheia) {
      setTelaCheia(true);
      try { await raiz.current?.requestFullscreen?.(); } catch { /* sem a API, fica o modo janela inteira */ }
      return;
    }
    setTelaCheia(false);
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* já saiu */ }
    }
  }

  useEffect(() => {
    // Esc do navegador sai da tela cheia: a página acompanha.
    const aoMudar = () => { if (!document.fullscreenElement) setTelaCheia(false); };
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.fullscreenElement) setTelaCheia(false); };
    document.addEventListener("fullscreenchange", aoMudar);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("fullscreenchange", aoMudar);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, []);

  const closed = comp?.status === "CLOSED";
  const readonly = closed || !canEdit;
  const periodoEditavel = useRef<string | null>(null);
  periodoEditavel.current = readonly ? null : comp?.periodId ?? null;
  const erro = (e: unknown) => setNotice({ tone: "error", message: (e as Error).message });

  function aplicar(c: TipComputation) {
    setComp(c);
    setRows(toRows(c));
    setParams(parametrosDe(c));
  }

  function salvarLinhas(): Promise<void> {
    const periodId = periodoEditavel.current;
    if (!periodId) return Promise.resolve();
    setAutoSaving(true);
    const p = saveTipParticipants(periodId, rowsRef.current.map(toPayload))
      .then((c) => { setComp(c); })
      .catch(erro)
      .finally(() => { setAutoSaving(false); emVoo.current = null; });
    emVoo.current = p;
    return p;
  }

  // Salva já o que estiver agendado e espera o que estiver a caminho.
  async function flush() {
    if (pendente.current) {
      clearTimeout(pendente.current);
      pendente.current = null;
      await salvarLinhas();
    }
    if (emVoo.current) await emVoo.current;
  }

  async function load() {
    await flush();
    setBusy(true);
    try {
      const [c, emps] = await Promise.all([getTipCommission(year, month), getTipRoster()]);
      aplicar(c);
      setRoster(emps);
    } catch (e) { erro(e); } finally { setBusy(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [year, month]);

  async function changeMonth(delta: number) {
    await flush();
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
  }

  async function ensurePeriod(): Promise<string> {
    if (comp?.periodId) return comp.periodId;
    const p = await openTipPeriod(year, month);
    return p.id;
  }

  async function abrirPeriodo() {
    await flush();
    setBusy(true);
    try {
      await ensurePeriod();
      await load();
      setNotice({ tone: "success", message: "Período aberto: serviço puxado do faturamento e equipe carregada do cadastro." });
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  async function salvarParametros() {
    await flush();
    if (!params || !comp) return;
    setBusy(true);
    try {
      const id = await ensurePeriod();
      const datasMudaram = params.start !== comp.periodStart.slice(0, 10) || params.end !== comp.periodEnd.slice(0, 10);
      const poolMudou = params.pool !== String(comp.grossPool);
      await updateTipPeriod(id, {
        deductionPercent: Number(params.deduction),
        pointsTotal: Math.max(1, Math.round(Number(params.pointsTotal) || 100)),
        diasPadrao: Math.round(Number(params.diasPadrao) || 26),
        descontaFalta: params.descontaFalta, descontaAtestado: params.descontaAtestado,
        descontaFerias: params.descontaFerias, descontaOutros: params.descontaOutros,
        reservaPontos: Math.max(0, Number(params.reservaPontos.replace(",", ".")) || 0),
        ...(datasMudaram ? { periodStart: params.start, periodEnd: params.end } : {}),
        // Só manda o bruto se foi digitado; se só as datas mudaram, o backend repuxa do faturamento.
        ...(poolMudou || !datasMudaram ? { grossPool: Number(params.pool) } : {}),
      });
      await load();
      setNotice({ tone: "success", message: "Parâmetros do período salvos." });
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  // Recálculo automático: cada edição salva e recalcula após 700 ms sem digitar.
  function setRow(employeeId: string, patch: Partial<LocalRow>) {
    const novas = rowsRef.current.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r));
    rowsRef.current = novas;
    setRows(novas);
    if (pendente.current) clearTimeout(pendente.current);
    pendente.current = setTimeout(() => { pendente.current = null; void salvarLinhas(); }, 700);
  }

  // Sai da tela com edição pendente: salva.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { void flush(); }, []);

  async function adicionar() {
    await flush();
    if (!addEmpId) return;
    setBusy(true);
    try {
      const id = await ensurePeriod();
      aplicar(await saveTipParticipants(id, [...rowsRef.current.map(toPayload), { employeeId: addEmpId, kind: "PONTOS" }]));
      setAddEmpId("");
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  async function sincronizar() {
    await flush();
    setBusy(true);
    try {
      const id = await ensurePeriod();
      const { added, elegiveis, atualizados, computation } = await syncTipParticipants(id);
      aplicar(computation);
      setNotice(
        elegiveis === 0
          ? { tone: "warning", message: "Ninguém está marcado como participante. Marque a equipe na aba \"Equipe e funções\"." }
          : { tone: "success", message: `${added} incluído(s) e ${atualizados} com pontos-base atualizados do cadastro.` },
      );
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  async function remover(p: TipComputedParticipant) {
    if (!p.participantId) return;
    if (!window.confirm(`Tirar ${p.employeeName} deste período?`)) return;
    setBusy(true);
    try { await removeTipParticipant(p.participantId); await load(); } catch (e) { erro(e); } finally { setBusy(false); }
  }

  async function lancarVale(participantId: string, vale: { type: TipValeType; amount: number; date?: string; notes?: string }) {
    await flush();
    try { await addTipVale(participantId, vale); await load(); } catch (e) { erro(e); }
  }

  async function apagarVale(valeId: string) {
    try { await removeTipVale(valeId); await load(); } catch (e) { erro(e); }
  }

  async function fechar() {
    await flush();
    if (!comp) return;
    const saldo = comp.saldo > 0.005 ? `\n\nSaldo não distribuído de ${money(comp.saldo)} fica retido.` : "";
    if (!window.confirm(`Fechar a gorjeta de ${MONTHS[month - 1]}/${year}? Os valores ficam gravados.${saldo}`)) return;
    setBusy(true);
    try {
      await closeTipPeriodApi(year, month);
      await load();
      setNotice({ tone: "success", message: "Período fechado. Valores gravados para contabilidade e pagamento." });
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  async function reabrir() {
    await flush();
    if (!window.confirm("Reabrir este período? Ele volta a ficar editável e precisará ser fechado de novo.")) return;
    setBusy(true);
    try {
      await reopenTipPeriodApi(year, month);
      await load();
      setNotice({ tone: "success", message: "Período reaberto." });
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  const disponiveis = roster.filter((e) => !rows.some((r) => r.employeeId === e.id));

  return (
    <div ref={raiz} className={telaCheia ? "gorjeta-tela-cheia" : undefined} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={() => void changeMonth(-1)} aria-label="Mês anterior" leadingIcon={<ChevronLeft size={14} />}>Anterior</Button>
        <strong style={{ minWidth: 150, textAlign: "center" }}>{MONTHS[month - 1]} / {year}</strong>
        <Button variant="secondary" onClick={() => void changeMonth(1)} aria-label="Próximo mês" leadingIcon={<ChevronRight size={14} />}>Próximo</Button>
        <Button variant="secondary" onClick={() => void load()} aria-label="Recarregar" leadingIcon={<RefreshCw size={14} />}>Recarregar</Button>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>{comp?.label}</span>
        {comp?.periodId && (
          <StatusBadge tone={closed ? "success" : "info"}>{closed ? "Fechada" : "Em apuração"}</StatusBadge>
        )}
        <span aria-live="polite" style={{ color: "var(--muted)", fontSize: 12 }}>{autoSaving ? "salvando…" : ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs
          value={aba}
          onChange={(v) => setAba(v as Aba)}
          tabs={[
            { value: "apuracao", label: "Apuração" },
            { value: "pagamento", label: "Pagamento e envio" },
            { value: "equipe", label: "Equipe e funções" },
            { value: "relatorios", label: "Relatórios" },
          ]}
        />
        <Button variant="secondary" onClick={() => void alternarTelaCheia()}
          leadingIcon={telaCheia ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          title={telaCheia ? "Voltar ao tamanho normal (Esc)" : "Ver a tela inteira de uma vez"}>
          {telaCheia ? "Sair da tela cheia" : "Tela cheia"}
        </Button>
      </div>

      {aba === "equipe" && (
        <AbaEquipe
          canEdit={canEdit}
          onNotice={(tone, message) => setNotice({ tone, message })}
          onChanged={() => { if (comp?.periodId && !closed) void getTipCommission(year, month).then(setComp); }}
        />
      )}

      {aba === "relatorios" && (
        <AbaRelatorios comp={comp} canEdit={canEdit} onNotice={(tone, message) => setNotice({ tone, message })}
          onChanged={() => { void getTipCommission(year, month).then(aplicar); }} />
      )}

      {(aba === "apuracao" || aba === "pagamento") && comp && (
        <>
          {comp.periodId != null && <ResumoApuracao comp={comp} compacto={telaCheia} />}

          {comp.periodId == null ? (
            <div style={{ ...panelStyle, gap: 8 }}>
              <span>Nenhum período aberto para esta competência.</span>
              <span style={mutedStyle}>
                Abrir puxa o serviço do Faturamento Salão (26 → 25) e traz a equipe marcada em "Equipe e funções", com os pontos da função.
              </span>
              {canEdit && <div><Button onClick={() => void abrirPeriodo()} disabled={busy} leadingIcon={<Plus size={14} />}>Abrir período</Button></div>}
            </div>
          ) : (
            <>
              <Pendencias pendencias={comp.pendencias} avisos={comp.warnings} fechado={closed} compacto={telaCheia} />

              {aba === "apuracao" && params && !telaCheia && (
                <details style={panelStyle}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                    Parâmetros do período <span style={{ ...mutedStyle, fontWeight: 400 }}>
                      — {comp.diasPadrao} dias padrão; descontam: {[comp.descontaFalta && "falta", comp.descontaAtestado && "atestado", comp.descontaFerias && "férias", comp.descontaOutros && "outros"].filter(Boolean).join(", ") || "nada"}
                    </span>
                  </summary>
                  <FormGrid cols={4}>
                    <FormField label="Início"><input style={inputStyle} type="date" value={params.start} disabled={readonly} onChange={(e) => setParams({ ...params, start: e.target.value })} /></FormField>
                    <FormField label="Fim"><input style={inputStyle} type="date" value={params.end} disabled={readonly} onChange={(e) => setParams({ ...params, end: e.target.value })} /></FormField>
                    <FormField label="Serviço arrecadado R$"><input style={inputStyle} type="number" step="0.01" value={params.pool} disabled={readonly} onChange={(e) => setParams({ ...params, pool: e.target.value })} /></FormField>
                    <FormField label="Retenção (%)"><input style={inputStyle} type="number" step="0.01" value={params.deduction} disabled={readonly} onChange={(e) => setParams({ ...params, deduction: e.target.value })} /></FormField>
                    <FormField label="Pontos de referência"><input style={inputStyle} type="number" step="1" min="1" value={params.pointsTotal} disabled={readonly} onChange={(e) => setParams({ ...params, pointsTotal: e.target.value })} /></FormField>
                    <FormField label="Dias padrão de trabalho"><input style={inputStyle} type="number" step="1" min="1" max="31" value={params.diasPadrao} disabled={readonly} onChange={(e) => setParams({ ...params, diasPadrao: e.target.value })} /></FormField>
                    <FormField label="Pontos da reserva da casa"><input style={inputStyle} type="number" step="0.5" min="0" value={params.reservaPontos} disabled={readonly} title="Vão para o fundo de reserva: pontos × valor do ponto" onChange={(e) => setParams({ ...params, reservaPontos: e.target.value })} /></FormField>
                  </FormGrid>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
                    <span style={mutedStyle}>Reduzem o rateio:</span>
                    {([["descontaFalta", "Falta injustificada"], ["descontaAtestado", "Atestado / afastamento"], ["descontaFerias", "Férias"], ["descontaOutros", "Outros dias"]] as const).map(([k, label]) => (
                      <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={params[k]} disabled={readonly} onChange={(e) => setParams({ ...params, [k]: e.target.checked })} />{label}
                      </label>
                    ))}
                  </div>
                  <span style={mutedStyle}>Folga normal não desconta: já está embutida nos dias padrão. Mudar as datas repuxa o serviço do faturamento.</span>
                  {!readonly && <div><Button onClick={() => void salvarParametros()} disabled={busy} leadingIcon={<Save size={14} />}>Salvar parâmetros</Button></div>}
                </details>
              )}

              {aba === "apuracao" && !readonly && !telaCheia && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <Button variant="secondary" onClick={() => void sincronizar()} disabled={busy} leadingIcon={<UserPlus size={14} />}
                    title="Inclui quem foi marcado na equipe e atualiza os pontos-base">
                    Atualizar do cadastro
                  </Button>
                  <FormField label="Incluir avulso">
                    <select style={{ ...inputStyle, minWidth: 240 }} value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)}>
                      <option value="">Selecione…</option>
                      {disponiveis.map((e) => <option key={e.id} value={e.id}>{(e.displayName || `${e.firstName} ${e.lastName}`).trim()}{e.isActive ? "" : " (desligado)"}</option>)}
                    </select>
                  </FormField>
                  <Button variant="secondary" onClick={() => void adicionar()} disabled={!addEmpId || busy} leadingIcon={<Plus size={14} />}>Incluir</Button>
                </div>
              )}

              {aba === "apuracao" && (
                <AbaApuracao comp={comp} rows={rows} readonly={readonly} onRow={setRow}
                  onRemove={(p) => void remover(p)} onAddVale={lancarVale} onRemoveVale={(id) => void apagarVale(id)} />
              )}
              {aba === "pagamento" && (
                <AbaPagamento comp={comp} rows={rows} readonly={readonly} onRow={setRow} onError={(m) => setNotice({ tone: "error", message: m })} />
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {closed ? (
                  <>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}><Lock size={14} /> Período fechado.</span>
                    {canApprove && <Button variant="secondary" onClick={() => void reabrir()} disabled={busy} leadingIcon={<Unlock size={14} />}>Reabrir período</Button>}
                  </>
                ) : (
                  <Button onClick={() => void fechar()} disabled={!canApprove || busy || autoSaving || !comp.check.ok} leadingIcon={<Check size={14} />}
                    title={comp.check.ok ? undefined : "Resolva as pendências em vermelho antes de fechar."}>
                    Fechar período
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
