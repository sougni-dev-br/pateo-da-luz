import { CheckCircle2, Download, Mail, MessageCircle, Send, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  changePurchaseOrderStatus,
  downloadPurchaseOrderPdf,
  getPurchaseOrder,
  getPurchaseOrderPdfBlob,
  type PurchaseOrder
} from "../api/client";
import { Button } from "../design-system";
import { etapasParaAprovar, linkEmail, linkWhatsapp, mensagemDoPedido, podeEnviarAoFornecedor } from "../lib/envioDoPedido";

type Props = {
  /** Pedido já carregado (com itens); sem ele, a tela busca pelo id. */
  order?: PurchaseOrder | null;
  orderId: string;
  /** Quem pode aprovar: o pedido só vai ao fornecedor depois de aprovado. */
  canApprove: boolean;
  /** Quem pode marcar o pedido como enviado (edição do módulo de pedidos). */
  canSend?: boolean;
  /** Falso onde a página já tem os botões de status (Pedidos de compra): o painel só cuida de PDF e envio. */
  acoesDeStatus?: boolean;
  onAtualizado?: (pedido: PurchaseOrder) => void;
};

const STATUS: Record<string, string> = { RASCUNHO: "Rascunho", EM_REVISAO: "Em revisão", APROVADO: "Aprovado", ENVIADO: "Enviado", RECEBIDO_PARCIAL: "Recebido parcial", RECEBIDO: "Recebido", CANCELADO: "Cancelado" };

/**
 * Do pedido gerado ao fornecedor: aprovar, gerar o PDF, mandar por WhatsApp ou e-mail e marcar como enviado.
 * O compartilhamento do celular leva o PDF como arquivo; sem ele, o PDF é baixado e a mensagem já traz os itens.
 */
export function EnvioDoPedido({ order: recebido, orderId, canApprove, canSend = true, acoesDeStatus = true, onAtualizado }: Props) {
  const [pedido, setPedido] = useState<PurchaseOrder | null>(recebido ?? null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Fornecedor sem telefone no cadastro: dá para digitar o número na hora (não é gravado no cadastro).
  const [telefoneDigitado, setTelefoneDigitado] = useState("");

  useEffect(() => {
    if (recebido) {
      setPedido(recebido);
      return;
    }
    let ativo = true;
    getPurchaseOrder(orderId)
      .then((dados) => ativo && setPedido(dados))
      .catch(() => ativo && setErro("Não foi possível carregar o pedido."));
    return () => {
      ativo = false;
    };
  }, [orderId, recebido]);

  if (!pedido) return <p className="muted" aria-busy="true">{erro ?? "Carregando o pedido…"}</p>;

  const status = String(pedido.status);
  const aprovar = etapasParaAprovar(status);
  const mensagem = mensagemDoPedido(pedido);
  const semTelefoneCadastrado = linkWhatsapp(pedido.supplierPhone, "") == null;
  const whatsapp = linkWhatsapp(semTelefoneCadastrado ? telefoneDigitado : pedido.supplierPhone, mensagem);
  const email = linkEmail(pedido.supplierEmail, `Pedido de compra ${pedido.code} — Pateo da Luz`, mensagem);

  async function executar<T>(chave: string, tarefa: () => Promise<T>) {
    setOcupado(chave);
    setErro(null);
    try {
      return await tarefa();
    } catch (falha) {
      if (!(falha instanceof DOMException && falha.name === "AbortError")) setErro(falha instanceof Error ? falha.message : "Não foi possível concluir.");
      return null;
    } finally {
      setOcupado(null);
    }
  }

  const atualizar = (novo: PurchaseOrder) => {
    // O detalhe volta sem o contato do fornecedor em alguns caminhos: o que já se sabe é mantido.
    const completo = { ...pedido, ...novo, supplierPhone: novo.supplierPhone ?? pedido.supplierPhone, supplierEmail: novo.supplierEmail ?? pedido.supplierEmail, supplierContactName: novo.supplierContactName ?? pedido.supplierContactName };
    setPedido(completo);
    onAtualizado?.(completo);
  };

  async function mudarStatus(etapas: Array<"SEND_REVIEW" | "APPROVE" | "MARK_SENT">) {
    try {
      for (const etapa of etapas) atualizar(await changePurchaseOrderStatus(pedido!.id, etapa));
    } catch (falha) {
      // Se uma etapa passou e a seguinte falhou, a tela mostra o status que o servidor tem de verdade.
      await getPurchaseOrder(pedido!.id).then(atualizar).catch(() => {});
      throw falha;
    }
  }

  const aprovarParaEnvio = () => {
    if (!window.confirm(`Aprovar o pedido ${pedido.code} para enviar a ${pedido.supplierNameSnapshot}?`)) return;
    void executar("aprovar", () => mudarStatus(aprovar));
  };

  const marcarEnviado = () => {
    if (!window.confirm(`Marcar o pedido ${pedido.code} como enviado a ${pedido.supplierNameSnapshot}?`)) return;
    void executar("enviado", () => mudarStatus(["MARK_SENT"]));
  };

  const compartilhar = () => void executar("compartilhar", async () => {
    const blob = await getPurchaseOrderPdfBlob(pedido.id);
    const arquivo = new File([blob], `pedido-${pedido.code}.pdf`, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [arquivo] })) {
      try {
        await navigator.share({ files: [arquivo], title: `Pedido ${pedido.code}`, text: mensagem });
      } catch (falha) {
        // O iPhone recusa o compartilhamento quando o toque "venceu" enquanto o PDF carregava: cai no download.
        if (falha instanceof DOMException && falha.name === "NotAllowedError") await downloadPurchaseOrderPdf(pedido.id, pedido.code);
        else throw falha;
      }
    } else {
      await downloadPurchaseOrderPdf(pedido.id, pedido.code);
    }
  });

  const podeCompartilhar = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && typeof navigator.share === "function";

  return (
    <div className="envio-pedido" data-pedido={pedido.code}>
      <div className="envio-pedido-topo">
        <strong>{pedido.code}</strong>
        <span>{pedido.supplierNameSnapshot}</span>
        <span className={`envio-pedido-status is-${status.toLowerCase()}`} aria-live="polite">{STATUS[status] ?? status}</span>
      </div>

      {acoesDeStatus && aprovar.length > 0 && (
        <div className="envio-pedido-acoes">
          <Button variant="primary" leadingIcon={<CheckCircle2 size={14} />} disabled={!canApprove || ocupado != null} onClick={aprovarParaEnvio}>
            {ocupado === "aprovar" ? "Aprovando…" : "Aprovar para envio"}
          </Button>
          <span className="muted">{canApprove ? "O pedido só vai ao fornecedor depois de aprovado." : "Precisa de quem aprova pedidos de compra."}</span>
          <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={() => void executar("pdf", () => downloadPurchaseOrderPdf(pedido.id, pedido.code))}>PDF</Button>
        </div>
      )}

      {!acoesDeStatus && aprovar.length > 0 && (
        <div className="envio-pedido-acoes">
          <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={() => void executar("pdf", () => downloadPurchaseOrderPdf(pedido.id, pedido.code))}>PDF</Button>
          <span className="muted">Aprove o pedido para enviar ao fornecedor.</span>
        </div>
      )}

      {podeEnviarAoFornecedor(status) && (
        <div className="envio-pedido-acoes">
          {podeCompartilhar && (
            <Button variant="primary" leadingIcon={<Share2 size={14} />} disabled={ocupado != null} onClick={compartilhar}>{ocupado === "compartilhar" ? "Preparando…" : "Compartilhar PDF"}</Button>
          )}
          <Button variant={podeCompartilhar ? "secondary" : "primary"} leadingIcon={<Download size={14} />} disabled={ocupado != null} onClick={() => void executar("pdf", () => downloadPurchaseOrderPdf(pedido.id, pedido.code))}>Baixar PDF</Button>
          {whatsapp
            ? <a className="envio-pedido-link" href={whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden /> WhatsApp</a>
            : (
              <label className="envio-pedido-telefone">
                <span>{semTelefoneCadastrado ? "Fornecedor sem telefone cadastrado. WhatsApp:" : "WhatsApp:"}</span>
                <input type="tel" inputMode="tel" autoComplete="off" placeholder="(DDD) número" value={telefoneDigitado} onChange={(e) => setTelefoneDigitado(e.target.value)} />
              </label>
            )}
          {email
            ? <a className="envio-pedido-link" href={email}><Mail size={14} aria-hidden /> E-mail</a>
            : <span className="envio-pedido-sem" title="Cadastre o e-mail do fornecedor para enviar por e-mail">E-mail indisponível: sem e-mail</span>}
          {acoesDeStatus && canSend && status === "APROVADO" && (
            <Button variant="secondary" leadingIcon={<Send size={14} />} disabled={ocupado != null} onClick={marcarEnviado}>{ocupado === "enviado" ? "Marcando…" : "Marcar como enviado"}</Button>
          )}
        </div>
      )}

      {erro && <p className="req-banner is-erro" role="alert"><span>{erro}</span></p>}
    </div>
  );
}
