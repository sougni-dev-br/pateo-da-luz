import { Plus, Trash2 } from "lucide-react";
import { useState, type WheelEvent } from "react";
import { saveRevenueEntry, saveRevenueEventGroup } from "../api/client";
import { Dialog } from "../components/ui/Dialog";
import { Alert, Button, FormField, FormGrid, FormSection, Money, Select, Switch, Tabs, TextField, Textarea } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
import { formatNumber } from "../utils/format";
import { EVENT_CHANNEL } from "./revenueBits";
import {
  buildVoucherEntries,
  defaultVoucherCategories,
  loadRememberedPrices,
  parsePastedDays,
  rememberPrices,
  voucherTotals,
  type VoucherCategory,
  type VoucherDay
} from "./eventVouchers";
import "./EventLaunchModal.css";

const EVENT_TYPE_OPTIONS = ["Evento — Centro de Convenções", "Reserva de grupo", "Empreitada", "Outros"].map((label) => ({ value: label, label }));

const PAYMENT_OPTIONS = [
  { value: "", label: "Não informado" },
  ...["PIX", "Transferência bancária", "Dinheiro", "Boleto", "A receber", "Outro"].map((label) => ({ value: label, label }))
];

type Mode = "valor" | "vouchers";

const MODE_TABS = [
  { value: "valor", label: "Valor fechado" },
  { value: "vouchers", label: "Consumo por voucher" }
];

/** Rolar a página com o cursor num campo numérico em foco altera o valor sem ninguém perceber. */
function blurOnWheel(event: WheelEvent<HTMLInputElement>) {
  event.currentTarget.blur();
}

function emptyVoucherDays(): VoucherDay[] {
  return [{ date: hojeLocalIso(), qty: {} }];
}

// Função, e não constante: a data de hoje é lida quando o modal abre, não quando o módulo carrega.
function emptyEventForm() {
  return {
    mode: "valor" as Mode,
    date: hojeLocalIso(),
    description: "",
    eventType: EVENT_TYPE_OPTIONS[0].value,
    grossAmount: "",
    includeService: false,
    tickets: "",
    paymentMethod: "",
    notes: ""
  };
}

type Props = {
  onClose: () => void;
  /** Chamado depois que tudo foi gravado; quem abriu o modal fecha, avisa e recarrega a lista. */
  onSaved: (message: string) => void | Promise<void>;
};

export function EventLaunchModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState(emptyEventForm);
  const [categories, setCategories] = useState<VoucherCategory[]>(() => loadRememberedPrices(defaultVoucherCategories));
  const [days, setDays] = useState<VoucherDay[]>(emptyVoucherDays);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const isVoucherMode = form.mode === "vouchers";
  const voucherSummary = voucherTotals(categories, days);
  const gross = isVoucherMode ? voucherSummary.gross : Number(form.grossAmount || 0);
  const service = form.includeService ? Number((gross * 0.1).toFixed(2)) : 0;
  const net = Number((gross - service).toFixed(2));
  const people = isVoucherMode ? voucherSummary.people : Number(form.tickets || 0);
  const ticketAverage = people > 0 ? Number((net / people).toFixed(2)) : null;
  const canSave = !!form.description.trim() && gross > 0 && (isVoucherMode || !!form.date);

  function patch(changes: Partial<ReturnType<typeof emptyEventForm>>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  function updateDay(index: number, change: (day: VoucherDay) => VoucherDay) {
    setDays((current) => current.map((day, i) => (i === index ? change(day) : day)));
  }

  function addDay() {
    setDays((current) => {
      const last = current[current.length - 1]?.date;
      const next = last ? new Date(`${last}T12:00:00`) : new Date();
      if (last) next.setDate(next.getDate() + 1);
      const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      return [...current, { date: iso, qty: {} }];
    });
  }

  function applyPastedDays() {
    const year = Number((days[0]?.date || hojeLocalIso()).slice(0, 4));
    const parsed = parsePastedDays(pasteText, categories, year);
    if (parsed.days.length === 0) {
      setPasteNote("Nenhum dia reconhecido. Use uma linha por dia: data, convidados, staff.");
      return;
    }
    setDays(parsed.days);
    setPasteText("");
    const imported = `${parsed.days.length} ${parsed.days.length === 1 ? "dia importado" : "dias importados"}`;
    const skipped = parsed.ignored > 0 ? `; ${parsed.ignored} ${parsed.ignored === 1 ? "linha ignorada" : "linhas ignoradas"}` : "";
    setPasteNote(`${imported}${skipped}.`);
  }

  async function saveVoucherEvent() {
    const entries = buildVoucherEntries({
      channel: EVENT_CHANNEL,
      eventType: form.eventType,
      eventName: form.description,
      categories,
      days,
      includeService: form.includeService,
      paymentMethod: form.paymentMethod,
      notes: form.notes
    });
    if (entries.length === 0) {
      setError("Informe a data e a quantidade de pelo menos um dia.");
      return;
    }
    // O servidor grava o grupo todo numa transação: se algo falhar, nada entra e dá para tentar de novo.
    await saveRevenueEventGroup(entries);
    rememberPrices(categories);
    await onSaved(`Evento lançado: ${entries.length} lançamentos (${voucherSummary.people} pessoas).`);
  }

  async function saveFixedValueEvent() {
    if (!form.date || !form.description.trim() || !form.grossAmount || gross <= 0) {
      setError("Preencha data, nome e valor bruto do evento.");
      return;
    }
    const [year, month] = form.date.split("-").map(Number);
    await saveRevenueEntry({
      date: form.date,
      competenceYear: year,
      competenceMonth: month,
      channel: EVENT_CHANNEL,
      sourcePlatform: form.eventType,
      description: form.description.trim(),
      grossAmount: gross,
      discounts: 0,
      platformFees: 0,
      serviceAmount: service,
      netAmount: net,
      tickets: form.tickets ? Number(form.tickets) : 0,
      ticketAverage,
      paymentMethod: form.paymentMethod || null,
      notes: form.notes.trim() || null
    });
    await onSaved("Evento lançado com sucesso.");
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      if (isVoucherMode) await saveVoucherEvent();
      else await saveFixedValueEvent();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Erro ao lançar evento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      title="Lançar evento / empreitada"
      description="Receita de evento do centro de convenções, reserva de grupo ou empreitada."
      size="xl"
    >
      <div className="em-form">
        <FormSection eyebrow="Passo 1" title="Evento">
          <FormGrid cols={2}>
            <FormField label="Nome do evento" required className="ds-form-grid-span-all">
              <TextField
                autoFocus
                placeholder="Ex.: Congresso de Cardiologia, Casamento Silva…"
                value={form.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </FormField>
            <Select label="Tipo de evento" value={form.eventType} options={EVENT_TYPE_OPTIONS} onChange={(event) => patch({ eventType: event.target.value })} />
            <Select label="Forma de recebimento" value={form.paymentMethod} options={PAYMENT_OPTIONS} onChange={(event) => patch({ paymentMethod: event.target.value })} />
          </FormGrid>
        </FormSection>

        <FormSection eyebrow="Passo 2" title="Como lançar">
          <Tabs
            tabs={MODE_TABS}
            value={form.mode}
            onChange={(value) => patch({ mode: value as Mode })}
            aria-label="Forma de lançar o evento"
          />

          {!isVoucherMode && (
            <FormGrid cols={3}>
              <TextField label="Data do evento" type="date" value={form.date} onChange={(event) => patch({ date: event.target.value })} />
              <TextField
                label="Valor bruto (R$)"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={form.grossAmount}
                onWheel={blurOnWheel}
                onChange={(event) => patch({ grossAmount: event.target.value })}
              />
              <TextField
                label="Número de pessoas"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="0"
                value={form.tickets}
                onWheel={blurOnWheel}
                onChange={(event) => patch({ tickets: event.target.value })}
              />
            </FormGrid>
          )}

          {isVoucherMode && (
            <div className="em-vouchers">
              <p className="em-hint">Pacote de almoço por voucher da organização: informe o preço de cada público e, por dia, quantos vouchers foram usados.</p>

              <FormGrid cols={2}>
                {categories.map((category) => (
                  <TextField
                    key={category.id}
                    label={`Preço — ${category.label} (R$)`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={category.price}
                    onWheel={blurOnWheel}
                    onChange={(event) =>
                      setCategories((current) => current.map((item) => (item.id === category.id ? { ...item, price: event.target.value } : item)))
                    }
                  />
                ))}
              </FormGrid>

              <details className="em-paste">
                <summary>Colar de uma planilha</summary>
                <p className="em-hint">
                  Uma linha por dia: data (14/10 ou 14/10/2026), {categories.map((category) => category.label).join(", ")} — nessa ordem. Copie as
                  células direto do Excel ou do Google Sheets.
                </p>
                <Textarea
                  rows={4}
                  aria-label="Dias colados da planilha"
                  placeholder={"14/10  14  5\n15/10  56  6"}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                />
                <Button variant="secondary" size="sm" disabled={!pasteText.trim()} onClick={applyPastedDays}>
                  Usar estes dias
                </Button>
                {pasteNote && <p className="em-hint" role="status">{pasteNote}</p>}
              </details>

              <div className="em-days" role="group" aria-label="Dias do evento" style={{ ["--em-cats" as string]: categories.length }}>
                <div className="em-day em-day-head" aria-hidden="true">
                  <span>Dia</span>
                  {categories.map((category) => (
                    <span key={category.id}>{category.label}</span>
                  ))}
                  <span>Total do dia</span>
                  <span />
                </div>
                {days.map((day, index) => {
                  const dayTotals = voucherTotals(categories, [day]);
                  return (
                    <div className="em-day" key={index}>
                      <div className="em-cell" data-label="Dia">
                        <TextField
                          aria-label={`Data do dia ${index + 1}`}
                          type="date"
                          value={day.date}
                          onChange={(event) => updateDay(index, (current) => ({ ...current, date: event.target.value }))}
                        />
                      </div>
                      {categories.map((category) => (
                        <div className="em-cell" key={category.id} data-label={category.label}>
                          <TextField
                            aria-label={`${category.label} em ${day.date || `dia ${index + 1}`}`}
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={day.qty[category.id] ?? ""}
                            onWheel={blurOnWheel}
                            onChange={(event) =>
                              updateDay(index, (current) => ({ ...current, qty: { ...current.qty, [category.id]: event.target.value } }))
                            }
                          />
                        </div>
                      ))}
                      <span className="em-day-total">
                        {formatNumber(dayTotals.people)} pessoas · <Money value={dayTotals.gross} />
                      </span>
                      {days.length > 1 ? (
                        <Button variant="icon" aria-label={`Remover dia ${index + 1}`} onClick={() => setDays((current) => current.filter((_, i) => i !== index))}>
                          <Trash2 size={16} />
                        </Button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
              </div>
              <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} onClick={addDay}>
                Adicionar dia
              </Button>
            </div>
          )}
        </FormSection>

        <FormSection eyebrow="Passo 3" title="Opções">
          <FormField label="Cobrar taxa de serviço (10%)" inline>
            <Switch label="Cobrar taxa de serviço (10%)" checked={form.includeService} onChange={(checked) => patch({ includeService: checked })} />
          </FormField>
          <Textarea
            label="Observações internas"
            rows={2}
            placeholder="Informações adicionais — visível apenas à gerência"
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
          />
        </FormSection>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="em-footer">
          <dl className="em-summary" aria-label="Resumo do lançamento">
            <div>
              <dt>Bruto</dt>
              <dd><Money value={gross} /></dd>
            </div>
            {form.includeService && (
              <div>
                <dt>Serviço</dt>
                <dd><Money value={service} /></dd>
              </div>
            )}
            <div>
              <dt>Líquido</dt>
              <dd><Money value={net} /></dd>
            </div>
            <div>
              <dt>Pessoas</dt>
              <dd>{formatNumber(people)}</dd>
            </div>
            {ticketAverage !== null && (
              <div>
                <dt>Ticket médio</dt>
                <dd><Money value={ticketAverage} /></dd>
              </div>
            )}
          </dl>
          <div className="em-actions">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !canSave}>
              {saving ? "Salvando…" : "Confirmar lançamento"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
