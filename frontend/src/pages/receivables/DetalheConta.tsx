import { Ban, CheckCircle2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { getReceivableDetail, type ReceivableDetail, type ReceivableReceiptView } from "../../api/client";
import { Alert, Button, Money, StatusBadge } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Campo } from "../payables/Campos";
import { Janela } from "../payables/Janela";
import {
  diaDoInstante, estaPendente, ORIGEM_ROTULO, ORIGEM_SELO, podeCancelar, SITUACAO_ROTULO, SITUACAO_TOM, situacaoDe, taxaEfetiva, tituloDaConta
} from "./regras";

type Props = {
  id: string;
  /** Muda quando a tela recarrega depois de uma ação: o detalhe busca de novo. */
  versao: number;
  podeReceber: boolean;
  podeDesfazer: boolean;
  onFechar: () => void;
  onReceber: (c: ReceivableDetail) => void;
  onCancelar: (c: ReceivableDetail) => void;
  onEstornar: (c: ReceivableDetail, recebimento: ReceivableReceiptView) => void;
};

const percentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function DetalheConta({ id, versao, podeReceber, podeDesfazer, onFechar, onReceber, onCancelar, onEstornar }: Props) {
  const [conta, setConta] = useState<ReceivableDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let atual = true;
    setErro(null);
    getReceivableDetail(id)
      .then((d) => { if (atual) setConta(d); })
      .catch((e) => { if (atual) setErro(e instanceof Error ? e.message : "Não foi possível carregar a conta."); });
    return () => { atual = false; };
  }, [id, versao]);

  const titulo = conta ? tituloDaConta(conta.description) : "Conta a receber";
  const situacao = conta ? situacaoDe(conta) : null;
  const taxa = conta ? taxaEfetiva(conta) : null;
  const ativos = conta?.receipts.filter((r) => !r.reversedAt) ?? [];

  return (
    <Janela eyebrow="Conta a receber" titulo={titulo} onFechar={onFechar} largura="media">
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}
      {!conta && !erro && <p className="pg-vazio-curto" role="status">Carregando…</p>}

      {conta && situacao && (
        <div className="rc-detalhe">
          <div className="rc-detalhe-topo">
            <span className={`pg-selo pg-selo--${ORIGEM_SELO[conta.sourceType]}`}>{ORIGEM_ROTULO[conta.sourceType]}</span>
            <StatusBadge tone={SITUACAO_TOM[situacao]}>{SITUACAO_ROTULO[situacao]}</StatusBadge>
          </div>

          <h3 className="modal-section-title pg-sec-primeira">Composição</h3>
          <div className="rc-composicao" role="group" aria-label="Composição do valor">
            <div><span>Valor bruto</span><strong><Money value={conta.grossAmount} /></strong></div>
            <div className={conta.fees > 0 ? "rc-composicao-menos" : undefined}><span>Taxas{taxa !== null && conta.fees > 0 ? ` (${percentual.format(taxa)}%)` : ""}</span><strong>− <Money value={conta.fees} /></strong></div>
            <div className="rc-composicao-total"><span>Líquido a receber</span><strong><Money value={conta.netAmount} /></strong></div>
            {conta.status !== "CANCELLED" && (
              <>
                <div><span>Já recebido</span><strong><Money value={conta.paidAmount ?? 0} /></strong></div>
                <div className={conta.remainingAmount > 0 ? "rc-composicao-falta" : undefined}><span>Falta receber</span><strong><Money value={conta.remainingAmount} /></strong></div>
              </>
            )}
          </div>

          <h3 className="modal-section-title">Datas e origem</h3>
          <dl className="pg-campos">
            <Campo rotulo="Previsto">{formatDate(conta.expectedDate)}</Campo>
            <Campo rotulo="Recebido em">{conta.receivedDate ? formatDate(conta.receivedDate) : "—"}</Campo>
            <Campo rotulo="Competência">{String(conta.competenceMonth).padStart(2, "0")}/{conta.competenceYear}</Campo>
            <Campo rotulo="Cliente / loja">{conta.customerName ?? "—"}</Campo>
            {conta.customerDocument && <Campo rotulo="Documento">{conta.customerDocument}</Campo>}
            {conta.sourceRef && <Campo rotulo="Referência">{conta.sourceRef}</Campo>}
            {conta.installmentNumber && conta.totalInstallments && <Campo rotulo="Parcela">{conta.installmentNumber}/{conta.totalInstallments}</Campo>}
            <Campo rotulo="Empresa">{conta.companyName ?? "—"}</Campo>
          </dl>
          {conta.notes && <p className="pg-nota">Observações: {conta.notes}</p>}

          {conta.status === "CANCELLED" && (
            <Alert tone="warning">
              Conta cancelada{conta.cancelledAt ? ` em ${diaDoInstante(conta.cancelledAt)}` : ""}{conta.cancellationReason ? ` — motivo: ${conta.cancellationReason}` : ""}.
            </Alert>
          )}

          <h3 className="modal-section-title">Recebimentos</h3>
          {conta.receipts.length === 0 ? (
            <p className="pg-vazio-curto">Nenhum recebimento registrado.</p>
          ) : (
            <ul className="rc-recebimentos">
              {conta.receipts.map((r) => (
                <li key={r.id} className={r.reversedAt ? "rc-recebimento rc-recebimento--estornado" : "rc-recebimento"}>
                  <div>
                    <strong><Money value={r.amount} /></strong>
                    <span> em {formatDate(r.receivedDate)}{r.paymentMethod ? ` · ${r.paymentMethod}` : ""}</span>
                    {r.legacy && <small> · anterior ao controle por lançamento</small>}
                    {r.notes && <small className="rc-recebimento-obs">{r.notes}</small>}
                    {r.reversedAt && <small className="rc-recebimento-obs">Estornado em {diaDoInstante(r.reversedAt)}{r.reversalReason ? ` — ${r.reversalReason}` : ""}</small>}
                  </div>
                  {!r.reversedAt && podeDesfazer && conta.status !== "CANCELLED" && (
                    <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={14} />} onClick={() => onEstornar(conta, r)} aria-label={`Estornar o recebimento de ${formatDate(r.receivedDate)}`}>
                      Estornar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {ativos.length === 0 && conta.receipts.length > 0 && <p className="pg-vazio-curto">Todos os recebimentos foram estornados.</p>}

          <div className="modal-actions">
            {podeDesfazer && podeCancelar(conta) && (
              <Button variant="secondary" leadingIcon={<Ban size={16} />} onClick={() => onCancelar(conta)}>Cancelar conta</Button>
            )}
            {podeReceber && estaPendente(conta) && (
              <Button leadingIcon={<CheckCircle2 size={16} />} onClick={() => onReceber(conta)}>Registrar recebimento</Button>
            )}
            <Button variant="secondary" onClick={onFechar}>Fechar</Button>
          </div>
        </div>
      )}
    </Janela>
  );
}
