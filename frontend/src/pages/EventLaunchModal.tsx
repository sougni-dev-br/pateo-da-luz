import { useState, type WheelEvent } from "react";
import { saveRevenueEntry, saveRevenueEventGroup } from "../api/client";
import { Money } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
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

const eventTypes = [
  "Evento — Centro de Convenções",
  "Reserva de grupo",
  "Empreitada",
  "Outros"
] as const;

const eventPaymentMethods = ["PIX", "Transferência bancária", "Dinheiro", "Boleto", "A receber", "Outro"];

type EventLaunchMode = "valor" | "vouchers";

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
    mode: "valor" as EventLaunchMode,
    date: hojeLocalIso(),
    description: "",
    eventType: eventTypes[0] as string,
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
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [voucherCategories, setVoucherCategories] = useState<VoucherCategory[]>(() => loadRememberedPrices(defaultVoucherCategories));
  const [voucherDays, setVoucherDays] = useState<VoucherDay[]>(emptyVoucherDays);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const isVoucherMode = eventForm.mode === "vouchers";
  const voucherSummary = voucherTotals(voucherCategories, voucherDays);
  const eventGross = isVoucherMode ? voucherSummary.gross : Number(eventForm.grossAmount || 0);
  const eventService = eventForm.includeService ? Number((eventGross * 0.1).toFixed(2)) : 0;
  const eventNet = Number((eventGross - eventService).toFixed(2));
  const eventPeople = isVoucherMode ? voucherSummary.people : Number(eventForm.tickets || 0);
  const eventTicketAverage = eventPeople > 0 ? Number((eventNet / eventPeople).toFixed(2)) : null;
  const canSaveEvent = !!eventForm.description.trim() && eventGross > 0 && (isVoucherMode || !!eventForm.date);

  function updateVoucherDay(index: number, patch: (day: VoucherDay) => VoucherDay) {
    setVoucherDays((days) => days.map((day, i) => (i === index ? patch(day) : day)));
  }

  function addVoucherDay() {
    setVoucherDays((days) => {
      const last = days[days.length - 1]?.date;
      const next = last ? new Date(`${last}T12:00:00`) : new Date();
      if (last) next.setDate(next.getDate() + 1);
      const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
      return [...days, { date: iso, qty: {} }];
    });
  }

  function applyPastedDays() {
    const year = Number((voucherDays[0]?.date || hojeLocalIso()).slice(0, 4));
    const { days, ignored } = parsePastedDays(pasteText, voucherCategories, year);
    if (days.length === 0) {
      setPasteNote("Nenhum dia reconhecido. Use uma linha por dia: data, convidados, staff.");
      return;
    }
    setVoucherDays(days);
    setPasteText("");
    setPasteNote(`${days.length} ${days.length === 1 ? "dia importado" : "dias importados"}${ignored > 0 ? `; ${ignored} ${ignored === 1 ? "linha ignorada" : "linhas ignoradas"}` : ""}.`);
  }

  async function saveVoucherEvent() {
    const entries = buildVoucherEntries({
      channel: EVENT_CHANNEL,
      eventType: eventForm.eventType,
      eventName: eventForm.description,
      categories: voucherCategories,
      days: voucherDays,
      includeService: eventForm.includeService,
      paymentMethod: eventForm.paymentMethod,
      notes: eventForm.notes
    });
    if (entries.length === 0) {
      setError("Informe a data e a quantidade de pelo menos um dia.");
      return;
    }
    // O servidor grava o grupo todo numa transação: se algo falhar, nada entra e dá para tentar de novo.
    await saveRevenueEventGroup(entries);
    rememberPrices(voucherCategories);
    await onSaved(`Evento lançado: ${entries.length} lançamentos (${voucherSummary.people} pessoas).`);
  }

  async function saveFixedValueEvent() {
    if (!eventForm.date || !eventForm.description.trim() || !eventForm.grossAmount || eventGross <= 0) {
      setError("Preencha data, descrição e valor bruto do evento.");
      return;
    }
    const [year, month] = eventForm.date.split("-").map(Number);
    await saveRevenueEntry({
      date: eventForm.date,
      competenceYear: year,
      competenceMonth: month,
      channel: EVENT_CHANNEL,
      sourcePlatform: eventForm.eventType,
      description: eventForm.description.trim(),
      grossAmount: eventGross,
      discounts: 0,
      platformFees: 0,
      serviceAmount: eventService,
      netAmount: eventNet,
      tickets: eventForm.tickets ? Number(eventForm.tickets) : 0,
      ticketAverage: eventTicketAverage,
      paymentMethod: eventForm.paymentMethod || null,
      notes: eventForm.notes.trim() || null
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
    <div className="modal-backdrop">
      <section className="panel modal-panel">
        <div className="section-heading">
          <div>
            <p>Gerência</p>
            <h2>Lançar evento / empreitada</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="form-grid">
          <div className="full-width" role="group" aria-label="Como lançar">
            <button
              type="button"
              className={isVoucherMode ? "secondary-button" : "primary-button"}
              aria-pressed={!isVoucherMode}
              onClick={() => setEventForm({ ...eventForm, mode: "valor" })}
            >
              Valor fechado
            </button>{" "}
            <button
              type="button"
              className={isVoucherMode ? "primary-button" : "secondary-button"}
              aria-pressed={isVoucherMode}
              onClick={() => setEventForm({ ...eventForm, mode: "vouchers" })}
            >
              Consumo por voucher (por dia)
            </button>
          </div>

          {!isVoucherMode && (
            <label>
              Data do evento
              <input
                type="date"
                value={eventForm.date}
                onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })}
              />
            </label>
          )}

          <label>
            Tipo de evento
            <select
              value={eventForm.eventType}
              onChange={(event) => setEventForm({ ...eventForm, eventType: event.target.value })}
            >
              {eventTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>

          <label className="full-width">
            Descrição / Nome do evento
            <input
              autoFocus
              placeholder="Ex.: Casamento Silva — Salão A, Centro de Convenções..."
              value={eventForm.description}
              onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })}
            />
          </label>

          {!isVoucherMode && (
            <>
              <label>
                Valor bruto (R$)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0,00"
                  value={eventForm.grossAmount}
                  onChange={(event) => setEventForm({ ...eventForm, grossAmount: event.target.value })}
                />
              </label>

              <label>
                Número de pessoas
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={eventForm.tickets}
                  onChange={(event) => setEventForm({ ...eventForm, tickets: event.target.value })}
                />
              </label>
            </>
          )}

          {isVoucherMode && (
            <div className="full-width">
              <p className="hint">
                Pacote de almoço por voucher da organização. Informe o preço de cada público e, por dia, quantos vouchers foram usados.
              </p>
              <details className="voucher-paste">
                <summary>Colar de uma planilha</summary>
                <p className="hint">
                  Uma linha por dia: data (14/10 ou 14/10/2026), {voucherCategories.map((cat) => cat.label).join(", ")} — nessa ordem. Copie as células direto do Excel ou do Google Sheets.
                </p>
                <textarea
                  rows={4}
                  aria-label="Dias colados da planilha"
                  placeholder={"14/10  14  5\n15/10  56  6"}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                />
                <button type="button" className="secondary-button" disabled={!pasteText.trim()} onClick={applyPastedDays}>
                  Usar estes dias
                </button>
                {pasteNote && <p className="hint" role="status">{pasteNote}</p>}
              </details>

              <div className="table-wrap voucher-table"><table>
                <thead>
                  <tr>
                    <th scope="col">Dia</th>
                    {voucherCategories.map((cat) => (
                      <th scope="col" key={cat.id}>
                        {cat.label}
                        <input
                          aria-label={`Preço unitário — ${cat.label}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={cat.price}
                          onWheel={blurOnWheel}
                          onChange={(event) =>
                            setVoucherCategories((cats) =>
                              cats.map((c) => (c.id === cat.id ? { ...c, price: event.target.value } : c))
                            )
                          }
                        />
                      </th>
                    ))}
                    <th scope="col">Total do dia</th>
                    <th scope="col" aria-label="Remover dia" />
                  </tr>
                </thead>
                <tbody>
                  {voucherDays.map((day, index) => {
                    const dayTotals = voucherTotals(voucherCategories, [day]);
                    return (
                      <tr key={index}>
                        <td>
                          <input
                            aria-label={`Data do dia ${index + 1}`}
                            type="date"
                            value={day.date}
                            onChange={(event) => updateVoucherDay(index, (d) => ({ ...d, date: event.target.value }))}
                          />
                        </td>
                        {voucherCategories.map((cat) => (
                          <td key={cat.id}>
                            <input
                              aria-label={`${cat.label} em ${day.date || `dia ${index + 1}`}`}
                              type="number"
                              inputMode="numeric"
                              min="0"
                              step="1"
                              placeholder="0"
                              value={day.qty[cat.id] ?? ""}
                              onWheel={blurOnWheel}
                              onChange={(event) =>
                                updateVoucherDay(index, (d) => ({ ...d, qty: { ...d.qty, [cat.id]: event.target.value } }))
                              }
                            />
                          </td>
                        ))}
                        <td>
                          {dayTotals.people} pessoas · <Money value={dayTotals.gross} />
                        </td>
                        <td>
                          {voucherDays.length > 1 && (
                            <button
                              type="button"
                              className="secondary-button"
                              aria-label={`Remover dia ${index + 1}`}
                              onClick={() => setVoucherDays((days) => days.filter((_, i) => i !== index))}
                            >
                              Remover
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <button type="button" className="secondary-button" onClick={addVoucherDay}>
                + Adicionar dia
              </button>
            </div>
          )}

          <label>
            Forma de recebimento
            <select
              value={eventForm.paymentMethod}
              onChange={(event) => setEventForm({ ...eventForm, paymentMethod: event.target.value })}
            >
              <option value="">Não informado</option>
              {eventPaymentMethods.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </label>

          <label className="checkbox-label full-width">
            <input
              type="checkbox"
              checked={eventForm.includeService}
              onChange={(event) => setEventForm({ ...eventForm, includeService: event.target.checked })}
            />
            Cobrar taxa de serviço (10%)
          </label>

          {eventGross > 0 && (
            <div className="summary-grid event-launch-preview">
              <article>
                <span>Valor bruto</span>
                <strong><Money value={eventGross} /></strong>
              </article>
              <article>
                <span>Taxa de serviço</span>
                <strong><Money value={eventService} /></strong>
              </article>
              <article>
                <span>Valor líquido</span>
                <strong><Money value={eventNet} /></strong>
              </article>
              {isVoucherMode && (
                <article>
                  <span>Pessoas</span>
                  <strong>{eventPeople}</strong>
                </article>
              )}
              {eventTicketAverage !== null && (
                <article>
                  <span>Ticket médio</span>
                  <strong><Money value={eventTicketAverage} /></strong>
                </article>
              )}
            </div>
          )}

          <label className="full-width">
            Observações internas
            <textarea
              rows={2}
              placeholder="Informações adicionais — visível apenas à gerência"
              value={eventForm.notes}
              onChange={(event) => setEventForm({ ...eventForm, notes: event.target.value })}
            />
          </label>
        </div>

        {error && <p className="alert error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={saving || !canSaveEvent}
            onClick={handleSave}
          >
            {saving ? "Salvando..." : "Confirmar lançamento"}
          </button>
        </div>
      </section>
    </div>
  );
}
