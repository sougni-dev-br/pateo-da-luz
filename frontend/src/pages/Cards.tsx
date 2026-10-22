import { ArrowRightLeft, CheckCircle2, Plus, RefreshCw, Save, X } from "lucide-react";
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
  shiftPurchaseInstallments,
  saveCardStatement,
  setCardStatementStatus,
  setCardStatus,
  setStatementFinalTotal,
  setStatementItemsChecked,
  setStatementItemsFinal
} from "../api/client";
import { CartoesCadastrados } from "./cards/CartoesCadastrados";
import { CadastroDoCartao } from "./cards/CadastroDoCartao";
import { ListaDeFaturas } from "./cards/ListaDeFaturas";
import { ResumoDosCartoes } from "./cards/ResumoDosCartoes";
import { resumoDasFaturas, vencimentoRelativo } from "./cards/resumo-de-faturas";
import { FaturaPorCartao } from "./cards/FaturaPorCartao";
import { Notice, useNotice } from "../components/Notice";
import { Dialog } from "../components/ui/Dialog";
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
  // "novo" = cadastro em branco; um cartão = edição dele; null = fechado.
  const [cartaoEmEdicao, setCartaoEmEdicao] = useState<CreditCard | "novo" | null>(null);
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
  // Compra parcelada que entrou no mês errado: o mais comum é mover todas as parcelas juntas.
  const [reallocateTodas, setReallocateTodas] = useState(false);
  const [reallocateTargets, setReallocateTargets] = useState<CreditCardStatement[] | null>(null);
  const [openStatementMode, setOpenStatementMode] = useState<"review" | null>(null);
  const itemsSectionRef = useRef<HTMLDivElement | null>(null);
  // A conferência da fatura é uma tela própria (cabe tudo sem apertar); o id vai na URL
  // para o botão Voltar do navegador e o F5 levarem ao lugar certo.
  const [searchParams, setSearchParams] = useSearchParams();
  const faturaDaUrl = searchParams.get("fatura");
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState("");
  const [salvandoFatura, setSalvandoFatura] = useState(false);
  // Operações da fatura em sequência: cliques rápidos não deixam uma resposta velha sobrescrever
  // o estado mais novo.
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  function enfileirar<T>(operacao: () => Promise<T>): Promise<T> {
    const proxima = fila.current.then(operacao, operacao);
    fila.current = proxima.catch(() => undefined);
    return proxima;
  }
  const detalheAbertoAntes = useRef(false);
  const canManage = hasPermission(user, "cards", "edit");
  // Reabrir fatura fechada/paga e o inverso de fechar: o backend pede "Aprovar".
  const canReopenStatement = hasPermission(user, "cards", "approve");

  async function load() {
    try {
      const [cardRows, statementRows] = await Promise.all([
        getCards(),
        // A situação (aberta, conferida...) filtra só a lista, no cliente: o resumo do topo
        // considera todas as faturas do período e do cartão.
        getCardStatements({
          creditCardId: statementFilters.creditCardId || undefined,
          startDate: period.startDate,
          endDate: period.endDate
        })
      ]);
      setCards(cardRows);
      setStatements(statementRows);
      setErroDeCarga("");
    } catch (error) {
      setErroDeCarga(error instanceof Error ? error.message : "Erro ao carregar cartões.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statementFilters.creditCardId, period.startDate, period.endDate]);

  const resumo = useMemo(() => resumoDasFaturas(statements), [statements]);
  const faturasDaLista = useMemo(
    () => (statementFilters.status ? statements.filter((fatura) => fatura.status === statementFilters.status) : statements),
    [statements, statementFilters.status]
  );

  function openCardEditor(card?: CreditCard) {
    setCartaoEmEdicao(card ?? "novo");
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

  async function toggleCard(card: CreditCard) {
    try {
      await setCardStatus(card.id, !card.isActive);
      setNotice({ tone: "success", message: card.isActive ? "Cartão inativado com sucesso." : "Cartão reativado com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao alterar o cartão." });
    }
  }

  async function submitStatement() {
    if (!statementForm.creditCardId) {
      setNotice({ tone: "error", message: "Escolha o cartão da fatura." });
      return;
    }
    if (salvandoFatura) return;
    setSalvandoFatura(true);
    try {
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
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao salvar a fatura." });
      setSalvandoFatura(false);
      return;
    }
    setSalvandoFatura(false);
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
    // replace: o Voltar do navegador não reabre a fatura que acabou de ser fechada.
    setSearchParams({}, { replace: true });
  }

  // Única fonte do detalhe: o id da URL. Resposta de uma fatura anterior é descartada.
  useEffect(() => {
    if (!faturaDaUrl) {
      setStatementDetail(null);
      if (detalheAbertoAntes.current) {
        detalheAbertoAntes.current = false;
        void load();
      }
      return;
    }
    detalheAbertoAntes.current = true;
    if (statementDetail?.id === faturaDaUrl) return;
    let cancelado = false;
    getCardStatement(faturaDaUrl)
      .then((detalhe) => {
        if (!cancelado) setStatementDetail(detalhe);
      })
      .catch((error) => {
        if (cancelado) return;
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao abrir fatura." });
        setSearchParams({}, { replace: true });
      });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faturaDaUrl]);

  function openStatement(statement: CreditCardStatement, opts?: { mode?: "review" }) {
    if (opts?.mode === "review") setOpenStatementMode("review");
    setSearchParams({ fatura: statement.id });
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
    const competencia = `${String(statement.competenceMonth).padStart(2, "0")}/${statement.competenceYear}`;
    const total = statement._count?.items ?? 0;
    const naoConferidos = Math.max(0, total - (statement.itensConferidos ?? 0));
    const avisos = [
      naoConferidos > 0 ? `${naoConferidos} lançamento(s) ainda não conferido(s)` : "",
      (statement.itensSemCartao ?? 0) > 0 ? `${statement.itensSemCartao} sem cartão definido` : ""
    ].filter(Boolean);
    const pergunta = `Fechar a fatura ${competencia}? Isso gera a conta a pagar da fatura.${avisos.length ? `\n\nAtenção: ${avisos.join(" e ")}.` : ""}`;
    if (!window.confirm(pergunta)) return;
    try {
      const fechada = await closeCardStatement(statement.id);
      if (statementDetail?.id === statement.id) setStatementDetail(fechada);
      setNotice({ tone: "success", message: "Fatura fechada com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao fechar fatura." });
    }
  }

  async function reopenStatement(statement: CreditCardStatement) {
    const confirmMessage = statement.status === "PAID"
      ? "Reabrir fatura paga? A parcela gerada (ainda não baixada) será cancelada. A fatura voltará ao status Aberta."
      : "Reabrir fatura fechada? Ela voltará ao status Aberta e poderá receber novos lançamentos.";
    if (!window.confirm(confirmMessage)) return;
    try {
      const reaberta = await reopenCardStatement(statement.id);
      if (statementDetail?.id === statement.id) setStatementDetail(reaberta);
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

  function classificarLinhas(itemIds: string[], cardFinalId: string | null): Promise<boolean> {
    return enfileirar(async () => {
      if (!statementDetail) return false;
      try {
        const resultado = await setStatementItemsFinal(statementDetail.id, itemIds, cardFinalId);
        setStatementDetail(await getCardStatement(statementDetail.id));
        if (resultado.reabertaPorDivergencia) {
          setNotice({ tone: "warning", message: "A fatura voltou para Aberta: algum total do extrato deixou de bater depois da troca. Confira de novo." });
        }
        await load();
        return true;
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao trocar o cartão da linha." });
        return false;
      }
    });
  }

  function conferirLinhas(itemIds: string[]): Promise<void> {
    return enfileirar(async () => {
      if (!statementDetail) return;
      try {
        await setStatementItemsChecked(statementDetail.id, itemIds, true);
        setStatementDetail(await getCardStatement(statementDetail.id));
        setNotice({ tone: "success", message: `${itemIds.length} lançamento(s) marcados como conferidos.` });
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao conferir as linhas." });
      }
    });
  }

  function gravarTotalDoExtrato(cardFinalId: string, valor: string): Promise<boolean> {
    return enfileirar(async () => {
      if (!statementDetail) return false;
      try {
        await setStatementFinalTotal(statementDetail.id, cardFinalId, valor.trim() ? valor : null);
        setStatementDetail(await getCardStatement(statementDetail.id));
        return true;
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gravar o total do extrato." });
        return false;
      }
    });
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

  function toggleItemCheck(item: CreditCardStatementDetail["items"][number]) {
    return enfileirar(async () => {
      if (!statementDetail) return;
      try {
        await checkCardStatementItem(statementDetail.id, item.id, { checked: !item.checked, hasDivergence: item.hasDivergence, notes: item.notes });
        setStatementDetail(await getCardStatement(statementDetail.id));
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar item." });
      }
    });
  }

  function toggleItemDivergence(item: CreditCardStatementDetail["items"][number]) {
    return enfileirar(async () => {
      if (!statementDetail) return;
      try {
        await checkCardStatementItem(statementDetail.id, item.id, { checked: item.checked, hasDivergence: !item.hasDivergence, notes: item.notes });
        setStatementDetail(await getCardStatement(statementDetail.id));
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao atualizar divergência." });
      }
    });
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
    setReallocateTodas(Boolean(item.purchaseId) && (item.totalInstallments ?? 1) > 1);
    setReallocateTargets(null);
    try {
      const all = await getCardStatements({ creditCardId: statementDetail.creditCardId });
      setReallocateTargets(
        all.filter(
          (s) =>
            (s.status === "OPEN" || s.status === "CHECKED") &&
            s.id !== statementDetail.id
        )
      );
    } catch {
      setReallocateTargets([]);
    }
  }

  async function submitReallocation() {
    if (!reallocateItem || reallocateReason.trim().length < 5) return;
    if (!reallocateTodas && !reallocateTargetId) return;
    try {
      let mensagem = "Item realocado com sucesso.";
      if (reallocateTodas && reallocateItem.purchaseId) {
        const resultado = await shiftPurchaseInstallments(reallocateItem.purchaseId, { meses: 1, reason: reallocateReason.trim() });
        mensagem = `${resultado.movidas} parcela(s) da compra movida(s) para o mês seguinte.`;
      } else {
        await reallocateCardStatementItem(reallocateItem.id, {
          targetStatementId: reallocateTargetId,
          reason: reallocateReason.trim()
        });
      }
      if (statementDetail) setStatementDetail(await getCardStatement(statementDetail.id));
      setReallocateItem(null);
      setReallocateTargetId("");
      setReallocateReason("");
      setNotice({ tone: "success", message: mensagem });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao realocar item." });
    }
  }

  return (
    <div className="stack cartoes-pagina">
      <Notice notice={notice} />

      {faturaDaUrl && !statementDetail && (
        <section className="panel" role="status"><p>Carregando fatura…</p></section>
      )}

      {!faturaDaUrl && carregando && (
        <section className="panel" role="status"><p>Carregando cartões…</p></section>
      )}

      {!faturaDaUrl && !carregando && erroDeCarga && (
        <section className="panel" role="alert">
          <p>Não foi possível carregar os cartões: {erroDeCarga}</p>
          <Button onClick={() => { setCarregando(true); void load(); }}>Tentar de novo</Button>
        </section>
      )}

      {!faturaDaUrl && !carregando && !erroDeCarga && (
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
        faturas={faturasDaLista}
        contas={cards}
        filtroStatus={statementFilters.status}
        filtroConta={statementFilters.creditCardId}
        periodo={period}
        podeEditar={canManage}
        podeReabrir={canReopenStatement}
        onFiltroStatus={(status) => setStatementFilters((atual) => ({ ...atual, status }))}
        onFiltroConta={(creditCardId) => setStatementFilters((atual) => ({ ...atual, creditCardId }))}
        onPeriodo={setPeriod}
        onAbrir={(fatura, conferir) => openStatement(fatura, conferir ? { mode: "review" } : undefined)}
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

      {cartaoEmEdicao && canManage && (
        <CadastroDoCartao
          cartao={cartaoEmEdicao === "novo" ? undefined : cartaoEmEdicao}
          onFechar={() => setCartaoEmEdicao(null)}
          onSalvo={(salvo, novo) => {
            setCartaoEmEdicao(null);
            setNotice({ tone: "success", message: novo ? `Cartão ${salvo.name} criado.` : `Cartão ${salvo.name} atualizado.` });
            void load();
          }}
        />
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
        <Dialog
          open
          onOpenChange={(aberto) => { if (!aberto) setReallocateItem(null); }}
          title="Realocar item entre faturas"
          description={`Cartão ${statementDetail.creditCard.name} — ${statementDetail.creditCard.bankName}`}
          size="md"
        >
          <div>
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
                    ? (() => { const s = (reallocateTargets ?? []).find(t => t.id === reallocateTargetId); return s ? `${String(s.competenceMonth).padStart(2, "0")}/${s.competenceYear}` : "—"; })()
                    : "aguardando seleção"}
                </span>
              </div>
            </div>

            {(reallocateItem.totalInstallments ?? 1) > 1 && reallocateItem.purchaseId && (
              <fieldset className="subsection realocar-modo">
                <legend>O que mover?</legend>
                <label>
                  <input type="radio" name="realocar-modo" checked={reallocateTodas} onChange={() => setReallocateTodas(true)} />
                  <span>
                    <strong>Todas as {reallocateItem.totalInstallments} parcelas da compra, 1 mês para frente</strong>
                    <small>Cada parcela vai para a fatura do mês seguinte à que está hoje. A fatura que ainda não existir é criada.</small>
                  </span>
                </label>
                <label>
                  <input type="radio" name="realocar-modo" checked={!reallocateTodas} onChange={() => setReallocateTodas(false)} />
                  <span>
                    <strong>Só esta parcela ({reallocateItem.installment}/{reallocateItem.totalInstallments})</strong>
                    <small>Escolha a fatura de destino.</small>
                  </span>
                </label>
              </fieldset>
            )}

            <div className="subsection">
              <div className="form-grid">
                {!reallocateTodas && (
                <label className="full-width">
                  Fatura de destino
                  {reallocateTargets === null ? (
                    <p className="notice-inline" role="status">Carregando faturas…</p>
                  ) : reallocateTargets.length === 0 ? (
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
                )}
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
                disabled={(!reallocateTodas && !reallocateTargetId) || reallocateReason.trim().length < 5}
                onClick={() => void submitReallocation()}
              >
                <ArrowRightLeft size={16} /> {reallocateTodas ? `Mover as ${reallocateItem.totalInstallments} parcelas` : "Confirmar realocação"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
