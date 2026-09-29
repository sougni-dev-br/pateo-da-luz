import { Check, ChevronLeft, ChevronRight, Lock, Maximize2, Minimize2, Plus, RefreshCw, Save, Unlock, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type TipComputation, type TipComputedParticipant, type TipRosterEmployee,
  closeTipPeriodApi, getTipCommission, getTipRoster, openTipPeriod,
  refreshTipService, removeTipParticipant, reopenTipPeriodApi, saveTipParticipants, syncTipParticipants, updateTipPeriod,
} from "../api/client";
import { AjusteServico } from "./gorjeta/AjusteServico";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Button, FormField, FormGrid, StatusBadge, Tabs } from "../design-system";
import { hasPermission } from "../lib/permissions";
import "./gorjeta/gorjeta.css";
import { AbaApuracao } from "./gorjeta/AbaApuracao";
import { AbaEquipe } from "./gorjeta/AbaEquipe";
import { AbaFuncoes } from "./gorjeta/AbaFuncoes";
import { AbaContabilidade } from "./gorjeta/AbaContabilidade";
import { AbaVales } from "./gorjeta/AbaVales";
import { AbaPagamento } from "./gorjeta/AbaPagamento";
import { AbaRelatorios } from "./gorjeta/AbaRelatorios";
import { Pendencias } from "./gorjeta/Pendencias";
import { ResumoApuracao } from "./gorjeta/ResumoApuracao";
import { type LocalRow, MONTHS, inputStyle, money, mutedStyle, panelStyle, toPayload, toRows } from "./gorjeta/gorjetaUtils";

type Aba = "apuracao" | "vales" | "pagamento" | "contabilidade" | "equipe" | "funcoes" | "relatorios";

type Parametros = {
  start: string; end: string; pool: string; deduction: string; pointsTotal: string; diasPadrao: string;
  descontaFalta: boolean; descontaAtestado: boolean; descontaFerias: boolean; descontaOutros: boolean;
  proporcionalEntrada: boolean;
  reservaPontos: string;
};

function parametrosDe(c: TipComputation): Parametros {
  return {
    start: c.periodStart.slice(0, 10), end: c.periodEnd.slice(0, 10),
    pool: String(c.grossPool), deduction: String(c.deductionPercent), pointsTotal: String(c.pointsBudget), diasPadrao: String(c.diasPadrao),
    descontaFalta: c.descontaFalta, descontaAtestado: c.descontaAtestado, descontaFerias: c.descontaFerias, descontaOutros: c.descontaOutros,
    proporcionalEntrada: c.proporcionalEntrada,
    reservaPontos: String(c.reservaPontos),
  };
}

export function FolhaGorjeta() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payroll-tips", "edit");
  const canApprove = hasPermission(user, "payroll-tips", "approve");
  const podeReabrir = hasPermission(user, "payroll-tips", "admin");
  const { notice, setNotice } = useNotice();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [aba, setAba] = useState<Aba>("apuracao");
  const [valesPessoa, setValesPessoa] = useState<string | null>(null);
  const [comp, setComp] = useState<TipComputation | null>(null);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [params, setParams] = useState<Parametros | null>(null);
  const [roster, setRoster] = useState<TipRosterEmployee[]>([]);
  const [addEmpId, setAddEmpId] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [ajustandoServico, setAjustandoServico] = useState(false);
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
      await updateTipPeriod(id, {
        deductionPercent: Number(params.deduction),
        pointsTotal: Math.max(1, Math.round(Number(params.pointsTotal) || 100)),
        diasPadrao: Math.round(Number(params.diasPadrao) || 26),
        descontaFalta: params.descontaFalta, descontaAtestado: params.descontaAtestado,
        descontaFerias: params.descontaFerias, descontaOutros: params.descontaOutros,
        proporcionalEntrada: params.proporcionalEntrada,
        reservaPontos: Math.max(0, Number(params.reservaPontos.replace(",", ".")) || 0),
        ...(datasMudaram ? { periodStart: params.start, periodEnd: params.end } : {}),
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



  async function fechar() {
    await flush();
    if (!comp) return;
    const saldo = comp.saldo > 0.005 ? `\n\nSaldo não distribuído de ${money(comp.saldo)} fica retido.` : "";
    if (!window.confirm(`Fechar a gorjeta de ${MONTHS[month - 1]}/${year}? Os valores ficam gravados.${saldo}`)) return;
    setBusy(true);
    try {
      await closeTipPeriodApi(year, month);
      await load();
      setNotice({ tone: "success", message: "Período fechado. O retrato completo ficou gravado no registro de fechamentos (Relatórios → Fechamentos)." });
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  const [reabrindo, setReabrindo] = useState(false);
  const [motivoReabrir, setMotivoReabrir] = useState("");
  async function reabrir() {
    await flush();
    setBusy(true);
    try {
      await reopenTipPeriodApi(year, month, motivoReabrir.trim());
      setReabrindo(false);
      setMotivoReabrir("");
      await load();
      setNotice({ tone: "success", message: "Período reaberto. O motivo ficou registrado." });
    } catch (e) { erro(e); } finally { setBusy(false); }
  }

  const disponiveis = roster.filter((e) => !rows.some((r) => r.employeeId === e.id));

  return (
    <div ref={raiz} className={telaCheia ? "gorjeta-tela-cheia" : undefined} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />

      <div className="cabecalho-periodo">
        <div className="navegador-mes" role="group" aria-label="Competência">
          <button type="button" onClick={() => void changeMonth(-1)} aria-label="Mês anterior" title="Mês anterior"><ChevronLeft size={16} /></button>
          <strong>{MONTHS[month - 1]} / {year}</strong>
          <button type="button" onClick={() => void changeMonth(1)} aria-label="Próximo mês" title="Próximo mês"><ChevronRight size={16} /></button>
        </div>
        <div className="identidade-periodo">
          {comp?.code && <span className="codigo-apuracao" title="Código da apuração">{comp.code}</span>}
          <span className="identidade-periodo-datas">{comp?.label}</span>
          {comp?.periodId && <StatusBadge tone={closed ? "success" : "info"}>{closed ? "Fechada" : "Em apuração"}</StatusBadge>}
        </div>
        <div className="cabecalho-periodo-acoes">
          <span aria-live="polite" className="cabecalho-salvando">{autoSaving ? "salvando…" : ""}</span>
          <button type="button" className="botao-icone" onClick={() => void load()} aria-label="Recarregar" title="Recarregar"><RefreshCw size={15} /></button>
          <Button variant="secondary" onClick={() => void alternarTelaCheia()}
            leadingIcon={telaCheia ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            aria-label={telaCheia ? "Sair da tela cheia" : "Tela cheia"} title={telaCheia ? "Voltar ao tamanho normal (Esc)" : "Ver a tela inteira de uma vez"}>
            <span className="rotulo-tela-cheia">{telaCheia ? "Sair da tela cheia" : "Tela cheia"}</span>
          </Button>
        </div>
      </div>

      <Tabs
        value={aba}
        onChange={(v) => setAba(v as Aba)}
        tabs={[
          { value: "apuracao", label: "Apuração" },
          { value: "vales", label: "Vales" },
          { value: "pagamento", label: "Pagamento e envio" },
          { value: "contabilidade", label: "Contabilidade e folha" },
          { value: "equipe", label: "Equipe" },
          { value: "funcoes", label: "Funções e pontos" },
          { value: "relatorios", label: "Relatórios" },
        ]}
      />

      {aba === "equipe" && (
        <AbaEquipe
          canEdit={canEdit}
          onNotice={(tone, message) => setNotice({ tone, message })}
          onChanged={() => { if (comp?.periodId && !closed) void getTipCommission(year, month).then(setComp); }}
        />
      )}

      {aba === "vales" && comp?.periodId && (
        <AbaVales key={valesPessoa ?? "todos"} year={year} month={month} canEdit={canEdit} pessoaInicial={valesPessoa}
          onNotice={(tone, message) => setNotice({ tone, message })} onChanged={() => void load()} />
      )}
      {aba === "vales" && !comp?.periodId && (
        <div style={panelStyle}><span style={mutedStyle}>Abra o período na aba Apuração para lançar vales.</span></div>
      )}

      {aba === "contabilidade" && (
        <AbaContabilidade year={year} month={month} canEdit={canEdit} onNotice={(tone, message) => setNotice({ tone, message })} />
      )}

      {aba === "funcoes" && (
        <AbaFuncoes
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
          {comp.periodId != null && (
            <ResumoApuracao comp={comp} compacto={telaCheia || aba === "pagamento"}
              onAjustarServico={readonly ? undefined : () => setAjustandoServico((v) => !v)} />
          )}
          {ajustandoServico && comp.periodId != null && !readonly && (
            <AjusteServico comp={comp}
              onFechar={() => setAjustandoServico(false)}
              onSalvar={async (ajuste, motivo) => {
                await flush();
                await updateTipPeriod(comp.periodId!, { ajusteServico: ajuste, ajusteServicoMotivo: motivo });
                await load();
                setAjustandoServico(false);
                setNotice({ tone: "success", message: "Serviço arrecadado ajustado." });
              }}
              onAtualizarFaturamento={async () => {
                await flush();
                await refreshTipService(comp.periodId!);
                await load();
                setNotice({ tone: "success", message: "Serviço do faturamento atualizado; o ajuste foi mantido." });
              }}
              onErro={erro} />
          )}

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
              <Pendencias pendencias={comp.pendencias} avisos={comp.warnings} fechado={closed} compacto={telaCheia || aba === "pagamento"}
                onIrRescisoes={() => {
                  setAba("apuracao");
                  // Espera a aba desenhar; rola até o bloco e leva o foco para ele.
                  window.setTimeout(() => {
                    const alvo = document.getElementById("rescisoes-do-periodo");
                    alvo?.scrollIntoView({ behavior: "smooth", block: "start" });
                    alvo?.focus({ preventScroll: true });
                  }, 60);
                }} />

              {aba === "apuracao" && params && !telaCheia && (
                <details className="painel-detalhes">
                  <summary>
                    Parâmetros do período <span style={{ ...mutedStyle, fontWeight: 400 }}>
                      — {comp.diasPadrao} dias padrão; descontam: {[comp.descontaFalta && "falta", comp.descontaAtestado && "atestado", comp.descontaFerias && "férias", comp.descontaOutros && "outros"].filter(Boolean).join(", ") || "nada"}{comp.proporcionalEntrada ? "; admitido recebe proporcional" : ""}
                    </span>
                  </summary>
                  <div className="painel-detalhes-corpo">
                  <FormGrid cols={4}>
                    <FormField label="Início"><input style={inputStyle} type="date" value={params.start} disabled={readonly} onChange={(e) => setParams({ ...params, start: e.target.value })} /></FormField>
                    <FormField label="Fim"><input style={inputStyle} type="date" value={params.end} disabled={readonly} onChange={(e) => setParams({ ...params, end: e.target.value })} /></FormField>
                    <FormField label="Retenção (%)"><input style={inputStyle} type="number" step="0.01" value={params.deduction} disabled={readonly} onChange={(e) => setParams({ ...params, deduction: e.target.value })} /></FormField>
                    <FormField label="Pontos de referência"><input style={inputStyle} type="number" step="1" min="1" value={params.pointsTotal} disabled={readonly} onChange={(e) => setParams({ ...params, pointsTotal: e.target.value })} /></FormField>
                    <FormField label="Dias padrão de trabalho"><input style={inputStyle} type="number" step="1" min="1" max="31" value={params.diasPadrao} disabled={readonly} onChange={(e) => setParams({ ...params, diasPadrao: e.target.value })} /></FormField>
                    <FormField label="Pontos da reserva da casa"><input style={inputStyle} type="number" step="0.5" min="0" value={params.reservaPontos} disabled={readonly} title="Vão para o fundo de reserva: pontos × valor do ponto" onChange={(e) => setParams({ ...params, reservaPontos: e.target.value })} /></FormField>
                  </FormGrid>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
                    <span style={mutedStyle}>Reduzem o rateio:</span>
                    {([["descontaFalta", "Falta injustificada"], ["descontaAtestado", "Atestado / afastamento"], ["descontaFerias", "Férias"], ["descontaOutros", "Outros dias"], ["proporcionalEntrada", "Admitido no período: proporcional aos dias"]] as const).map(([k, label]) => (
                      <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={params[k]} disabled={readonly} onChange={(e) => setParams({ ...params, [k]: e.target.checked })} />{label}
                      </label>
                    ))}
                  </div>
                  <span style={mutedStyle}>Estas são as regras do período; em cada pessoa, o botão de regras (engrenagem) permite decidir diferente. Folga normal não desconta: já está embutida nos dias padrão. Mudar as datas repuxa o serviço do faturamento (o ajuste é mantido). O ajuste do serviço fica em "Serviço arrecadado → ajustar", no resumo.</span>
                  {!readonly && <div><Button onClick={() => void salvarParametros()} disabled={busy} leadingIcon={<Save size={14} />}>Salvar parâmetros</Button></div>}
                  </div>
                </details>
              )}

              {aba === "apuracao" && !readonly && !telaCheia && (
                <div className="barra-lista">
                  <Button variant="secondary" size="sm" onClick={() => void sincronizar()} disabled={busy} leadingIcon={<UserPlus size={14} />}
                    title="Inclui quem foi marcado na equipe e atualiza os pontos-base">
                    Atualizar do cadastro
                  </Button>
                  <span className="grupo-incluir">
                    <select value={addEmpId} onChange={(e) => setAddEmpId(e.target.value)} aria-label="Incluir pessoa avulsa">
                      <option value="">Incluir pessoa avulsa…</option>
                      {disponiveis.map((e) => <option key={e.id} value={e.id}>{(e.displayName || `${e.firstName} ${e.lastName}`).trim()}{e.isActive ? "" : " (desligado)"}</option>)}
                    </select>
                    <Button variant="secondary" size="sm" onClick={() => void adicionar()} disabled={!addEmpId || busy} leadingIcon={<Plus size={14} />}>Incluir</Button>
                  </span>
                </div>
              )}

              {aba === "apuracao" && (
                <AbaApuracao comp={comp} rows={rows} readonly={readonly} onRow={setRow}
                  onRemove={(p) => void remover(p)} onVerVales={(id) => { setValesPessoa(id); setAba("vales"); }}
                  recibo={{
                    antesDeGravar: flush,
                    onAplicado: (c) => { aplicar(c); setNotice({ tone: "success", message: "Termo de rescisão lido: a gorjeta paga ficou como valor quitado e saiu da lista a pagar." }); },
                    onErro: (m) => setNotice({ tone: "error", message: m }),
                  }} />
              )}
              {aba === "pagamento" && (
                <AbaPagamento comp={comp} rows={rows} readonly={readonly} onRow={setRow} onError={(m) => setNotice({ tone: "error", message: m })} />
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {closed ? (
                  <>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                      <Lock size={14} /> Fechado{comp.fechamento ? ` — registro ${comp.fechamento.code}, por ${comp.fechamento.closedByName} em ${new Date(comp.fechamento.closedAt).toLocaleString("pt-BR")}` : ""}.
                    </span>
                    {podeReabrir && !reabrindo && <Button variant="secondary" onClick={() => setReabrindo(true)} disabled={busy} leadingIcon={<Unlock size={14} />}>Reabrir período</Button>}
                    {reabrindo && (
                      <div className="barra-lista" style={{ flex: "1 1 100%" }}>
                        <input autoFocus value={motivoReabrir} onChange={(e) => setMotivoReabrir(e.target.value)}
                          placeholder="Motivo da reabertura (fica gravado no registro)" aria-label="Motivo da reabertura"
                          style={{ ...inputStyle, flex: "1 1 320px", width: "auto" }} />
                        <Button onClick={() => void reabrir()} disabled={busy || motivoReabrir.trim().length < 10} leadingIcon={<Unlock size={14} />}>Confirmar reabertura</Button>
                        <button type="button" className="barra-lista-link" onClick={() => { setReabrindo(false); setMotivoReabrir(""); }}>cancelar</button>
                        <span style={{ ...mutedStyle, flexBasis: "100%" }}>O fechamento atual continua guardado; fechar de novo cria a versão seguinte.</span>
                      </div>
                    )}
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
