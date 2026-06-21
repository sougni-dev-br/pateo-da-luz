import { CheckCircle2, Eye, FileText, Pencil, Plus, RefreshCw, Save, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  addCardStatementItem,
  AppUser,
  checkCardStatementItem,
  closeCardStatement,
  CreditCard,
  CreditCardStatement,
  CreditCardStatementDetail,
  downloadCardStatementPdf,
  getCardStatement,
  getCardStatements,
  getCards,
  payCardStatement,
  saveCard,
  saveCardStatement,
  setCardStatementStatus,
  setCardStatus
} from "../api/client";
import { PeriodFilter } from "../components/PeriodFilter";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { formatCurrency, formatDate } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

type CardsProps = { user: AppUser };

const emptyCard = { id: "", name: "", bankName: "", last4Digits: "", closingDay: 1, dueDay: 1, notes: "", isActive: true };

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function statementStatusLabel(status: CreditCardStatement["status"]) {
  if (status === "OPEN") return "Aberta";
  if (status === "CHECKED") return "Conferida";
  if (status === "CLOSED") return "Fechada";
  if (status === "PAID") return "Paga";
  if (status === "CANCELLED") return "Cancelada";
  return status;
}

function statementStatusTone(status: CreditCardStatement["status"]) {
  if (status === "PAID") return "paid";
  if (status === "CHECKED") return "confirmed";
  if (status === "CLOSED") return "tone-neutral";
  if (status === "CANCELLED") return "cancelled";
  return "open";
}

export function Cards({ user }: CardsProps) {
  const { notice, setNotice } = useNotice();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [statements, setStatements] = useState<CreditCardStatement[]>([]);
  const [statementDetail, setStatementDetail] = useState<CreditCardStatementDetail | null>(null);
  const [cardSearch, setCardSearch] = useState("");
  const [statementFilters, setStatementFilters] = useState({ creditCardId: "", status: "" });
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [cardForm, setCardForm] = useState(emptyCard);
  const [cardEditorOpen, setCardEditorOpen] = useState(false);
  const [statementEditorOpen, setStatementEditorOpen] = useState(false);
  const [statementForm, setStatementForm] = useState({
    id: "",
    creditCardId: "",
    name: "",
    competenceYear: String(new Date().getFullYear()),
    competenceMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
    closingDate: todayDate(),
    dueDate: todayDate(),
    notes: ""
  });
  const [itemForm, setItemForm] = useState({
    description: "",
    supplierName: "",
    itemDate: todayDate(),
    value: "",
    checked: false,
    hasDivergence: false,
    notes: ""
  });
  const canManage = hasPermission(user, "cards", "edit");

  async function load() {
    try {
      const [cardRows, statementRows] = await Promise.all([
        getCards(cardSearch || undefined),
        getCardStatements({
          creditCardId: statementFilters.creditCardId || undefined,
          status: statementFilters.status || undefined,
          startDate: period.startDate,
          endDate: period.endDate
        })
      ]);
      setCards(cardRows);
      setStatements(statementRows);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar cartões." });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(
    () => ({
      open: statements.filter((statement) => statement.status === "OPEN").reduce((sum, statement) => sum + Number(statement.totalAmount ?? 0), 0),
      checked: statements.filter((statement) => statement.status === "CHECKED").reduce((sum, statement) => sum + Number(statement.totalAmount ?? 0), 0),
      closed: statements.filter((statement) => statement.status === "CLOSED").reduce((sum, statement) => sum + Number(statement.totalAmount ?? 0), 0),
      paid: statements.filter((statement) => statement.status === "PAID").reduce((sum, statement) => sum + Number(statement.totalAmount ?? 0), 0)
    }),
    [statements]
  );

  const cardMetrics = useMemo(
    () => ({
      active: cards.filter((card) => card.isActive).length,
      inactive: cards.filter((card) => !card.isActive).length,
      statements: statements.length
    }),
    [cards, statements]
  );

  function resetCardEditor() {
    setCardForm(emptyCard);
    setCardEditorOpen(false);
  }

  function openCardEditor(card?: CreditCard) {
    if (card) setCardForm({ ...card, notes: card.notes ?? "" });
    else setCardForm(emptyCard);
    setCardEditorOpen(true);
  }

  function openStatementEditor() {
    setStatementForm({
      id: "",
      creditCardId: cards[0]?.id ?? "",
      name: "",
      competenceYear: String(new Date().getFullYear()),
      competenceMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
      closingDate: todayDate(),
      dueDate: todayDate(),
      notes: ""
    });
    setStatementEditorOpen(true);
  }

  async function submitCard() {
    if (!cardForm.name.trim() || !cardForm.bankName.trim() || !cardForm.last4Digits.trim()) return;
    await saveCard({
      ...cardForm,
      closingDay: Number(cardForm.closingDay),
      dueDay: Number(cardForm.dueDay)
    });
    setNotice({ tone: "success", message: cardForm.id ? "Cartão atualizado com sucesso." : "Cartão criado com sucesso." });
    resetCardEditor();
    await load();
  }

  async function toggleCard(card: CreditCard) {
    await setCardStatus(card.id, !card.isActive);
    setNotice({ tone: "success", message: card.isActive ? "Cartão inativado com sucesso." : "Cartão reativado com sucesso." });
    await load();
  }

  async function submitStatement() {
    if (!statementForm.creditCardId) return;
    await saveCardStatement({
      id: statementForm.id || undefined,
      creditCardId: statementForm.creditCardId,
      name: statementForm.name || null,
      competenceYear: Number(statementForm.competenceYear),
      competenceMonth: Number(statementForm.competenceMonth),
      closingDate: statementForm.closingDate,
      dueDate: statementForm.dueDate,
      notes: statementForm.notes || null
    });
    setNotice({ tone: "success", message: statementForm.id ? "Fatura atualizada com sucesso." : "Fatura criada com sucesso." });
    setStatementForm({
      id: "",
      creditCardId: cards[0]?.id ?? "",
      name: "",
      competenceYear: String(new Date().getFullYear()),
      competenceMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
      closingDate: todayDate(),
      dueDate: todayDate(),
      notes: ""
    });
    setStatementEditorOpen(false);
    await load();
  }

  async function openStatement(statement: CreditCardStatement) {
    try {
      setStatementDetail(await getCardStatement(statement.id));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir fatura." });
    }
  }

  async function closeStatement(statement: CreditCardStatement) {
    try {
      setStatementDetail(await closeCardStatement(statement.id));
      setNotice({ tone: "success", message: "Fatura fechada com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao fechar fatura." });
    }
  }

  async function payStatement(statement: CreditCardStatement) {
    try {
      await payCardStatement(statement.id, {
        paidDate: todayDate(),
        paidAmount: Number(statement.totalAmount ?? 0),
        paymentMethodName: "Cartão de crédito/fatura"
      });
      setNotice({ tone: "success", message: "Fatura marcada como paga." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao pagar fatura." });
    }
  }

  async function addManualItem() {
    if (!statementDetail || !itemForm.description.trim() || Number(itemForm.value || 0) <= 0) return;
    try {
      await addCardStatementItem(statementDetail.id, {
        description: itemForm.description,
        supplierName: itemForm.supplierName || null,
        itemDate: itemForm.itemDate,
        value: Number(itemForm.value),
        checked: itemForm.checked,
        hasDivergence: itemForm.hasDivergence,
        notes: itemForm.notes || null
      });
      setStatementDetail(await getCardStatement(statementDetail.id));
      setItemForm({ description: "", supplierName: "", itemDate: todayDate(), value: "", checked: false, hasDivergence: false, notes: "" });
      setNotice({ tone: "success", message: "Item incluído na fatura." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao incluir item." });
    }
  }

  async function toggleItemCheck(item: CreditCardStatementDetail["items"][number]) {
    if (!statementDetail) return;
    try {
      await checkCardStatementItem(statementDetail.id, item.id, { checked: !item.checked, hasDivergence: item.hasDivergence, notes: item.notes });
      setStatementDetail(await getCardStatement(statementDetail.id));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar item." });
    }
  }

  async function toggleItemDivergence(item: CreditCardStatementDetail["items"][number]) {
    if (!statementDetail) return;
    try {
      await checkCardStatementItem(statementDetail.id, item.id, { checked: item.checked, hasDivergence: !item.hasDivergence, notes: item.notes });
      setStatementDetail(await getCardStatement(statementDetail.id));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar divergência." });
    }
  }

  async function pdf(statement: CreditCardStatement) {
    try {
      await downloadCardStatementPdf(statement.id);
      setNotice({ tone: "success", message: "PDF da fatura gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar PDF." });
    }
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Módulo financeiro</p>
            <h2>Cartões</h2>
          </div>
          <div className="actions-cell">
            {canManage && (
              <button className="primary-button" type="button" onClick={() => openCardEditor()}>
                <Plus size={16} /> Novo cartão
              </button>
            )}
            <button className="icon-button" type="button" onClick={load} aria-label="Atualizar cartões">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        <div className="summary-grid dashboard-compact-grid">
          <article className="summary-card compact-summary-card tone-warning">
            <div>
              <span>Faturas abertas</span>
              <strong>{formatCurrency(summary.open)}</strong>
              <small>Exigem acompanhamento e conferência.</small>
            </div>
            <WalletCards className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-info">
            <div>
              <span>Faturas conferidas</span>
              <strong>{formatCurrency(summary.checked)}</strong>
              <small>Prontas para fechamento ou pagamento.</small>
            </div>
            <CheckCircle2 className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card tone-success">
            <div>
              <span>Cartões ativos</span>
              <strong>{cardMetrics.active}</strong>
              <small>{cardMetrics.statements} faturas no período filtrado.</small>
            </div>
            <Eye className="summary-card-icon" size={20} />
          </article>
          <article className="summary-card compact-summary-card">
            <div>
              <span>Cartões inativos</span>
              <strong>{cardMetrics.inactive}</strong>
              <small>Cadastros mantidos fora da operação.</small>
            </div>
            <FileText className="summary-card-icon" size={20} />
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Consulta operacional</p>
            <h2>Resumo de faturas</h2>
          </div>
          <div className="actions-cell">
            {canManage && (
              <button className="secondary-button" type="button" onClick={openStatementEditor}>
                <Plus size={16} /> Nova fatura
              </button>
            )}
          </div>
        </div>

        <div className="filters-row">
          <label>
            Buscar cartão
            <input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} />
          </label>
          <label>
            Cartão
            <select value={statementFilters.creditCardId} onChange={(event) => setStatementFilters({ ...statementFilters, creditCardId: event.target.value })}>
              <option value="">Todos</option>
              {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={statementFilters.status} onChange={(event) => setStatementFilters({ ...statementFilters, status: event.target.value })}>
              <option value="">Todos</option>
              <option value="OPEN">Aberta</option>
              <option value="CHECKED">Conferida</option>
              <option value="CLOSED">Fechada</option>
              <option value="PAID">Paga</option>
              <option value="CANCELLED">Cancelada</option>
            </select>
          </label>
          <PeriodFilter value={period} onChange={setPeriod} />
          <button className="primary-button" type="button" onClick={load}>Filtrar</button>
        </div>

        {statementEditorOpen && canManage && (
          <div className="subsection compact-editor-shell">
            <div className="section-heading compact-heading">
              <div>
                <p>Cadastro</p>
                <h3>Nova fatura</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setStatementEditorOpen(false)}>
                <X size={16} /> Fechar
              </button>
            </div>
            <div className="form-grid">
              <label>
                Cartão
                <select value={statementForm.creditCardId} onChange={(event) => setStatementForm({ ...statementForm, creditCardId: event.target.value })}>
                  <option value="">Selecione</option>
                  {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
                </select>
              </label>
              <label>
                Nome
                <input value={statementForm.name} onChange={(event) => setStatementForm({ ...statementForm, name: event.target.value })} />
              </label>
              <label>
                Competência ano
                <input type="number" value={statementForm.competenceYear} onChange={(event) => setStatementForm({ ...statementForm, competenceYear: event.target.value })} />
              </label>
              <label>
                Competência mês
                <input type="number" min="1" max="12" value={statementForm.competenceMonth} onChange={(event) => setStatementForm({ ...statementForm, competenceMonth: event.target.value })} />
              </label>
              <label>
                Fechamento
                <input type="date" value={statementForm.closingDate} onChange={(event) => setStatementForm({ ...statementForm, closingDate: event.target.value })} />
              </label>
              <label>
                Vencimento
                <input type="date" value={statementForm.dueDate} onChange={(event) => setStatementForm({ ...statementForm, dueDate: event.target.value })} />
              </label>
              <label className="full-width">
                Observações
                <input value={statementForm.notes} onChange={(event) => setStatementForm({ ...statementForm, notes: event.target.value })} />
              </label>
            </div>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setStatementEditorOpen(false)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={submitStatement}>
                <Save size={16} /> Salvar fatura
              </button>
            </div>
          </div>
        )}

        <div className="table-wrap operational-table cards-table subsection">
          <table>
            <thead>
              <tr>
                <th>Cartão</th>
                <th>Competência</th>
                <th>Fechamento</th>
                <th>Vencimento</th>
                <th className="numeric-cell">Total</th>
                <th>Status</th>
                <th className="numeric-cell">Itens</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.id}>
                  <td className="cards-main-cell" title={statement.creditCard?.name ?? "-"}>
                    <strong>{statement.creditCard?.name ?? "-"}</strong>
                    <small>{statement.name || "Fatura do período"}</small>
                  </td>
                  <td>{String(statement.competenceMonth).padStart(2, "0")}/{statement.competenceYear}</td>
                  <td>{formatDate(statement.closingDate)}</td>
                  <td>{formatDate(statement.dueDate)}</td>
                  <td className="numeric-cell nowrap-cell">{formatCurrency(statement.totalAmount)}</td>
                  <td><span className={`status-badge ${statementStatusTone(statement.status)}`}>{statementStatusLabel(statement.status)}</span></td>
                  <td className="numeric-cell">{statement._count?.items ?? 0}</td>
                  <td>
                    <div className="actions-cell">
                      <button type="button" onClick={() => openStatement(statement)}><Eye size={15} /> Ver</button>
                      {canManage && statement.status !== "CLOSED" && <button type="button" onClick={() => closeStatement(statement)}>Fechar</button>}
                      {canManage && statement.status === "CLOSED" && <button type="button" onClick={() => payStatement(statement)}>Pagar</button>}
                      <button type="button" onClick={() => pdf(statement)}><FileText size={15} /> PDF</button>
                      {canManage && ["OPEN", "CHECKED"].includes(statement.status) && (
                        <button type="button" onClick={() => setCardStatementStatus(statement.id, statement.status === "CHECKED" ? "OPEN" : "CHECKED")}>
                          Conferir
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {statements.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-table-state">Nenhuma fatura encontrada no período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Cadastros operacionais</p>
            <h2>Cartões cadastrados</h2>
          </div>
          <div className="actions-cell">
            {canManage && (
              <button className="primary-button" type="button" onClick={() => openCardEditor()}>
                <Plus size={16} /> Novo cartão
              </button>
            )}
          </div>
        </div>

        <div className="table-wrap operational-table cards-table">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Nome</th>
                <th>Instituição</th>
                <th>Final</th>
                <th className="numeric-cell">Fech.</th>
                <th className="numeric-cell">Venc.</th>
                <th className="numeric-cell">Faturas</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id}>
                  <td><span className={`status-badge ${card.isActive ? "paid" : "cancelled"}`}>{card.isActive ? "Ativo" : "Inativo"}</span></td>
                  <td className="cards-main-cell" title={card.name}>
                    <strong>{card.name}</strong>
                    {card.notes ? <small title={card.notes}>{card.notes}</small> : <small>Sem observações operacionais.</small>}
                  </td>
                  <td title={card.bankName}>{card.bankName}</td>
                  <td>{card.last4Digits}</td>
                  <td className="numeric-cell">{card.closingDay}</td>
                  <td className="numeric-cell">{card.dueDay}</td>
                  <td className="numeric-cell">{card._count?.statements ?? 0}</td>
                  <td>
                    <div className="actions-cell">
                      <button type="button" onClick={() => openCardEditor(card)}><Pencil size={14} /> Editar</button>
                      <button type="button" onClick={() => toggleCard(card)}>{card.isActive ? "Inativar" : "Reativar"}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {cards.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-table-state">Nenhum cartão cadastrado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {cardEditorOpen && canManage && (
        <div className="modal-backdrop">
          <section className="panel modal-panel cards-editor-modal">
            <div className="section-heading">
              <div>
                <p>Cadastro financeiro</p>
                <h2>{cardForm.id ? "Editar cartão" : "Novo cartão"}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={resetCardEditor}>
                <X size={16} /> Fechar
              </button>
            </div>

            <div className="form-grid">
              <label>
                Nome do cartão
                <input value={cardForm.name} onChange={(event) => setCardForm({ ...cardForm, name: event.target.value })} />
              </label>
              <label>
                Banco / Instituição
                <input value={cardForm.bankName} onChange={(event) => setCardForm({ ...cardForm, bankName: event.target.value })} />
              </label>
              <label>
                Últimos 4 dígitos
                <input value={cardForm.last4Digits} onChange={(event) => setCardForm({ ...cardForm, last4Digits: event.target.value })} />
              </label>
              <label>
                Dia de fechamento
                <input type="number" min="1" max="31" value={cardForm.closingDay} onChange={(event) => setCardForm({ ...cardForm, closingDay: Number(event.target.value) })} />
              </label>
              <label>
                Dia de vencimento
                <input type="number" min="1" max="31" value={cardForm.dueDay} onChange={(event) => setCardForm({ ...cardForm, dueDay: Number(event.target.value) })} />
              </label>
              <label className="full-width">
                Observações
                <input value={cardForm.notes} onChange={(event) => setCardForm({ ...cardForm, notes: event.target.value })} />
              </label>
              <label className="checkbox-label checkbox-card-field">
                <input type="checkbox" checked={cardForm.isActive} onChange={(event) => setCardForm({ ...cardForm, isActive: event.target.checked })} />
                Cartão ativo para novas faturas
              </label>
            </div>

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={resetCardEditor}>Cancelar</button>
              <button className="primary-button" type="button" onClick={submitCard}>
                <Save size={16} /> Salvar cartão
              </button>
            </div>
          </section>
        </div>
      )}

      {statementDetail && (
        <div className="modal-backdrop">
          <section className="panel modal-panel wide-modal">
            <div className="section-heading">
              <div>
                <p>Detalhe da fatura</p>
                <h2>{statementDetail.creditCard.name}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setStatementDetail(null)}>Fechar</button>
            </div>
            <div className="summary-columns">
              <div><h3>Cartão</h3><p>{statementDetail.creditCard.bankName}</p><p>Final {statementDetail.creditCard.last4Digits}</p></div>
              <div><h3>Competência</h3><p>{String(statementDetail.competenceMonth).padStart(2, "0")}/{statementDetail.competenceYear}</p><p>Status {statementStatusLabel(statementDetail.status)}</p></div>
              <div><h3>Resumo</h3><p>Total {formatCurrency(statementDetail.totalAmount)}</p><p>{statementDetail.items.length} item(ns)</p></div>
            </div>
            <div className="subsection table-wrap operational-table">
              <h3>Itens</h3>
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Parcela</th>
                    <th>Descrição</th>
                    <th>Fornecedor</th>
                    <th>Categoria</th>
                    <th className="numeric-cell">Valor</th>
                    <th>Conf.</th>
                    <th>Div.</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>{statementDetail.items.map((item) => {
                  const supplierDisplay = item.supplierName ?? item.purchase?.supplier?.name ?? "-";
                  const parcelaLabel = item.installment != null && item.totalInstallments != null
                    ? `${item.installment}/${item.totalInstallments}`
                    : item.installment != null ? String(item.installment) : "-";
                  return (
                    <tr key={item.id}>
                      <td className="nowrap-cell">{formatDate(item.itemDate)}</td>
                      <td className="numeric-cell nowrap-cell">{parcelaLabel}</td>
                      <td title={item.description}>{item.description}</td>
                      <td title={supplierDisplay}>{supplierDisplay}</td>
                      <td>{item.categoryName ?? "-"}</td>
                      <td className="numeric-cell nowrap-cell">{formatCurrency(item.value)}</td>
                      <td>{item.checked ? "✓" : "–"}</td>
                      <td>{item.hasDivergence ? "⚠" : "–"}</td>
                      <td className="actions-cell">
                        {canManage && ["OPEN", "CHECKED"].includes(statementDetail.status) ? (
                          <>
                            <button type="button" onClick={() => toggleItemCheck(item)}>{item.checked ? "Desmarcar" : "Conferir"}</button>
                            <button type="button" onClick={() => toggleItemDivergence(item)}>Div.</button>
                          </>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            {canManage && (
              <div className="subsection">
                <div className="section-heading compact-heading"><div><p>Manual</p><h3>Adicionar item manual</h3></div></div>
                <div className="form-grid">
                  <label>Descrição<input value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} /></label>
                  <label>Fornecedor / Local<input value={itemForm.supplierName} onChange={(event) => setItemForm({ ...itemForm, supplierName: event.target.value })} /></label>
                  <label>Data<input type="date" value={itemForm.itemDate} onChange={(event) => setItemForm({ ...itemForm, itemDate: event.target.value })} /></label>
                  <label>Valor<input type="number" min="0" step="0.01" value={itemForm.value} onChange={(event) => setItemForm({ ...itemForm, value: event.target.value })} /></label>
                  <label className="full-width">Observações<input value={itemForm.notes} onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })} /></label>
                </div>
                <div className="form-actions">
                  <button className="primary-button" type="button" onClick={addManualItem}><Plus size={16} /> Adicionar item</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
