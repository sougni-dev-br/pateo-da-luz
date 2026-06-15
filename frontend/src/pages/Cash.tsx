import { AlertTriangle, BadgeDollarSign, CheckCircle2, ChevronLeft, Store, Truck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppUser, closeDailyRevenue, getRevenueEntry, RevenueEntry, saveRevenueEntry } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { formatCurrency } from "../utils/format";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function splitDate(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function numberValue(value: string) {
  return Number(value || 0);
}

function averageAmount(amount: number, quantity: number) {
  return quantity > 0 ? amount / quantity : 0;
}

type CashProps = {
  user: AppUser;
  entryId?: string | null;
  onOpenRevenue?: () => void;
};

type DeliveryPlatformKey = "food99" | "ifood" | "keeta";

const deliveryPlatforms: Array<{ key: DeliveryPlatformKey; label: string; sourcePlatform: string }> = [
  { key: "food99", label: "99Food", sourcePlatform: "99Food" },
  { key: "ifood", label: "iFood", sourcePlatform: "iFood" },
  { key: "keeta", label: "Keeta", sourcePlatform: "Keeta" }
];

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

export function Cash({ user, entryId, onOpenRevenue }: CashProps) {
  const canEdit = hasPermission(user, "cash", "edit");
  const { notice, setNotice } = useNotice();
  const [loading, setLoading] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentEntry, setCurrentEntry] = useState<RevenueEntry | null>(null);
  const [date, setDate] = useState(today());
  const [salon, setSalon] = useState({
    description: "",
    salesFirstShift: "",
    ticketsFirstShift: "",
    salesSecondShift: "",
    ticketsSecondShift: "",
    serviceAmount: "",
    repiqueAmount: "",
    discounts: "0",
    platformFees: "0",
    cashAmount: "",
    pixAmount: "",
    debitAmount: "",
    creditAmount: "",
    voucherAmount: "",
    notes: ""
  });
  const [delivery, setDelivery] = useState<Record<DeliveryPlatformKey, { orders: string; earnings: string }>>({
    food99: { orders: "", earnings: "" },
    ifood: { orders: "", earnings: "" },
    keeta: { orders: "", earnings: "" }
  });
  const [deliveryZeroConfirmed, setDeliveryZeroConfirmed] = useState(false);
  const [dailyStatus, setDailyStatus] = useState({ salon: false, delivery: false });

  const title = useMemo(() => (editingId ? "Editar fechamento diário" : "Checklist diário do caixa"), [editingId]);
  const salonGross = numberValue(salon.salesFirstShift) + numberValue(salon.salesSecondShift);
  const salonTickets = Math.trunc(numberValue(salon.ticketsFirstShift) + numberValue(salon.ticketsSecondShift));
  const salonNet = salonGross - numberValue(salon.serviceAmount) - numberValue(salon.discounts) - numberValue(salon.platformFees);
  const salonTicketAverage = salonTickets > 0 ? salonGross / salonTickets : 0;
  const salonReceiptTotal = numberValue(salon.cashAmount) + numberValue(salon.pixAmount) + numberValue(salon.debitAmount) + numberValue(salon.creditAmount) + numberValue(salon.voucherAmount);
  const salonDifference = salonGross - salonReceiptTotal;
  const deliveryGross = deliveryPlatforms.reduce((sum, platform) => sum + numberValue(delivery[platform.key].earnings), 0);
  const deliveryOrders = deliveryPlatforms.reduce((sum, platform) => sum + Math.trunc(numberValue(delivery[platform.key].orders)), 0);
  const deliveryTicketAverage = averageAmount(deliveryGross, deliveryOrders);
  const closeReady = dailyStatus.salon && dailyStatus.delivery;

  const closingChecklist = useMemo(() => {
    const items = [];
    if (!dailyStatus.salon) items.push("Lançar faturamento do salão.");
    if (!dailyStatus.delivery) items.push("Lançar ou confirmar delivery zerado.");
    return items;
  }, [dailyStatus.delivery, dailyStatus.salon]);

  function resetSalon() {
    setSalon({
      description: "",
      salesFirstShift: "",
      ticketsFirstShift: "",
      salesSecondShift: "",
      ticketsSecondShift: "",
      serviceAmount: "",
      repiqueAmount: "",
      discounts: "0",
      platformFees: "0",
      cashAmount: "",
      pixAmount: "",
      debitAmount: "",
      creditAmount: "",
      voucherAmount: "",
      notes: ""
    });
  }

  function resetDelivery() {
    setDelivery({
      food99: { orders: "", earnings: "" },
      ifood: { orders: "", earnings: "" },
      keeta: { orders: "", earnings: "" }
    });
  }

  function openCreate() {
    setEditingId(null);
    setCurrentEntry(null);
    setDate(today());
    resetSalon();
    resetDelivery();
    setDeliveryZeroConfirmed(false);
    setDailyStatus({ salon: false, delivery: false });
  }

  useEffect(() => {
    let active = true;
    if (!entryId) {
      openCreate();
      return () => {
        active = false;
      };
    }

    setLoadingEntry(true);
    getRevenueEntry(entryId)
      .then((entry) => {
        if (!active) return;
        setCurrentEntry(entry);
        setEditingId(entry.id);
        setDate(String(entry.date).slice(0, 10));
        if (entry.channel === "Delivery") {
          resetSalon();
          setDailyStatus({ salon: false, delivery: true });
          setDelivery({
            food99: entry.sourcePlatform === "99Food" ? { orders: String(entry.tickets ?? ""), earnings: String(entry.grossAmount ?? "") } : { orders: "", earnings: "" },
            ifood: entry.sourcePlatform === "iFood" ? { orders: String(entry.tickets ?? ""), earnings: String(entry.grossAmount ?? "") } : { orders: "", earnings: "" },
            keeta: entry.sourcePlatform === "Keeta" ? { orders: String(entry.tickets ?? ""), earnings: String(entry.grossAmount ?? "") } : { orders: "", earnings: "" }
          });
        } else {
          resetDelivery();
          setDailyStatus({ salon: true, delivery: false });
          setSalon({
            description: entry.description ?? "",
            salesFirstShift: String(entry.salesFirstShift ?? ""),
            ticketsFirstShift: String(entry.ticketsFirstShift ?? ""),
            salesSecondShift: String(entry.salesSecondShift ?? ""),
            ticketsSecondShift: String(entry.ticketsSecondShift ?? ""),
            serviceAmount: String(entry.serviceAmount ?? ""),
            repiqueAmount: String(entry.repiqueAmount ?? ""),
            discounts: String(entry.discounts ?? "0"),
            platformFees: String(entry.platformFees ?? "0"),
            cashAmount: String(entry.cashAmount ?? ""),
            pixAmount: String(entry.pixAmount ?? ""),
            debitAmount: String(entry.debitAmount ?? ""),
            creditAmount: String(entry.creditAmount ?? ""),
            voucherAmount: String(entry.voucherAmount ?? ""),
            notes: entry.notes ?? ""
          });
        }
      })
      .catch((error) => {
        if (!active) return;
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar faturamento." });
        openCreate();
      })
      .finally(() => {
        if (active) setLoadingEntry(false);
      });

    return () => {
      active = false;
    };
  }, [entryId, setNotice]);

  async function handleSaveSalon() {
    try {
      setLoading(true);
      const { year, month } = splitDate(date);
      await saveRevenueEntry({
        id: currentEntry?.channel === "Delivery" ? undefined : editingId ?? undefined,
        date,
        competenceYear: year,
        competenceMonth: month,
        channel: "Salao",
        sourcePlatform: null,
        description: salon.description || "Faturamento Salão",
        grossAmount: salonGross,
        discounts: numberValue(salon.discounts),
        platformFees: numberValue(salon.platformFees),
        netAmount: salonNet,
        serviceAmount: numberValue(salon.serviceAmount),
        tickets: salonTickets,
        ticketAverage: salonTickets > 0 ? salonGross / salonTickets : null,
        salesFirstShift: numberValue(salon.salesFirstShift),
        ticketsFirstShift: Math.trunc(numberValue(salon.ticketsFirstShift)),
        salesSecondShift: numberValue(salon.salesSecondShift),
        ticketsSecondShift: Math.trunc(numberValue(salon.ticketsSecondShift)),
        repiqueAmount: numberValue(salon.repiqueAmount),
        paymentMethod: "Recebimentos detalhados",
        cashAmount: numberValue(salon.cashAmount),
        pixAmount: numberValue(salon.pixAmount),
        debitAmount: numberValue(salon.debitAmount),
        creditAmount: numberValue(salon.creditAmount),
        voucherAmount: numberValue(salon.voucherAmount),
        notes: salon.notes
      });
      setDailyStatus((current) => ({ ...current, salon: true }));
      setNotice({ tone: "success", message: editingId ? "Faturamento do salão atualizado." : "Faturamento do salão lançado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao salvar faturamento do salão." });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveDelivery() {
    try {
      setLoading(true);
      const { year, month } = splitDate(date);
      let saved = 0;
      for (const platform of deliveryPlatforms) {
        const orders = Math.trunc(numberValue(delivery[platform.key].orders));
        const earnings = numberValue(delivery[platform.key].earnings);
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
      if (saved === 0) {
        if (!deliveryZeroConfirmed) {
          setNotice({ tone: "warning", message: "Informe ao menos uma plataforma de delivery ou confirme delivery zerado." });
          return;
        }
        if (!window.confirm(`Confirmar delivery com valor zero em ${date}? Nenhum item será lançado sem essa confirmação.`)) {
          return;
        }
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
      }
      setDailyStatus((current) => ({ ...current, delivery: true }));
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
      setNotice({ tone: "success", message: "Fechamento diário confirmado com Salão e Delivery lançados." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Não foi possível fechar o dia." });
    }
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel cash-workspace">
        <div className="section-heading">
          <div>
            <p>Caixa</p>
            <h2>{title}</h2>
          </div>
          <div className="actions-cell">
            {onOpenRevenue && (
              <button className="secondary-button" type="button" onClick={onOpenRevenue}>
                <ChevronLeft size={16} /> Voltar para faturamento
              </button>
            )}
            <button className="secondary-button" type="button" onClick={openCreate} disabled={!canEdit || loading || loadingEntry}>
              Novo dia
            </button>
          </div>
        </div>

        <div className="cash-toolbar">
          <label>
            Data do lançamento
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <div className="cash-toolbar-actions">
            <button className="primary-button" type="button" onClick={handleCloseDay} disabled={!canEdit || loading || loadingEntry || !closeReady}>
              <CheckCircle2 size={16} /> Fechar caixa
            </button>
          </div>
        </div>

        <div className="summary-grid dashboard-compact-grid">
          <CashStatusCard
            label="Salão"
            status={dailyStatus.salon ? "Concluído" : "Pendente"}
            detail={dailyStatus.salon ? "Faturamento lançado para a data." : "Ainda falta registrar vendas e recebimentos."}
            tone={dailyStatus.salon ? "tone-success" : "tone-warning"}
            icon={<Store className="summary-card-icon" size={20} />}
          />
          <CashStatusCard
            label="Delivery"
            status={dailyStatus.delivery ? "Concluído" : "Pendente"}
            detail={dailyStatus.delivery ? "Plataformas confirmadas para a data." : "Lance pedidos ou confirme zero."}
            tone={dailyStatus.delivery ? "tone-success" : "tone-warning"}
            icon={<Truck className="summary-card-icon" size={20} />}
          />
          <CashStatusCard
            label="Fechamento"
            status={closeReady ? "Liberado" : "Bloqueado"}
            detail={closeReady ? "Checklist completo para concluir o dia." : "Dependente dos lançamentos obrigatórios."}
            tone={closeReady ? "tone-info" : "tone-danger"}
            icon={<Wallet className="summary-card-icon" size={20} />}
          />
        </div>

        {!closeReady && (
          <div className="alert warning compact-alert">
            <AlertTriangle className="alert-icon" size={18} />
            <div>
              <strong>O fechamento ainda não está liberado.</strong>
              <span>{closingChecklist.join(" ")}</span>
            </div>
          </div>
        )}

        {loadingEntry && <p className="muted-inline subsection">Carregando lançamento selecionado...</p>}
      </section>

      <section className="cash-sections-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Etapa 1</p>
              <h2>Faturamento do salão</h2>
            </div>
            <div className="actions-cell">
              <button className="primary-button" type="button" onClick={handleSaveSalon} disabled={!canEdit || loading || loadingEntry}>
                <BadgeDollarSign size={16} /> {loading ? "Salvando..." : "Lançar salão"}
              </button>
            </div>
          </div>

          <div className="form-grid payment-grid">
            <label>
              1º turno vendas
              <input type="number" min="0" step="0.01" value={salon.salesFirstShift} onChange={(event) => setSalon({ ...salon, salesFirstShift: event.target.value })} />
            </label>
            <label>
              1º turno TC's
              <input type="number" min="0" step="1" value={salon.ticketsFirstShift} onChange={(event) => setSalon({ ...salon, ticketsFirstShift: event.target.value })} />
            </label>
            <label>
              2º turno vendas
              <input type="number" min="0" step="0.01" value={salon.salesSecondShift} onChange={(event) => setSalon({ ...salon, salesSecondShift: event.target.value })} />
            </label>
            <label>
              2º turno TC's
              <input type="number" min="0" step="1" value={salon.ticketsSecondShift} onChange={(event) => setSalon({ ...salon, ticketsSecondShift: event.target.value })} />
            </label>
            <label>
              Serviço
              <input type="number" min="0" step="0.01" value={salon.serviceAmount} onChange={(event) => setSalon({ ...salon, serviceAmount: event.target.value })} />
            </label>
            <label>
              Repique
              <input type="number" min="0" step="0.01" value={salon.repiqueAmount} onChange={(event) => setSalon({ ...salon, repiqueAmount: event.target.value })} />
            </label>
            <label>
              Descontos
              <input type="number" min="0" step="0.01" value={salon.discounts} onChange={(event) => setSalon({ ...salon, discounts: event.target.value })} />
            </label>
            <label>
              Taxas
              <input type="number" min="0" step="0.01" value={salon.platformFees} onChange={(event) => setSalon({ ...salon, platformFees: event.target.value })} />
            </label>
            <label>
              Dinheiro
              <input type="number" min="0" step="0.01" value={salon.cashAmount} onChange={(event) => setSalon({ ...salon, cashAmount: event.target.value })} />
            </label>
            <label>
              Pix
              <input type="number" min="0" step="0.01" value={salon.pixAmount} onChange={(event) => setSalon({ ...salon, pixAmount: event.target.value })} />
            </label>
            <label>
              Cartão de débito
              <input type="number" min="0" step="0.01" value={salon.debitAmount} onChange={(event) => setSalon({ ...salon, debitAmount: event.target.value })} />
            </label>
            <label>
              Crédito
              <input type="number" min="0" step="0.01" value={salon.creditAmount} onChange={(event) => setSalon({ ...salon, creditAmount: event.target.value })} />
            </label>
            <label>
              Voucher
              <input type="number" min="0" step="0.01" value={salon.voucherAmount} onChange={(event) => setSalon({ ...salon, voucherAmount: event.target.value })} />
            </label>
            <label>
              Descrição
              <input value={salon.description} onChange={(event) => setSalon({ ...salon, description: event.target.value })} />
            </label>
            <label className="full-width">
              Observações
              <input value={salon.notes} onChange={(event) => setSalon({ ...salon, notes: event.target.value })} />
            </label>
          </div>

          <div className="summary-grid dashboard-compact-grid cash-metrics-grid">
            <article><span>Venda total calculada</span><strong>{formatCurrency(salonGross)}</strong></article>
            <article><span>Tickets totais</span><strong>{salonTickets}</strong></article>
            <article><span>Ticket médio</span><strong>{formatCurrency(salonTicketAverage)}</strong></article>
            <article><span>Líquido sem serviço</span><strong>{formatCurrency(salonNet)}</strong></article>
            <article><span>Recebimentos informados</span><strong>{formatCurrency(salonReceiptTotal)}</strong></article>
            <article className={Math.abs(salonDifference) > 0.009 ? "cash-alert-card" : ""}>
              <span>Diferença venda x recebimento</span>
              <strong>{formatCurrency(salonDifference)}</strong>
            </article>
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Etapa 2</p>
              <h2>Faturamento delivery</h2>
            </div>
            <div className="actions-cell">
              <button className="primary-button" type="button" onClick={handleSaveDelivery} disabled={!canEdit || loading || loadingEntry}>
                <BadgeDollarSign size={16} /> {loading ? "Salvando..." : "Lançar delivery"}
              </button>
            </div>
          </div>

          <div className="alert info compact-alert">
            <Truck className="alert-icon" size={18} />
            <div>
              <strong>Operação rápida</strong>
              <span>Preencha pedidos e ganhos por plataforma. Se não houve delivery no dia, confirme explicitamente o zero.</span>
            </div>
          </div>

          <label className="checkbox-label cash-zero-confirm">
            <input type="checkbox" checked={deliveryZeroConfirmed} onChange={(event) => setDeliveryZeroConfirmed(event.target.checked)} />
            Confirmar delivery com valor zero nesta data
          </label>

          <div className="cash-delivery-grid">
            {deliveryPlatforms.map((platform) => {
              const orders = Math.trunc(numberValue(delivery[platform.key].orders));
              const earnings = numberValue(delivery[platform.key].earnings);
              return (
                <article className="cash-platform-card" key={platform.key}>
                  <div className="cash-platform-header">
                    <h3>{platform.label}</h3>
                    <span className="status-badge tone-info">Ticket médio {formatCurrency(averageAmount(earnings, orders))}</span>
                  </div>
                  <div className="form-grid cash-platform-fields">
                    <label>
                      Número de pedidos
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={delivery[platform.key].orders}
                        onChange={(event) => setDelivery({ ...delivery, [platform.key]: { ...delivery[platform.key], orders: event.target.value } })}
                      />
                    </label>
                    <label>
                      Ganhos
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={delivery[platform.key].earnings}
                        onChange={(event) => setDelivery({ ...delivery, [platform.key]: { ...delivery[platform.key], earnings: event.target.value } })}
                      />
                    </label>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="summary-grid dashboard-compact-grid cash-metrics-grid">
            <article><span>Pedidos totais</span><strong>{deliveryOrders}</strong></article>
            <article><span>Faturamento delivery</span><strong>{formatCurrency(deliveryGross)}</strong></article>
            <article><span>Ticket médio delivery</span><strong>{formatCurrency(deliveryTicketAverage)}</strong></article>
          </div>
        </section>
      </section>

      {!canEdit && (
        <p className="muted-inline">
          Seu perfil não tem permissão para alterar este módulo.
        </p>
      )}
    </div>
  );
}
