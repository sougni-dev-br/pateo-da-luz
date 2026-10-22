import { ArrowRightLeft, CheckCircle2, Eye, FileText, Pencil, Plus, RefreshCw, Save, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AppUser,
  checkCardStatementItem,
  closeCardStatement,
  CreditCard,
  CreditCardStatement,
  CreditCardStatementDetail,
  deleteCardStatementItem,
  downloadCardStatementPdf,
  getCardStatement,
  getCardStatements,
  getCards,
  reallocateCardStatementItem,
  reopenCardStatement,
  saveCard,
  saveCardStatement,
  setCardStatementStatus,
  setCardStatus,
  setStatementFinalTotal,
  setStatementItemsChecked,
  setStatementItemsFinal
} from "../api/client";
import { CartoesCadastrados } from "./cards/CartoesCadastrados";
import { CartoesVinculadosEditor } from "./cards/CartoesVinculadosEditor";
import { ListaDeFaturas } from "./cards/ListaDeFaturas";
import { ResumoDosCartoes } from "./cards/ResumoDosCartoes";
import { resumoDasFaturas, vencimentoRelativo } from "./cards/resumo-de-faturas";
import { FaturaPorCartao } from "./cards/FaturaPorCartao";
import { PeriodFilter } from "../components/PeriodFilter";
import { Notice, useNotice } from "../components/Notice";
import { Button, Money, StatusBadge as DsStatusBadge } from "../design-system";
import type { StatusTone } from "../design-system";

const CARDS_TONE_TO_DS: Record<string, StatusTone> = {
  open: "warning",
  paid: "success",
  cancelled: "neutral",
  warning: "warning",
  overdue: "danger",
  info: "info"
};
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";
import { periodForPreset } from "../utils/period";
import { hojeLocalIso } from "../lib/datas";

type CardsProps = { user: AppUser };

const emptyCard = { id: "", name: "", bankName: "", last4Digits: "", closingDay: 1, dueDay: 1, notes: "", isActive: true };

function todayDate() {
  return hojeLocalIso();
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
  const [statementFilters, setStatementFilters] = useState({ creditCardId: "", status: "" });
  const [period, setPeriod] = useState(periodForPreset("currentYear"));
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
  const [reallocateItem, setReallocateItem] = useState<CreditCardStatementDetail["items"][number] | null>(null);
  const [reallocateTargetId, setReallocateTargetId] = useState("");
  const [reallocateReason, setReallocateReason] = useState("");
  const [reallocateTargets, setReallocateTargets] = useState<CreditCardStatement[]>([]);
  const [openStatementMode, setOpenStatementMode] = useState<"review" | null>(null);
  const itemsSectionRef = useRef<HTMLDivElement | null>(null);
  // A conferência da fatura é uma tela própria (cabe tudo sem apertar); o id vai na URL
  // para o botão Voltar do navegador e o F5 levarem ao lugar certo.
  const [searchParams, setSearchParams] = useSearchParams();
  const faturaDaUrl = searchParams.get("fatura");
  const canManage = hasPermission(user, "cards", "edit");
  // Reabrir fatura fechada/paga e o inverso de fechar: o backend pede "Aprovar".
  const canReopenStatement = hasPermission(user, "cards", "approve");

  async function load() {
    try {
      const [cardRows, statementRows] = await Promise.all([
        getCards(),
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
  }, [statementFilters.creditCardId, statementFilters.status, period.startDate, period.endDate]);

  const resumo = useMemo(() => resumoDasFaturas(statements), [statements]);

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
    const salvo = await saveCard({
      id: cardForm.id,
      name: cardForm.name,
      bankName: cardForm.bankName,
      last4Digits: cardForm.last4Digits,
      notes: cardForm.notes,
      isActive: cardForm.isActive,
      closingDay: Number(cardForm.closingDay),
      dueDay: Number(cardForm.dueDay)
    });
    if (cardForm.id) {
      setNotice({ tone: "success", message: "Cartão atualizado com sucesso." });
      resetCardEditor();
    } else {
      // Segue no editor, já na conta criada, para cadastrar o físico e o virtual.
      setCardForm({ ...emptyCard, ...salvo, notes: salvo.notes ?? "" });
      setNotice({ tone: "success", message: "Cartão criado. Cadastre abaixo os cartões da conta (físico e virtual), se houver." });
    }
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

  function fecharDetalhe() {
    setStatementDetail(null);
    setSearchParams({});
    void load();
  }

  useEffect(() => {
    if (!faturaDaUrl) {
      if (statementDetail) setStatementDetail(null);
      return;
    }
    if (statementDetail?.id === faturaDaUrl) return;
    getCardStatement(faturaDaUrl)
      .then(setStatementDetail)
      .catch((error) => {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir fatura." });
        setSearchParams({});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faturaDaUrl]);

  async function openStatement(statement: CreditCardStatement, opts?: { mode?: "review" }) {
    try {
      setSearchParams({ fatura: statement.id });
      setStatementDetail(await getCardStatement(statement.id));
      if (opts?.mode === "review") setOpenStatementMode("review");
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir fatura." });
    }
  }

  useEffect(() => {
    if (openStatementMode !== "review") return;
    if (!statementDetail) return;
    const target = itemsSectionRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpenStatementMode(null);
  }, [openStatementMode, statementDetail]);

  async function closeStatement(statement: CreditCardStatement) {
    try {
      setStatementDetail(await closeCardStatement(statement.id));
      setNotice({ tone: "success", message: "Fatura fechada com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao fechar fatura." });
    }
  }

  async function reopenStatement(statement: CreditCardStatement) {
    const confirmMessage = statement.status === "PAID"
      ? "Reabrir fatura paga? A parcela gerada (ainda nao baixada) sera cancelada. A fatura voltara a status Aberta."
      : "Reabrir fatura fechada? Ela voltara a status Aberta e podera receber novos lancamentos.";
    if (!window.confirm(confirmMessage)) return;
    try {
      setStatementDetail(await reopenCardStatement(statement.id));
      setNotice({ tone: "success", message: "Fatura reaberta com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao reabrir fatura." });
    }
  }

  async function removeLooseItem(item: CreditCardStatementDetail["items"][number]) {
    if (!statementDetail) return;
    if (!window.confirm(`Excluir a linha "${item.description}"? Se o gasto aconteceu, lance-o como compra no cartão — a linha volta à fatura sozinha.`)) return;
    try {
      await deleteCardStatementItem(statementDetail.id, item.id);
      setStatementDetail(await getCardStatement(statementDetail.id));
      setNotice({ tone: "success", message: "Linha excluída da fatura." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao excluir a linha." });
    }
  }

  async function classificarLinhas(itemIds: string[], cardFinalId: string | null) {
    if (!statementDetail) return;
    try {
      const resultado = await setStatementItemsFinal(statementDetail.id, itemIds, cardFinalId);
      setStatementDetail(await getCardStatement(statementDetail.id));
      if (resultado.reabertaPorDivergencia) {
        setNotice({ tone: "warning", message: "A fatura voltou para Aberta: algum total do extrato deixou de bater depois da troca. Confira de novo." });
      }
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao trocar o cartão da linha." });
    }
  }

  async function conferirLinhas(itemIds: string[]) {
    if (!statementDetail) return;
    try {
      await setStatementItemsChecked(statementDetail.id, itemIds, true);
      setStatementDetail(await getCardStatement(statementDetail.id));
      setNotice({ tone: "success", message: `${itemIds.length} lançamento(s) marcados como conferidos.` });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao conferir as linhas." });
    }
  }

  async function gravarTotalDoExtrato(cardFinalId: string, valor: string) {
    if (!statementDetail) return false;
    try {
      await setStatementFinalTotal(statementDetail.id, cardFinalId, valor.trim() ? valor : null);
      setStatementDetail(await getCardStatement(statementDetail.id));
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gravar o total do extrato." });
      return false;
    }
  }

  async function mudarStatusDaFatura(status: "CHECKED" | "OPEN") {
    if (!statementDetail) return;
    const temFinais = (statementDetail.creditCard.finais ?? []).some((final) => final.isActive);
    const semCartao = statementDetail.items.filter((item) => !item.cardFinalId).length;
    if (status === "CHECKED" && temFinais && semCartao > 0 && !window.confirm(
      `${semCartao} lançamento(s) ainda estão sem cartão definido, então o subtotal de cada cartão não está completo. Marcar como conferida mesmo assim?`
    )) return;
    try {
      await setCardStatementStatus(statementDetail.id, status);
      setStatementDetail(await getCardStatement(statementDetail.id));
      setNotice({ tone: "success", message: status === "CHECKED" ? "Fatura marcada como conferida." : "Fatura voltou para Aberta." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar a fatura." });
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

  async function openReallocate(item: CreditCardStatementDetail["items"][number]) {
    if (!statementDetail) return;
    setReallocateItem(item);
    setReallocateTargetId("");
    setReallocateReason("");
    try {
      const all = await getCardStatements({ creditCardId: statementDetail.creditCardId });
      setReallocateTargets(
        all.filter(
          (s) =>
            (s.status === "OPEN" || s.status === "CHECKED") &&
            !s.generatedPurchaseId &&
            s.id !== statementDetail.id
        )
      );
    } catch {
      setReallocateTargets([]);
    }
  }

  async function submitReallocation() {
    if (!reallocateItem || !reallocateTargetId || reallocateReason.trim().length < 5) return;
    try {
      await reallocateCardStatementItem(reallocateItem.id, {
        targetStatementId: reallocateTargetId,
        reason: reallocateReason.trim()
      });
      if (statementDetail) setStatementDetail(await getCardStatement(statementDetail.id));
      setReallocateItem(null);
      setReallocateTargetId("");
      setReallocateReason("");
      setNotice({ tone: "success", message: "Item realocado com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao realocar item." });
    }
  }

  return (
    <div className="stack cartoes-pagina">
      <Notice notice={notice} />

      {!statementDetail && (
        <>
      <div className="cartoes-pagina-acoes">
        <button className="icon-button" type="button" onClick={load} aria-label="Atualizar cartões" title="Atualizar">
          <RefreshCw size={18} />
        </button>
        {canManage && (
          <Button variant="secondary" leadingIcon={<Plus size={16} />} onClick={openStatementEditor}>Nova fatura</Button>
        )}
        {canManage && (
          <Button leadingIcon={<Plus size={16} />} onClick={() => openCardEditor()}>Novo cartão</Button>
        )}
      </div>

      <ResumoDosCartoes resumo={resumo} temFinais={cards.some((card) => (card.finais ?? []).some((final) => final.isActive))} />

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


      <ListaDeFaturas
        faturas={statements}
        contas={cards}
        filtroStatus={statementFilters.status}
        filtroConta={statementFilters.creditCardId}
        periodo={period}
        podeEditar={canManage}
        podeReabrir={canReopenStatement}
        onFiltroStatus={(status) => setStatementFilters((atual) => ({ ...atual, status }))}
        onFiltroConta={(creditCardId) => setStatementFilters((atual) => ({ ...atual, creditCardId }))}
        onPeriodo={setPeriod}
        onAbrir={(fatura, conferir) => void openStatement(fatura, conferir ? { mode: "review" } : undefined)}
        onFechar={(fatura) => void closeStatement(fatura)}
        onReabrir={(fatura) => void reopenStatement(fatura)}
        onPdf={(fatura) => void pdf(fatura)}
        onNova={openStatementEditor}
      />

      <CartoesCadastrados
        cartoes={cards}
        podeEditar={canManage}
        onNovo={() => openCardEditor()}
        onEditar={openCardEditor}
        onAlternar={(card) => void toggleCard(card)}
      />
        </>
      )}

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

            {cardForm.id ? (
              <CartoesVinculadosEditor
                cardId={cardForm.id}
                finais={cards.find((card) => card.id === cardForm.id)?.finais ?? []}
                onChanged={load}
                onError={(message) => setNotice({ tone: "error", message })}
              />
            ) : (
              <p className="text-muted">Salve o cartão primeiro; em seguida você cadastra o físico e o virtual desta conta.</p>
            )}

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={resetCardEditor}>{cardForm.id ? "Fechar" : "Cancelar"}</button>
              <button className="primary-button" type="button" onClick={submitCard}>
                <Save size={16} /> Salvar cartão
              </button>
            </div>
          </section>
        </div>
      )}

      {statementDetail && (
        <>
          <button type="button" className="fatura-voltar" onClick={fecharDetalhe}>← Voltar às faturas</button>
          <section className="panel fatura-pagina">
            <header className="fatura-detalhe-topo">
              <div className="fatura-detalhe-titulo">
                <p>{statementDetail.creditCard.name} · {statementDetail.creditCard.bankName}</p>
                <h2>
                  Fatura {String(statementDetail.competenceMonth).padStart(2, "0")}/{statementDetail.competenceYear}
                  <DsStatusBadge tone={CARDS_TONE_TO_DS[statementStatusTone(statementDetail.status)] ?? "neutral"}>{statementStatusLabel(statementDetail.status)}</DsStatusBadge>
                </h2>
                <small>
                  Fecha em {formatDate(statementDetail.closingDate)} · vence em {formatDate(statementDetail.dueDate)}
                  {vencimentoRelativo(statementDetail.dueDate, statementDetail.status).texto
                    ? ` (${vencimentoRelativo(statementDetail.dueDate, statementDetail.status).texto})`
                    : ""}
                </small>
              </div>
              <div className="fatura-detalhe-total">
                <span>Total da fatura</span>
                <strong><Money value={statementDetail.totalAmount} /></strong>
                <small>{statementDetail.items.length} lançamento(s)</small>
              </div>
              <div className="fatura-detalhe-acoes">
                {canManage && statementDetail.status === "OPEN" && (
                  <Button leadingIcon={<CheckCircle2 size={16} />} onClick={() => void mudarStatusDaFatura("CHECKED")}>
                    Marcar como conferida
                  </Button>
                )}
                {canManage && statementDetail.status === "CHECKED" && (
                  <Button variant="secondary" onClick={() => void mudarStatusDaFatura("OPEN")}>Voltar para aberta</Button>
                )}
                <Button variant="secondary" onClick={fecharDetalhe}>Fechar</Button>
              </div>
            </header>
            <div ref={itemsSectionRef}>
              <FaturaPorCartao
                detalhe={statementDetail}
                podeEditar={canManage}
                onClassificar={classificarLinhas}
                onTotalDoExtrato={gravarTotalDoExtrato}
                onConferirLinhas={conferirLinhas}
                acoes={{
                  onConferida: (item) => void toggleItemCheck(item),
                  onDivergencia: (item) => void toggleItemDivergence(item),
                  onRealocar: (item) => void openReallocate(item),
                  onExcluir: (item) => void removeLooseItem(item)
                }}
              />
            </div>
            {canManage && ["OPEN", "CHECKED"].includes(statementDetail.status) && (
              <p className="subsection text-muted">
                Toda linha da fatura vem de uma compra. Anuidade, juros ou tarifa: lance como compra paga no cartão, com o item, em{" "}
                <Link to="/compras/nova">Nova compra</Link> — a linha entra aqui sozinha e a despesa aparece no DRE.
              </p>
            )}
          </section>
        </>
      )}

      {reallocateItem && statementDetail && (
        <div className="modal-backdrop">
          <section className="panel modal-panel">
            <div className="section-heading">
              <div>
                <p>Cartão {statementDetail.creditCard.name} — {statementDetail.creditCard.bankName} final {statementDetail.creditCard.last4Digits}</p>
                <h2>Realocar item entre faturas</h2>
              </div>
              <button className="secondary-button" type="button" onClick={() => setReallocateItem(null)}>
                <X size={16} /> Cancelar
              </button>
            </div>

            <div className="subsection">
              <p className="realocar-info-text">
                O item abaixo será <strong>movido</strong> para outra fatura aberta do mesmo cartão. Ele <strong>não será excluído</strong> — apenas transferido.
              </p>
              <div className="realocar-item-card">
                <div className="realocar-item-row">
                  <span className="realocar-label">NF / Descrição</span>
                  <span className="realocar-value">{reallocateItem.description}</span>
                </div>
                <div className="realocar-item-row">
                  <span className="realocar-label">Fornecedor</span>
                  <span className="realocar-value">{reallocateItem.supplierName ?? reallocateItem.purchase?.supplier?.name ?? "—"}</span>
                </div>
                <div className="realocar-item-row">
                  <span className="realocar-label">Valor</span>
                  <Money value={reallocateItem.value} className="realocar-value realocar-value-amount" />
                </div>
                {reallocateItem.installment != null && reallocateItem.totalInstallments != null && (
                  <div className="realocar-item-row">
                    <span className="realocar-label">Parcela</span>
                    <span className="realocar-value">{reallocateItem.installment}/{reallocateItem.totalInstallments}</span>
                  </div>
                )}
              </div>
              <div className="realocar-flow">
                <span className="realocar-flow-origin">
                  De: {String(statementDetail.competenceMonth).padStart(2, "0")}/{statementDetail.competenceYear}
                </span>
                <ArrowRightLeft size={16} className="realocar-flow-arrow" />
                <span className="realocar-flow-dest">
                  Para: {reallocateTargetId
                    ? (() => { const s = reallocateTargets.find(t => t.id === reallocateTargetId); return s ? `${String(s.competenceMonth).padStart(2, "0")}/${s.competenceYear}` : "—"; })()
                    : "aguardando seleção"}
                </span>
              </div>
            </div>

            <div className="subsection">
              <div className="form-grid">
                <label className="full-width">
                  Fatura de destino
                  {reallocateTargets.length === 0 ? (
                    <p className="notice-inline notice-warning">Não há faturas abertas disponíveis para realocação neste cartão. Crie ou aguarde uma fatura aberta.</p>
                  ) : (
                    <select value={reallocateTargetId} onChange={(e) => setReallocateTargetId(e.target.value)}>
                      <option value="">Selecione a fatura de destino</option>
                      {reallocateTargets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {String(s.competenceMonth).padStart(2, "0")}/{s.competenceYear}
                          {s.name ? ` — ${s.name}` : ""}
                          {" "}({statementStatusLabel(s.status)})
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label className="full-width">
                  Motivo da realocação <span className="label-required">(obrigatório)</span>
                  <input
                    value={reallocateReason}
                    onChange={(e) => setReallocateReason(e.target.value)}
                    placeholder="Ex: item lançado na fatura errada"
                    maxLength={200}
                  />
                  {reallocateReason.length > 0 && reallocateReason.trim().length < 5 && (
                    <span className="field-error-msg">Informe ao menos 5 caracteres.</span>
                  )}
                </label>
              </div>
            </div>

            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setReallocateItem(null)}>Cancelar</button>
              <button
                className="primary-button"
                type="button"
                disabled={!reallocateTargetId || reallocateReason.trim().length < 5}
                onClick={() => void submitReallocation()}
              >
                <ArrowRightLeft size={16} /> Confirmar realocação
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
