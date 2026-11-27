import { Check, CheckCircle2, Download, FileText, PackageCheck, Save, Send, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cancelPurchaseOrder,
  changePurchaseOrderStatus,
  downloadPurchaseOrderCsv,
  downloadPurchaseOrderPdf,
  getNotasDoPedido,
  getPurchaseOrder,
  type NotaDoPedido,
  type PurchaseOrder,
  receivePurchaseOrder,
  updatePurchaseOrder
} from "../../api/client";
import { EnvioDoPedido } from "../../components/EnvioDoPedido";
import { Alert, Button, Money, PanelEyebrow, StatusBadge, Textarea } from "../../design-system";
import { podeEnviarAoFornecedor } from "../../lib/envioDoPedido";
import { formatDate, formatNumber } from "../../utils/format";
import { Janela } from "../payables/Janela";
import { AvisoMetaCmv } from "./AvisoMetaCmv";
import { type ItemRascunho, ItensDoPedido } from "./ItensDoPedido";
import { diaUtc, passosDoFluxo, rotuloOrigem, rotuloStatus, tomStatus, valorDo } from "./regras";

type Permissoes = { operar: boolean; aprovar: boolean; verMetaCmv: boolean };

type Props = {
  pedidoId: string;
  permissoes: Permissoes;
  onFechar: () => void;
  /** Avisa a lista que o pedido mudou (status, quantidades, valor). */
  onMudou: (mensagem: string) => void;
};

type Rascunho = { expectedDeliveryDate: string; notes: string; items: Record<string, ItemRascunho> };

function rascunhoDe(pedido: PurchaseOrder): Rascunho {
  return {
    expectedDeliveryDate: diaUtc(pedido.expectedDeliveryDate),
    notes: pedido.notes ?? "",
    items: Object.fromEntries((pedido.items ?? []).map((item) => [item.id, {
      requestedQuantity: String(item.requestedQuantity ?? ""),
      receivedQuantity: String(item.receivedQuantity ?? ""),
      notes: item.notes ?? ""
    }]))
  };
}

const mensagemDe = (falha: unknown, padrao: string) => (falha instanceof Error ? falha.message : padrao);

export function DetalhePedido({ pedidoId, permissoes, onFechar, onMudou }: Props) {
  const [pedido, setPedido] = useState<PurchaseOrder | null>(null);
  const [notas, setNotas] = useState<NotaDoPedido[]>([]);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");

  function aplicar(detalhe: PurchaseOrder) {
    const novo = rascunhoDe(detalhe);
    setPedido(detalhe);
    setRascunho(novo);
    setOriginal(JSON.stringify(novo));
  }

  useEffect(() => {
    let ativo = true;
    Promise.all([getPurchaseOrder(pedidoId), getNotasDoPedido(pedidoId).catch(() => ({ items: [] as NotaDoPedido[] }))])
      .then(([detalhe, ligadas]) => {
        if (!ativo) return;
        aplicar(detalhe);
        setNotas(ligadas.items);
      })
      .catch((falha) => ativo && setErro(mensagemDe(falha, "Não foi possível abrir o pedido.")));
    return () => { ativo = false; };
  }, [pedidoId]);

  const alterado = rascunho != null && JSON.stringify(rascunho) !== original;
  const passos = useMemo(() => (pedido ? passosDoFluxo(pedido) : []), [pedido]);

  /** `avisarLista: false` no salvamento que antecede a troca de status: a lista recarrega uma vez só. */
  async function executar(chave: string, tarefa: () => Promise<PurchaseOrder>, mensagem: string, avisarLista = true) {
    setOcupado(chave);
    setErro(null);
    setAviso(null);
    try {
      aplicar(await tarefa());
      setAviso(mensagem);
      if (avisarLista) onMudou(mensagem);
      return true;
    } catch (falha) {
      setErro(mensagemDe(falha, "Não foi possível concluir."));
      return false;
    } finally {
      setOcupado(null);
    }
  }

  function fechar() {
    if (ocupado) return;
    if (alterado && !window.confirm("Há alterações não salvas neste pedido. Fechar mesmo assim?")) return;
    onFechar();
  }

  if (!pedido || !rascunho) {
    return (
      <Janela eyebrow="Pedido de compra" titulo="Carregando…" onFechar={onFechar} largura="larga">
        {erro ? <Alert tone="error" role="alert">{erro}</Alert> : <div className="cp-carregando" role="status" aria-label="Carregando pedido"><div className="cp-esqueleto" /><div className="cp-esqueleto" /></div>}
      </Janela>
    );
  }

  const status = pedido.status;
  const editavel = status === "RASCUNHO" && permissoes.operar;
  const recebendo = ["ENVIADO", "RECEBIDO_PARCIAL"].includes(status) && permissoes.operar;
  const cancelavel = !["RECEBIDO", "CANCELADO", "ENCERRADO_LEGADO"].includes(status) && permissoes.operar;
  const id = pedido.id;

  const salvar = (avisarLista = true) => executar("salvar", () => updatePurchaseOrder(id, {
    expectedDeliveryDate: rascunho.expectedDeliveryDate || null,
    notes: rascunho.notes,
    items: Object.entries(rascunho.items).map(([itemId, item]) => ({ id: itemId, requestedQuantity: item.requestedQuantity, notes: item.notes }))
  }), "Pedido salvo.", avisarLista);

  async function mudarStatus(acao: "SEND_REVIEW" | "APPROVE" | "MARK_SENT") {
    const textos = { SEND_REVIEW: "enviar para revisão", APPROVE: "aprovar", MARK_SENT: "marcar como enviado" };
    if (!window.confirm(`Confirmar: ${textos[acao]} o pedido ${pedido!.code}?`)) return;
    // Mandar para revisão leva junto o que foi digitado: antes as quantidades editadas se perdiam.
    if (acao === "SEND_REVIEW" && alterado && !(await salvar(false))) return;
    await executar(acao, () => changePurchaseOrderStatus(id, acao), "Situação do pedido atualizada.");
  }

  const receber = () => executar("receber", () => receivePurchaseOrder(id, Object.entries(rascunho.items).map(([itemId, item]) => ({ id: itemId, receivedQuantity: item.receivedQuantity || 0 }))), "Recebimento registrado.");

  async function confirmarCancelamento() {
    if (!motivo.trim()) return;
    if (await executar("cancelar", () => cancelPurchaseOrder(id, motivo.trim()), "Pedido cancelado.")) {
      setCancelando(false);
      setMotivo("");
    }
  }

  const mudarItem = (itemId: string, campo: keyof ItemRascunho, valor: string) =>
    setRascunho((atual) => atual && ({ ...atual, items: { ...atual.items, [itemId]: { ...atual.items[itemId], [campo]: valor } } }));

  const proxima =
    status === "RASCUNHO" && permissoes.operar ? { chave: "SEND_REVIEW" as const, rotulo: "Enviar para revisão", icone: <Send size={16} /> }
    : status === "EM_REVISAO" && permissoes.aprovar ? { chave: "APPROVE" as const, rotulo: "Aprovar pedido", icone: <CheckCircle2 size={16} /> }
    : status === "APROVADO" && permissoes.operar ? { chave: "MARK_SENT" as const, rotulo: "Marcar como enviado", icone: <Send size={16} /> }
    : null;

  return (
    <Janela
      eyebrow="Pedido de compra"
      titulo={<span className="po-titulo">{pedido.code} <StatusBadge tone={tomStatus(status)}>{rotuloStatus(status)}</StatusBadge></span>}
      onFechar={fechar}
      ocupado={ocupado != null}
      largura="larga"
    >
      <div className="po-detalhe">
        {passos.length > 0 ? (
          <ol className="po-fluxo" aria-label="Andamento do pedido">
            {passos.map((passo) => (
              <li key={passo.chave} className={`po-passo po-passo--${passo.estado}`} aria-current={passo.estado === "atual" ? "step" : undefined}>
                <span className="po-passo-marca" aria-hidden="true">{passo.estado === "feito" ? <Check size={12} strokeWidth={3} /> : null}</span>
                <span className="po-passo-rotulo">{passo.rotulo}</span>
                <small>{passo.data ? formatDate(passo.data) : passo.estado === "atual" ? "agora" : "—"}</small>
              </li>
            ))}
          </ol>
        ) : status === "CANCELADO" ? (
          <Alert tone="error">Cancelado{pedido.canceledAt ? ` em ${formatDate(pedido.canceledAt)}` : ""}{pedido.cancelReason ? `: ${pedido.cancelReason}` : "."}</Alert>
        ) : (
          <Alert tone="info">Pedido antigo, encerrado em lote: já virou compra e não muda mais.</Alert>
        )}

        <dl className="pg-campos po-campos">
          <div className="pg-campo po-campo-largo"><dt>Fornecedor</dt><dd>{pedido.supplierNameSnapshot}</dd></div>
          <div className="pg-campo"><dt>Origem</dt><dd>{rotuloOrigem(pedido.source)}</dd></div>
          <div className="pg-campo"><dt>Responsável</dt><dd>{pedido.createdByUserName ?? "—"}</dd></div>
          <div className="pg-campo">
            <dt>{editavel ? <label htmlFor="po-previsao">Previsão de entrega</label> : "Previsão de entrega"}</dt>
            <dd>
              {editavel
                ? <input id="po-previsao" className="po-data" type="date" value={rascunho.expectedDeliveryDate} onChange={(e) => setRascunho({ ...rascunho, expectedDeliveryDate: e.target.value })} />
                : pedido.expectedDeliveryDate ? formatDate(pedido.expectedDeliveryDate) : "Sem previsão"}
            </dd>
          </div>
          <div className="pg-campo"><dt>Valor estimado</dt><dd className="po-num"><Money value={valorDo(pedido)} /></dd></div>
        </dl>

        <section className="po-secao" aria-labelledby="po-itens">
          <header className="po-secao-topo">
            <PanelEyebrow as="h3" id="po-itens">Itens ({pedido.items?.length ?? 0})</PanelEyebrow>
            {editavel && <span className="po-dica">Ajuste a quantidade solicitada antes de enviar para revisão.</span>}
            {recebendo && <span className="po-dica">Informe o que chegou e registre o recebimento.</span>}
          </header>
          <ItensDoPedido itens={pedido.items ?? []} valores={rascunho.items} editavel={editavel} recebendo={recebendo} onMudar={mudarItem} />
        </section>

        <section className="po-secao">
          <label className="po-rotulo" htmlFor="po-obs-geral">Observações do pedido</label>
          {editavel
            ? <Textarea id="po-obs-geral" rows={2} value={rascunho.notes} onChange={(e) => setRascunho({ ...rascunho, notes: e.target.value })} placeholder="Ex.: entregar pela manhã" />
            : <p className="pg-texto po-obs-geral">{pedido.notes || "Sem observações."}</p>}
        </section>

        {podeEnviarAoFornecedor(status) && (
          <section className="po-secao">
            <PanelEyebrow>Enviar ao fornecedor</PanelEyebrow>
            <EnvioDoPedido order={pedido} orderId={id} canApprove={permissoes.aprovar} canSend={permissoes.operar} acoesDeStatus={false} onAtualizado={(novo) => { aplicar(novo); onMudou("Pedido atualizado."); }} />
          </section>
        )}

        {notas.length > 0 && (
          <section className="po-secao">
            <PanelEyebrow>Notas que atenderam este pedido</PanelEyebrow>
            <ul className="po-notas">
              {notas.map((nota) => (
                <li key={`${nota.purchaseId}-${nota.productName}`} className={nota.cancelada ? "po-nota-cancelada" : undefined}>
                  <strong>{nota.purchaseNumber ?? "Compra"}{nota.invoiceNumber ? ` · NF ${nota.invoiceNumber}` : ""}</strong>
                  <span>{formatDate(nota.purchaseDate)} · {nota.productName}: {formatNumber(nota.quantity)} {nota.unit ?? ""}{nota.cancelada ? " (nota cancelada, não conta)" : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {permissoes.verMetaCmv && <AvisoMetaCmv orderId={id} versao={pedido.updatedAt} />}

        {erro && <Alert tone="error" role="alert">{erro}</Alert>}
        {aviso && !erro && <Alert tone="success" role="status">{aviso}</Alert>}

        {cancelando && (
          <div className="po-cancelar" role="group" aria-label="Cancelar pedido">
            <label className="po-rotulo" htmlFor="po-motivo">Motivo do cancelamento</label>
            <Textarea id="po-motivo" rows={2} autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: fornecedor sem o produto" />
            <div className="po-cancelar-acoes">
              <Button variant="secondary" size="sm" onClick={() => { setCancelando(false); setMotivo(""); }} disabled={ocupado != null}>Voltar</Button>
              <Button variant="danger" size="sm" leadingIcon={<XCircle size={15} />} disabled={!motivo.trim() || ocupado != null} onClick={() => void confirmarCancelamento()}>
                {ocupado === "cancelar" ? "Cancelando…" : "Confirmar cancelamento"}
              </Button>
            </div>
          </div>
        )}

        <footer className="po-rodape">
          <div className="po-rodape-arquivos">
            <Button variant="secondary" size="sm" leadingIcon={<FileText size={15} />} onClick={() => void downloadPurchaseOrderPdf(id, pedido.code)}>PDF</Button>
            <Button variant="secondary" size="sm" leadingIcon={<Download size={15} />} onClick={() => void downloadPurchaseOrderCsv(id, pedido.code)}>CSV</Button>
            {cancelavel && !cancelando && (
              <Button variant="secondary" size="sm" className="po-botao-cancelar" leadingIcon={<XCircle size={15} />} onClick={() => setCancelando(true)} disabled={ocupado != null}>Cancelar pedido</Button>
            )}
          </div>
          <div className="po-rodape-fluxo">
            {editavel && (
              <Button variant="secondary" leadingIcon={<Save size={16} />} disabled={!alterado || ocupado != null} onClick={() => void salvar()}>
                {ocupado === "salvar" ? "Salvando…" : "Salvar alterações"}
              </Button>
            )}
            {recebendo && (
              <Button leadingIcon={<PackageCheck size={16} />} disabled={ocupado != null} onClick={() => void receber()}>
                {ocupado === "receber" ? "Registrando…" : "Registrar recebimento"}
              </Button>
            )}
            {proxima && (
              <Button leadingIcon={proxima.icone} disabled={ocupado != null} onClick={() => void mudarStatus(proxima.chave)}>
                {ocupado === proxima.chave ? "Aguarde…" : proxima.rotulo}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </Janela>
  );
}
