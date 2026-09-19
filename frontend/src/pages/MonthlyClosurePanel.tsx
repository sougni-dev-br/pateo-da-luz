// Painel de Fechamento Mensal.
//
// A tela é aberta duas vezes com intenções diferentes: durante o mês, para pegar
// erro cedo, e no fim, para conferir antes de travar. O desenho anterior servia
// mal aos dois: seis painéis do mesmo tamanho, sempre abertos, e um contador de
// "pendências" que no dia 10 acusava cinco — nenhuma acionável, porque impostos
// e inventário final simplesmente ainda não tinham acontecido. Alarme sempre
// aceso é alarme que ninguém lê.
//
// Agora a tela separa o que ESTÁ ERRADO do que AINDA VAI ACONTECER (a regra vive
// em lib/fechamento-pendencias, testada), abre com o resultado do mês — que
// antes não aparecia em lugar nenhum — e recolhe o que está resolvido.
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Lock, TriangleAlert, Unlock, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AppUser,
  getMonthlyClosure,
  getMonthlyCmv,
  justifyMonthlyClosureBlock,
  removeMonthlyClosureJustification,
  lockMonthlyClosure,
  unlockMonthlyClosure,
  MonthlyClosureState,
  MonthlyCmv,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { VerificacaoDoFechamento } from "../components/VerificacaoDoFechamento";
import { BlocoDoFechamento, type EstadoDoBloco } from "../components/fechamento/BlocoDoFechamento";
import { JustificarDialog } from "../components/fechamento/JustificarDialog";
import { ConfirmDialog } from "../components/ui";
import { Alert, Button, Money, StatusBadge } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { progressoDoMes, resumirFechamento } from "../lib/fechamento-pendencias";
import { formatDate } from "../utils/format";
import "./MonthlyClosurePanel.css";

function currentYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function parseYearMonthParam(raw: string | undefined): { year: number; month: number } {
  if (!raw) return currentYearMonth();
  const match = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (!match) return currentYearMonth();
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return currentYearMonth();
  return { year: y, month: m };
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function monthLabel(year: number, month: number): string {
  return `${MESES[month - 1]} / ${year}`;
}

function toYearMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function frequencyLabel(freq: string): string {
  if (freq === "MONTHLY") return "Mensal";
  if (freq === "QUARTERLY") return "Trimestral";
  if (freq === "ANNUAL") return "Anual";
  return freq;
}

function percentual(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return `${(valor * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Um número do topo. O rótulo abaixo do valor, para o olho bater no valor primeiro. */
function Indicador({ rotulo, valor, apoio, destaque }: {
  rotulo: string; valor: React.ReactNode; apoio?: React.ReactNode; destaque?: boolean;
}) {
  return (
    <div className={`fm-indicador${destaque ? " destaque" : ""}`}>
      <strong>{valor}</strong>
      <span>{rotulo}</span>
      {apoio != null && <small>{apoio}</small>}
    </div>
  );
}

export function MonthlyClosurePanel({ user }: { user: AppUser }) {
  const canEdit = hasPermission(user, "monthly-closing", "edit");
  // Travar e reabrir o mes sao fechamento contabil: o backend pede "Aprovar".
  const canLockMonth = hasPermission(user, "monthly-closing", "approve");
  const params = useParams<{ yearMonth?: string }>();
  const navigate = useNavigate();
  const { year, month } = useMemo(() => parseYearMonthParam(params.yearMonth), [params.yearMonth]);
  const [state, setState] = useState<MonthlyClosureState | null>(null);
  const [cmv, setCmv] = useState<MonthlyCmv | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [justificando, setJustificando] = useState<{ key: string; label: string } | null>(null);
  const [confirmarTrava, setConfirmarTrava] = useState(false);
  const { notice, setNotice } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMonthlyClosure(year, month);
      setState(data);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar fechamento." });
    } finally {
      setLoading(false);
    }
  }, [year, month, setNotice]);

  useEffect(() => { load(); }, [load]);

  // O resultado do mes vem de outra rota e nao pode atrasar a tela: carrega em
  // paralelo e o topo mostra "—" enquanto nao chega.
  useEffect(() => {
    let ativo = true;
    getMonthlyCmv({ year: String(year), month: String(month) })
      .then((r) => { if (ativo) setCmv(r); })
      .catch(() => { if (ativo) setCmv(null); });
    return () => { ativo = false; };
  }, [year, month]);

  function goToMonth(y: number, m: number) {
    navigate(`/cmv/fechamento-mensal/${toYearMonthParam(y, m)}`);
  }
  function prevMonth() {
    const d = new Date(Date.UTC(year, month - 2, 1));
    goToMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  function nextMonth() {
    const d = new Date(Date.UTC(year, month, 1));
    goToMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }

  async function confirmarJustificativa(reason: string) {
    if (!justificando) return;
    setBusy(true);
    try {
      const updated = await justifyMonthlyClosureBlock(year, month, justificando.key, reason);
      setState(updated);
      setJustificando(null);
      setNotice({ tone: "success", message: "Pendência justificada." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao justificar." });
    } finally {
      setBusy(false);
    }
  }

  async function removeJustification(blockKey: string) {
    setBusy(true);
    try {
      const updated = await removeMonthlyClosureJustification(year, month, blockKey);
      setState(updated);
      setNotice({ tone: "success", message: "Justificativa removida." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao remover." });
    } finally {
      setBusy(false);
    }
  }

  async function lockMonth() {
    setConfirmarTrava(false);
    setBusy(true);
    try {
      const updated = await lockMonthlyClosure(year, month);
      setState(updated);
      setNotice({ tone: "success", message: `Fechamento de ${monthLabel(year, month)} travado.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao travar." });
    } finally {
      setBusy(false);
    }
  }

  async function unlockMonth() {
    const reason = window.prompt(`Reabrir fechamento de ${monthLabel(year, month)}?\n\nMotivo (obrigatório):`);
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      const updated = await unlockMonthlyClosure(year, month, reason.trim());
      setState(updated);
      setNotice({ tone: "success", message: "Fechamento reaberto." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao reabrir." });
    } finally {
      setBusy(false);
    }
  }

  const justificationByKey = useMemo(() => {
    const map = new Map<string, MonthlyClosureState["justifications"][number]>();
    for (const j of (state?.justifications ?? [])) map.set(j.blockKey, j);
    return map;
  }, [state]);

  const suppliersByGroup = useMemo(() => {
    const map = new Map<string, MonthlyClosureState["requiredSuppliers"]>();
    for (const s of (state?.requiredSuppliers ?? [])) {
      const g = s.group || "Outros";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return map;
  }, [state]);

  const resumo = useMemo(
    () => state ? resumirFechamento(state.summary.pending, state.monthEnd) : null,
    [state]
  );
  const progresso = useMemo(
    () => state ? progressoDoMes(state.monthStart, state.monthEnd) : null,
    [state]
  );

  // So a primeira carga mostra esqueleto. Trocar de mes recarrega tudo, e se a
  // tela sumisse a cada troca os proprios botoes de navegacao desapareceriam
  // debaixo do cursor — quem percorre tres meses seguidos clica no vazio.
  if (!state || !resumo || !progresso) {
    return (
      <div className="page">
        <Notice notice={notice} />
        <section className="panel"><p className="muted">Carregando fechamento…</p></section>
      </div>
    );
  }

  const isClosed = state.status === "CLOSED";
  // Vem pronto do razao. Somar salão + iFood + 99 aqui contava o delivery duas
  // vezes, porque o "salão" do backend trazia todo o RevenueEntry dentro.
  const totalRevenueGross = state.revenue.total.grossAmount;

  /** O estado de um bloco, a partir da pendência que ele gera. */
  function estadoDoBloco(chave: string, resolvido: boolean): EstadoDoBloco {
    if (resolvido) return "OK";
    if (justificationByKey.has(chave)) return "JUSTIFICADO";
    const p = resumo!.aguardando.find((x) => x.key === chave);
    return p ? "AGUARDANDO" : "ATENCAO";
  }

  function acaoDeJustificar(chave: string, rotulo: string) {
    const just = justificationByKey.get(chave);
    if (just) {
      return (
        <p className="fm-justificada">
          <span>Justificada: <em>{just.reason}</em></span>
          {canEdit && !isClosed && (
            <button className="link-btn" onClick={() => removeJustification(chave)} disabled={busy}>
              <X size={12} /> remover
            </button>
          )}
        </p>
      );
    }
    if (canEdit && !isClosed) {
      return (
        <Button variant="secondary" onClick={() => setJustificando({ key: chave, label: rotulo })} disabled={busy}>
          Justificar ausência
        </Button>
      );
    }
    return null;
  }

  return (
    <div className={`page fm-page${loading ? " fm-atualizando" : ""}`}>
      <Notice notice={notice} />

      {/* ── O MÊS ─────────────────────────────────────────────────────────── */}
      <section className="panel fm-cabecalho">
        <div className="fm-cabecalho-topo">
          <div className="fm-mes">
            <h2>{monthLabel(year, month)}</h2>
            <p>
              {formatDate(state.monthStart)} a {formatDate(state.monthEnd)}
              {isClosed && state.closedAt && ` · travado em ${formatDate(state.closedAt)}`}
            </p>
            {!isClosed && (
              <div className="fm-progresso" title={`Dia ${progresso.diaAtual} de ${progresso.totalDeDias}`}>
                <div className="fm-progresso-barra">
                  <span style={{ width: `${Math.round(progresso.fracao * 100)}%` }} />
                </div>
                <small>
                  {resumo.mesTerminou
                    ? "Mês encerrado — pronto para conferir"
                    : `Dia ${progresso.diaAtual} de ${progresso.totalDeDias} · mês em andamento`}
                </small>
              </div>
            )}
            {isClosed && <StatusBadge tone="neutral">Fechamento travado</StatusBadge>}
          </div>

          <div className="fm-acoes">
            <Button variant="secondary" onClick={prevMonth}>← Mês anterior</Button>
            <Button variant="secondary" onClick={nextMonth}>Próximo mês →</Button>
            <Button variant="secondary" onClick={load}>Recarregar</Button>
            {canLockMonth && !isClosed && (
              <Button
                onClick={() => setConfirmarTrava(true)}
                disabled={busy || !state.summary.canLock}
                title={!state.summary.canLock ? `${state.summary.pendingCount} pendência(s) sem justificativa` : undefined}
              >
                <Lock size={15} /> Travar mês
              </Button>
            )}
            {canLockMonth && isClosed && (
              <Button variant="secondary" onClick={unlockMonth} disabled={busy}>
                <Unlock size={15} /> Reabrir mês
              </Button>
            )}
          </div>
        </div>

        {/* O resultado. Antes nao aparecia em tela nenhuma do fechamento. */}
        <div className="fm-indicadores">
          {/* CMV = inicial + compras - final. Sem inventario final o "final" e
              zero e a conta devolve inicial + compras, que no meio do mes da
              mais de 100% da receita. Numero errado em destaque e pior que
              numero nenhum: enquanto nao ha contagem, o lugar diz o que falta. */}
          <Indicador
            destaque
            rotulo="CMV do mês"
            valor={cmv && state.finalInventory.hasSnapshot ? <Money value={cmv.realCmvValue} /> : "—"}
            apoio={
              !state.finalInventory.hasSnapshot
                ? "depende do inventário final"
                : cmv ? `${percentual(cmv.cmvPercent)} da receita líquida` : "calculando…"
            }
          />
          <Indicador rotulo="Faturamento bruto" valor={<Money value={totalRevenueGross} />}
            apoio={`${state.revenue.salon.daysCount} dias de salão`} />
          <Indicador rotulo="Compras no mês" valor={<Money value={state.purchases.total} />}
            apoio={`${state.purchases.count} lançamentos`} />
          <Indicador rotulo="Estoque final"
            valor={state.finalInventory.hasSnapshot ? <Money value={state.finalInventory.totalValue} /> : "—"}
            apoio={state.finalInventory.hasSnapshot
              ? `${state.finalInventory.totalItems} itens`
              : "ainda não contado"} />
        </div>
      </section>

      {/* ── PRECISA DE ATENÇÃO ────────────────────────────────────────────── */}
      {resumo.atencao.length > 0 && (
        <section className="panel fm-atencao">
          <header>
            <TriangleAlert size={18} />
            <div>
              <h3>Precisa de atenção</h3>
              <p>
                {resumo.mesTerminou
                  ? "O mês terminou e estes pontos seguem em aberto."
                  : "Isto não depende do mês acabar — já está assim hoje."}
              </p>
            </div>
          </header>
          <ul>
            {resumo.atencao.map((p) => (
              <li key={p.key}>
                <span>{p.label}</span>
                {canEdit && !isClosed && !justificationByKey.has(p.key) && (
                  <button className="link-btn" onClick={() => setJustificando({ key: p.key, label: p.label })} disabled={busy}>
                    Justificar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {resumo.semNadaParaFazer && !isClosed && (
        <Alert tone="success" icon={<CheckCircle2 size={18} />}>
          <strong>Nada pendente de ação.</strong>{" "}
          {resumo.aguardando.length > 0
            ? `${resumo.aguardando.length} ${resumo.aguardando.length === 1 ? "item depende" : "itens dependem"} do mês terminar.`
            : "Tudo conferido — o mês pode ser travado."}
        </Alert>
      )}

      {/* ── AGUARDANDO ────────────────────────────────────────────────────── */}
      {resumo.aguardando.length > 0 && (
        <section className="panel fm-aguardando">
          <header>
            <Clock size={16} />
            <div>
              <h3>Aguardando o mês terminar</h3>
              <p>Normal a esta altura. Vira pendência sozinho quando o mês virar.</p>
            </div>
          </header>
          <ul>
            {resumo.aguardando.map((p) => <li key={p.key}>{p.label}</li>)}
          </ul>
        </section>
      )}

      {/* ── CONFERÊNCIA ───────────────────────────────────────────────────── */}
      <section className="panel">
        <VerificacaoDoFechamento year={year} month={month} />
      </section>

      {/* ── BLOCOS ────────────────────────────────────────────────────────── */}
      <div className="fm-blocos">
        <BlocoDoFechamento
          numero={1}
          titulo="Faturamento"
          estado={estadoDoBloco("block:revenue", !state.summary.pending.some((p) => p.key === "block:revenue"))}
          resumo={<Money value={totalRevenueGross} />}
        >
          <div className="fm-grade">
            <Indicador rotulo="Salão" valor={<Money value={state.revenue.salon.grossAmount} />}
              apoio={`${state.revenue.salon.daysCount} dias · ${state.revenue.salon.entryCount} lançamentos`} />
            <Indicador rotulo="iFood" valor={<Money value={state.revenue.ifood.grossAmount} />}
              apoio={`${state.revenue.ifood.count} vendas`} />
            <Indicador rotulo="99 Food" valor={<Money value={state.revenue.noventaNove.grossAmount} />}
              apoio={`${state.revenue.noventaNove.count} vendas`} />
            {state.revenue.outrosDelivery.grossAmount > 0 && (
              <Indicador rotulo="Outros delivery" valor={<Money value={state.revenue.outrosDelivery.grossAmount} />}
                apoio={state.revenue.outrosDelivery.plataformas.join(" · ")} />
            )}
            <Indicador rotulo="Líquido do mês" valor={<Money value={state.revenue.total.netAmount} />} />
          </div>
          {state.summary.pending.some((p) => p.key === "block:revenue") &&
            acaoDeJustificar("block:revenue", "Faturamento com poucos dias")}
        </BlocoDoFechamento>

        <BlocoDoFechamento
          numero={2}
          titulo="Compras por competência"
          estado="OK"
          resumo={<Money value={state.purchases.total} />}
        >
          {state.purchases.byCategory.length === 0 ? (
            <p className="muted">Nenhuma compra lançada nesta competência.</p>
          ) : (
            <table className="data-table fm-tabela">
              <thead>
                <tr><th>Categoria DRE</th><th className="num">Compras</th><th className="num">#</th></tr>
              </thead>
              <tbody>
                {state.purchases.byCategory.map((c) => (
                  <tr key={c.categoryName}>
                    <td>{c.categoryName}</td>
                    <td className="num"><Money value={c.total} /></td>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BlocoDoFechamento>

        <BlocoDoFechamento
          numero={3}
          titulo="Fornecedores obrigatórios"
          estado={(() => {
            const pendentes = state.requiredSuppliers.filter(
              (s) => s.appliesThisMonth && !s.present && !justificationByKey.has(`supplier:${s.id}`));
            if (pendentes.length === 0) return "OK";
            return resumo.aguardando.some((p) => p.key.startsWith("supplier:")) ? "AGUARDANDO" : "ATENCAO";
          })()}
          resumo={`${state.requiredSuppliers.filter((s) => s.present).length} de ${state.requiredSuppliers.filter((s) => s.appliesThisMonth).length} lançados`}
        >
          {state.requiredSuppliers.length === 0 ? (
            <p className="muted">
              Nenhum fornecedor marcado como obrigatório.{" "}
              <a href="/fornecedores">Marcar em Fornecedores → Regra de fechamento</a>.
            </p>
          ) : (
            Array.from(suppliersByGroup.entries()).map(([group, suppliers]) => (
              <div key={group} className="fm-grupo">
                <h4>{group}</h4>
                <table className="data-table fm-tabela">
                  <thead>
                    <tr><th>Fornecedor</th><th>Frequência</th><th>Situação</th><th className="num">Total</th><th /></tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => {
                      const blockKey = `supplier:${s.id}`;
                      const just = justificationByKey.get(blockKey);
                      const tone = !s.appliesThisMonth ? "neutral" : s.present ? "success" : just ? "warning" : "danger";
                      const texto = !s.appliesThisMonth ? "Não aplica"
                        : s.present ? `Lançado (${s.purchaseCount})`
                        : just ? "Justificado" : "Pendente";
                      return (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td>{frequencyLabel(s.frequency)}</td>
                          <td><StatusBadge tone={tone}>{texto}</StatusBadge></td>
                          <td className="num">{s.present ? <Money value={s.total} /> : "—"}</td>
                          <td className="num">
                            {canEdit && !isClosed && s.appliesThisMonth && !s.present && !just && (
                              <button className="link-btn" disabled={busy}
                                onClick={() => setJustificando({ key: blockKey, label: `Fornecedor: ${s.name}` })}>
                                Justificar
                              </button>
                            )}
                            {canEdit && !isClosed && just && (
                              <button className="link-btn" title={just.reason} disabled={busy}
                                onClick={() => removeJustification(blockKey)}>
                                <X size={12} /> remover
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {suppliers.filter((s) => justificationByKey.has(`supplier:${s.id}`)).map((s) => (
                  <p key={s.id} className="fm-justificada">
                    <span><strong>{s.name}:</strong> <em>{justificationByKey.get(`supplier:${s.id}`)?.reason}</em></span>
                  </p>
                ))}
              </div>
            ))
          )}
        </BlocoDoFechamento>

        <BlocoDoFechamento
          numero={4}
          titulo="Impostos e taxas"
          estado={estadoDoBloco("block:taxes", state.taxes.length > 0)}
          resumo={state.taxes.length > 0 ? `${state.taxes.length} lançamentos` : "nenhum"}
        >
          {state.taxes.length === 0 ? (
            <>
              <p className="muted">Nenhum imposto registrado para {monthLabel(year, month)}.</p>
              {acaoDeJustificar("block:taxes", "Impostos ausentes")}
            </>
          ) : (
            <table className="data-table fm-tabela">
              <thead>
                <tr><th>Tipo</th><th>Descrição</th><th className="num">Valor</th><th>Vencimento</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {state.taxes.map((t) => (
                  <tr key={t.id}>
                    <td>{t.documentType}</td>
                    <td>{t.description ?? "—"}</td>
                    <td className="num"><Money value={t.amount} /></td>
                    <td>{formatDate(t.dueDate)}</td>
                    <td>
                      {t.paymentDate
                        ? <StatusBadge tone="success">{`Pago ${formatDate(t.paymentDate)}`}</StatusBadge>
                        : <StatusBadge tone="warning">{t.status}</StatusBadge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </BlocoDoFechamento>

        <BlocoDoFechamento
          numero={5}
          titulo="Inventário final"
          estado={estadoDoBloco("block:finalInventory", state.finalInventory.hasSnapshot)}
          resumo={state.finalInventory.hasSnapshot
            ? <Money value={state.finalInventory.totalValue} /> : "não contado"}
        >
          {state.finalInventory.hasSnapshot ? (
            <p className="fm-linha-forte">
              <StatusBadge tone="success">{`Contado em ${formatDate(state.finalInventory.countDate)}`}</StatusBadge>
              <Money value={state.finalInventory.totalValue} /> · {state.finalInventory.totalItems} itens
            </p>
          ) : (
            <>
              <p className="muted">Nenhum inventário final para {monthLabel(year, month)}.</p>
              <div className="fm-linha-acoes">
                <a href="/estoque/contagens" className="link-btn">
                  <ExternalLink size={12} /> Ir para Contagem de Estoque
                </a>
                {acaoDeJustificar("block:finalInventory", "Inventário final ausente")}
              </div>
            </>
          )}
        </BlocoDoFechamento>

        <BlocoDoFechamento
          numero={6}
          titulo="CMV atribuído ao mês"
          estado="OK"
          resumo={state.cmvAttribution.breakdown.length > 0
            ? <Money value={state.cmvAttribution.total} /> : "sem ciclo"}
        >
          {state.cmvAttribution.breakdown.length === 0 ? (
            <p className="muted">Nenhum ciclo de CMV Real intercepta este mês. Gere apuração em CMV Real.</p>
          ) : (
            <>
              <p className="fm-nota">Rateio por dias corridos: o ciclo que atravessa a virada entra proporcional.</p>
              <table className="data-table fm-tabela">
                <thead>
                  <tr>
                    <th>Ciclo</th><th>Período</th>
                    <th className="num">Dias no mês</th><th className="num">Dias totais</th>
                    <th className="num">CMV do ciclo</th><th className="num">Contribuição</th>
                  </tr>
                </thead>
                <tbody>
                  {state.cmvAttribution.breakdown.map((c) => (
                    <tr key={c.cmvPeriodId}>
                      <td>{c.code ?? "—"}</td>
                      <td>{formatDate(c.cycleStart)} → {formatDate(c.cycleEnd)}</td>
                      <td className="num">{c.daysInMonth}</td>
                      <td className="num">{c.totalDays}</td>
                      <td className="num"><Money value={c.cmvReal} /></td>
                      <td className="num forte"><Money value={c.contribution} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </BlocoDoFechamento>
      </div>

      {state.justifications.length > 0 && (
        <section className="panel fm-justificativas">
          <h3>Justificativas registradas</h3>
          <ul>
            {state.justifications.map((j) => (
              <li key={j.blockKey}>
                <span className="fm-just-motivo">{j.reason}</span>
                <span className="fm-just-data">{formatDate(j.justifiedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <JustificarDialog
        aberto={justificando != null}
        pendencia={justificando?.label ?? null}
        enviando={busy}
        onCancelar={() => setJustificando(null)}
        onConfirmar={confirmarJustificativa}
      />

      <ConfirmDialog
        open={confirmarTrava}
        title={`Travar ${monthLabel(year, month)}?`}
        description={`Compras, baixas de contas a pagar, faturamento e inventário com data em ${String(month).padStart(2, "0")}/${year} passam a ser recusados até o mês ser reaberto.`}
        confirmLabel="Travar mês"
        onConfirm={lockMonth}
        onCancel={() => setConfirmarTrava(false)}
      />
    </div>
  );
}
