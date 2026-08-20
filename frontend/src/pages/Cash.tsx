import { AlertTriangle, BadgeDollarSign, CheckCircle2, ChevronLeft, Store, Truck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppUser, closeDailyRevenue, getRevenueEntry, RevenueEntry, saveRevenueEntry } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Button, Money, PanelEyebrow, StatusBadge } from "../design-system";
import { hasPermission } from "../lib/permissions";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function splitDate(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function nv(value: string) {
  return Number(value || 0);
}

type CashProps = {
  user: AppUser;
  entryId?: string | null;
  onOpenRevenue?: () => void;
};

type ShiftFields = {
  cash: string;
  pix: string;
  card: string;
  ticket: string;
  service: string;
  tcs: string;
};

type SalonMeta = {
  description: string;
  repiqueAmount: string;
  discounts: string;
  platformFees: string;
  notes: string;
};

type DeliveryPlatformKey = "food99" | "ifood" | "keeta" | "retiradaBalcao" | "outrosDelivery";

const deliveryPlatforms: Array<{ key: DeliveryPlatformKey; label: string; sourcePlatform: string }> = [
  { key: "food99", label: "99Food", sourcePlatform: "99Food" },
  { key: "ifood", label: "iFood", sourcePlatform: "iFood" },
  { key: "keeta", label: "Keeta", sourcePlatform: "Keeta" },
  { key: "retiradaBalcao", label: "Retirada Balcão", sourcePlatform: "RetiradaBalcao" },
  { key: "outrosDelivery", label: "Outros", sourcePlatform: "OutrosDelivery" }
];

const emptyShift = (): ShiftFields => ({ cash: "", pix: "", card: "", ticket: "", service: "", tcs: "" });
const emptyMeta = (): SalonMeta => ({ description: "", repiqueAmount: "", discounts: "0", platformFees: "0", notes: "" });
const emptyDelivery = (): Record<DeliveryPlatformKey, { orders: string; earnings: string }> => ({
  food99: { orders: "", earnings: "" },
  ifood: { orders: "", earnings: "" },
  keeta: { orders: "", earnings: "" },
  retiradaBalcao: { orders: "", earnings: "" },
  outrosDelivery: { orders: "", earnings: "" }
});

function shiftTotal(shift: ShiftFields) {
  return nv(shift.cash) + nv(shift.pix) + nv(shift.card) + nv(shift.ticket) + nv(shift.service) + nv(shift.tcs);
}

function CashStatusCard({ label, status, detail, icon, tone }: { label: string; status: string; detail: string; icon: JSX.Element; tone: string }) {
  return (
    <article className={`summary-card compact-summary-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{status}</strong>
        <small>{detail}</small>
      </div>
      {icon}
    </article>
  );
}

function ShiftCard({
  label,
  shift,
  onChange,
  disabled
}: {
  label: string;
  shift: ShiftFields;
  onChange: (next: ShiftFields) => void;
  disabled: boolean;
}) {
  const total = shiftTotal(shift);
  const set = (key: keyof ShiftFields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...shift, [key]: e.target.value });
  return (
    <div className="cash-shift-card">
      <div className="cash-shift-header">
        <h3>{label}</h3>
        <StatusBadge tone="info">Total <Money value={total} /></StatusBadge>
      </div>
      <div className="form-grid cash-shift-grid">
        <label>Dinheiro<input type="number" min="0" step="0.01" inputMode="decimal" value={shift.cash} onChange={set("cash")} disabled={disabled} /></label>
        <label>Pix<input type="number" min="0" step="0.01" inputMode="decimal" value={shift.pix} onChange={set("pix")} disabled={disabled} /></label>
        <label>Cartão<input type="number" min="0" step="0.01" inputMode="decimal" value={shift.card} onChange={set("card")} disabled={disabled} /></label>
        <label>Ticket<input type="number" min="0" step="0.01" inputMode="decimal" value={shift.ticket} onChange={set("ticket")} disabled={disabled} /></label>
        <label>Serviço<input type="number" min="0" step="0.01" inputMode="decimal" value={shift.service} onChange={set("service")} disabled={disabled} /></label>
        <label>TC's<input type="number" min="0" step="0.01" inputMode="decimal" value={shift.tcs} onChange={set("tcs")} disabled={disabled} /></label>
      </div>
    </div>
  );
}

export function Cash({ user, entryId, onOpenRevenue }: CashProps) {
  // A tela do Caixa grava RevenueEntry (Delivery), entao depende do modulo Faturamento
  // alem do proprio Caixa. Sem os dois, os botoes apareceriam e dariam 403.
  const canEdit = hasPermission(user, "cash", "edit")
    && hasPermission(user, "revenue", "create")
    && hasPermission(user, "revenue", "edit");
  const { notice, setNotice } = useNotice();
  const [loading, setLoading] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentEntry, setCurrentEntry] = useState<RevenueEntry | null>(null);
  const [date, setDate] = useState(today());
  const [activeShift, setActiveShift] = useState<1 | 2>(1);
  const [shift1, setShift1] = useState<ShiftFields>(emptyShift());
  const [shift2, setShift2] = useState<ShiftFields>(emptyShift());
  const [meta, setMeta] = useState<SalonMeta>(emptyMeta());
  const [delivery, setDelivery] = useState(emptyDelivery());
  const [dailyStatus, setDailyStatus] = useState({ salon: false, delivery: false });

  const title = useMemo(() => (editingId ? "Editar fechamento diário" : "Checklist diário do caixa"), [editingId]);

  // Salon computed
  const shift1Total = shiftTotal(shift1);
  const shift2Total = shiftTotal(shift2);
  const totalMesas = shift1Total + shift2Total;
  const totalService = nv(shift1.service) + nv(shift2.service);
  const totalTcs = nv(shift1.tcs) + nv(shift2.tcs);
  const salonNet = totalMesas - nv(meta.discounts) - nv(meta.platformFees);

  // Delivery computed
  const totalDelivery = deliveryPlatforms.reduce((sum, p) => sum + nv(delivery[p.key].earnings), 0);
  const totalOrders = deliveryPlatforms.reduce((sum, p) => sum + Math.trunc(nv(delivery[p.key].orders)), 0);

  // Summary
  const totalGeral = totalMesas + totalDelivery;

  const closeReady = dailyStatus.salon && dailyStatus.delivery;
  const closingChecklist = useMemo(() => {
    const items = [];
    if (!dailyStatus.salon) items.push("Lançar faturamento das mesas.");
    if (!dailyStatus.delivery) items.push("Lançar delivery.");
    return items;
  }, [dailyStatus]);

  function resetAll() {
    setEditingId(null);
    setCurrentEntry(null);
    setDate(today());
    setShift1(emptyShift());
    setShift2(emptyShift());
    setMeta(emptyMeta());
    setDelivery(emptyDelivery());
    setDailyStatus({ salon: false, delivery: false });
  }

  useEffect(() => {
    let active = true;
    if (!entryId) {
      resetAll();
      return () => { active = false; };
    }

    setLoadingEntry(true);
    getRevenueEntry(entryId)
      .then((entry) => {
        if (!active) return;
        setCurrentEntry(entry);
        setEditingId(entry.id);
        setDate(String(entry.date).slice(0, 10));

        if (entry.channel === "Delivery") {
          setShift1(emptyShift());
          setShift2(emptyShift());
          setMeta(emptyMeta());
          setDailyStatus({ salon: false, delivery: true });
          const d = emptyDelivery();
          for (const p of deliveryPlatforms) {
            if (entry.sourcePlatform === p.sourcePlatform) {
              d[p.key] = { orders: String(entry.tickets ?? ""), earnings: String(entry.grossAmount ?? "") };
            }
          }
          setDelivery(d);
        } else {
          setDelivery(emptyDelivery());
          setDailyStatus({ salon: true, delivery: false });
          // Load per-shift fields if available, else zeroes
          setShift1({
            cash: String(entry.shift1Cash ?? ""),
            pix: String(entry.shift1Pix ?? ""),
            card: String(entry.shift1Card ?? ""),
            ticket: String(entry.shift1Ticket ?? ""),
            service: String(entry.shift1Service ?? ""),
            tcs: String(entry.shift1Tcs ?? "")
          });
          setShift2({
            cash: String(entry.shift2Cash ?? ""),
            pix: String(entry.shift2Pix ?? ""),
            card: String(entry.shift2Card ?? ""),
            ticket: String(entry.shift2Ticket ?? ""),
            service: String(entry.shift2Service ?? ""),
            tcs: String(entry.shift2Tcs ?? "")
          });
          setMeta({
            description: entry.description ?? "",
            repiqueAmount: String(entry.repiqueAmount ?? ""),
            discounts: String(entry.discounts ?? "0"),
            platformFees: String(entry.platformFees ?? "0"),
            notes: entry.notes ?? ""
          });
        }
      })
      .catch((error) => {
        if (!active) return;
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar faturamento." });
        resetAll();
      })
      .finally(() => { if (active) setLoadingEntry(false); });

    return () => { active = false; };
  }, [entryId, setNotice]);

  async function handleSaveDelivery() {
    try {
      setLoading(true);
      const { year, month } = splitDate(date);
      let saved = 0;
      for (const platform of deliveryPlatforms) {
        const orders = Math.trunc(nv(delivery[platform.key].orders));
        const earnings = nv(delivery[platform.key].earnings);
        if (orders <= 0 && earnings <= 0) continue;
        await saveRevenueEntry({
          id: currentEntry?.channel === "Delivery" && currentEntry.sourcePlatform === platform.sourcePlatform ? editingId ?? undefined : undefined,
          date,
          competenceYear: year,
          competenceMonth: month,
          channel: "Delivery",
          sourcePlatform: platform.sourcePlatform,
          description: `Delivery ${platform.label}`,
          grossAmount: earnings,
          discounts: 0,
          platformFees: 0,
          netAmount: earnings,
          serviceAmount: 0,
          tickets: orders,
          ticketAverage: orders > 0 ? earnings / orders : null,
          paymentMethod: platform.label,
          notes: "Lançamento diário de delivery"
        });
        saved += 1;
      }
      // Se nenhuma plataforma teve valor, registra delivery zerado sem bloqueio
      if (saved === 0) {
        await saveRevenueEntry({
          date,
          competenceYear: year,
          competenceMonth: month,
          channel: "Delivery",
          sourcePlatform: "DeliveryZero",
          description: "Delivery confirmado sem faturamento",
          grossAmount: 0,
          discounts: 0,
          platformFees: 0,
          netAmount: 0,
          serviceAmount: 0,
          tickets: 0,
          ticketAverage: null,
          paymentMethod: "Delivery zero",
          notes: "Confirmação operacional de delivery zerado"
        });
        setDailyStatus((c) => ({ ...c, delivery: true }));
        setNotice({ tone: "info", message: `Delivery informado como R$ 0,00 para ${date}.` });
        return;
      }
      setDailyStatus((c) => ({ ...c, delivery: true }));
      setNotice({ tone: "success", message: "Faturamento de delivery lançado por plataforma." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao salvar delivery." });
    } finally {
      setLoading(false);
    }
  }

  async function handleCloseDay() {
    try {
      await closeDailyRevenue(date);
      setDailyStatus({ salon: true, delivery: true });
      setNotice({ tone: "success", message: "Fechamento diário confirmado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Não foi possível fechar o dia." });
    }
  }

  const disabled = !canEdit || loading || loadingEntry;

  return (
    <div className="stack">
      <Notice notice={notice} />

      {/* Cabeçalho */}
      <section className="panel cash-workspace">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Caixa</PanelEyebrow>
            <h2>{title}</h2>
          </div>
          <div className="actions-cell">
            {onOpenRevenue && (
              <Button variant="secondary" leadingIcon={<ChevronLeft size={16} />} onClick={onOpenRevenue}>
                Voltar para faturamento
              </Button>
            )}
            <Button variant="secondary" onClick={resetAll} disabled={disabled}>Novo dia</Button>
          </div>
        </div>

        <div className="cash-toolbar">
          <label>
            Data do lançamento
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={disabled} />
          </label>
          <div className="cash-toolbar-actions">
            <Button leadingIcon={<CheckCircle2 size={16} />} onClick={handleCloseDay} disabled={disabled || !closeReady}>
              Fechar caixa
            </Button>
          </div>
        </div>

        <div className="summary-grid dashboard-compact-grid cash-status-chips-grid">
          <CashStatusCard
            label="Mesas"
            status={dailyStatus.salon ? "Concluído" : "Pendente"}
            detail={dailyStatus.salon ? "Turnos lançados para a data." : "Preencha 1º e 2º turno."}
            tone={dailyStatus.salon ? "tone-success" : "tone-warning"}
            icon={<Store className="summary-card-icon" size={20} />}
          />
          <CashStatusCard
            label="Delivery"
            status={dailyStatus.delivery ? "Concluído" : "Pendente"}
            detail={dailyStatus.delivery ? "Plataformas confirmadas." : "Lance ou salve delivery zerado."}
            tone={dailyStatus.delivery ? "tone-success" : "tone-warning"}
            icon={<Truck className="summary-card-icon" size={20} />}
          />
          <CashStatusCard
            label="Fechamento"
            status={closeReady ? "Liberado" : "Bloqueado"}
            detail={closeReady ? "Checklist completo." : "Pendente de lançamentos."}
            tone={closeReady ? "tone-info" : "tone-danger"}
            icon={<Wallet className="summary-card-icon" size={20} />}
          />
        </div>

        {!closeReady && (
          <div className="alert warning compact-alert">
            <AlertTriangle className="alert-icon" size={18} />
            <div>
              <strong>Fechamento ainda não liberado.</strong>
              <span>{closingChecklist.join(" ")}</span>
            </div>
          </div>
        )}

        {loadingEntry && <p className="muted-inline subsection">Carregando lançamento selecionado...</p>}
      </section>

      {/* Mesas */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Etapa 1</PanelEyebrow>
            <h2>Mesas</h2>
          </div>
          <div className="actions-cell">
            <span className="muted-inline">
              O faturamento do Salão é lançado automaticamente pelo agente do Agile PDV;
              os valores abaixo servem para conferência.
            </span>
          </div>
        </div>

        <div className="cash-shifts-container">
          <div className="cash-shift-tabs">
            <button
              type="button"
              className={`cash-shift-tab${activeShift === 1 ? " active" : ""}`}
              onClick={() => setActiveShift(1)}
            >
              <span>1º Turno</span>
              <span className="cash-shift-tab-total"><Money value={shift1Total} /></span>
            </button>
            <button
              type="button"
              className={`cash-shift-tab${activeShift === 2 ? " active" : ""}`}
              onClick={() => setActiveShift(2)}
            >
              <span>2º Turno</span>
              <span className="cash-shift-tab-total"><Money value={shift2Total} /></span>
            </button>
          </div>
          <div className="cash-shift-pane" data-active={String(activeShift === 1)}>
            <ShiftCard label="1º Turno" shift={shift1} onChange={setShift1} disabled={disabled} />
          </div>
          <div className="cash-shift-pane" data-active={String(activeShift === 2)}>
            <ShiftCard label="2º Turno" shift={shift2} onChange={setShift2} disabled={disabled} />
          </div>
        </div>

        <div className="form-grid cash-meta-grid">
          <label>
            Repique
            <input type="number" min="0" step="0.01" inputMode="decimal" value={meta.repiqueAmount} onChange={(e) => setMeta({ ...meta, repiqueAmount: e.target.value })} disabled={disabled} />
          </label>
          <label>
            Descontos
            <input type="number" min="0" step="0.01" inputMode="decimal" value={meta.discounts} onChange={(e) => setMeta({ ...meta, discounts: e.target.value })} disabled={disabled} />
          </label>
          <label>
            Taxas
            <input type="number" min="0" step="0.01" inputMode="decimal" value={meta.platformFees} onChange={(e) => setMeta({ ...meta, platformFees: e.target.value })} disabled={disabled} />
          </label>
          <label>
            Descrição
            <input value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} disabled={disabled} />
          </label>
          <label className="full-width">
            Observações
            <input value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} disabled={disabled} />
          </label>
        </div>
      </section>

      {/* Delivery */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Etapa 2</PanelEyebrow>
            <h2>Delivery</h2>
          </div>
          <div className="actions-cell">
            <button className="primary-button" type="button" onClick={handleSaveDelivery} disabled={disabled}>
              <BadgeDollarSign size={16} /> {loading ? "Salvando..." : "Lançar delivery"}
            </button>
          </div>
        </div>

        <div className="cash-delivery-grid">
          {deliveryPlatforms.map((platform) => {
            const orders = Math.trunc(nv(delivery[platform.key].orders));
            const earnings = nv(delivery[platform.key].earnings);
            const avg = orders > 0 ? earnings / orders : 0;
            return (
              <article className="cash-platform-card" key={platform.key}>
                <div className="cash-platform-header">
                  <h3>{platform.label}</h3>
                  {orders > 0 && <StatusBadge tone="info">Ticket médio <Money value={avg} /></StatusBadge>}
                </div>
                <div className="form-grid cash-platform-fields">
                  <label>
                    Pedidos
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={delivery[platform.key].orders}
                      onChange={(e) => setDelivery({ ...delivery, [platform.key]: { ...delivery[platform.key], orders: e.target.value } })}
                      disabled={disabled}
                    />
                  </label>
                  <label>
                    Valor (R$)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={delivery[platform.key].earnings}
                      onChange={(e) => setDelivery({ ...delivery, [platform.key]: { ...delivery[platform.key], earnings: e.target.value } })}
                      disabled={disabled}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>

        <div className="summary-grid dashboard-compact-grid cash-metrics-grid">
          <article><span>Pedidos totais</span><strong>{totalOrders}</strong></article>
          <article><span>Total delivery</span><strong><Money value={totalDelivery} /></strong></article>
        </div>
      </section>

      {/* Resumo do dia */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Resumo</PanelEyebrow>
            <h2>Totais do dia</h2>
          </div>
        </div>
        <div className="summary-grid dashboard-compact-grid cash-metrics-grid">
          <article><span>Mesas 1º turno</span><strong><Money value={shift1Total} /></strong></article>
          <article><span>Mesas 2º turno</span><strong><Money value={shift2Total} /></strong></article>
          <article><span>Total mesas</span><strong><Money value={totalMesas} /></strong></article>
          <article><span>Total delivery</span><strong><Money value={totalDelivery} /></strong></article>
          <article><span>Total serviço</span><strong><Money value={totalService} /></strong></article>
          <article><span>Total TC's</span><strong><Money value={totalTcs} /></strong></article>
          <article className="cash-total-geral"><span>Total geral do dia</span><strong><Money value={totalGeral} /></strong></article>
        </div>
      </section>

      {!canEdit && (
        <p className="muted-inline">Seu perfil não tem permissão para alterar este módulo.</p>
      )}
    </div>
  );
}
