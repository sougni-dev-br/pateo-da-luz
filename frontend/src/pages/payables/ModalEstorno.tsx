import { RotateCcw } from "lucide-react";
import type { AuditLog, Payable } from "../../api/client";
import { Notice, type NoticeState } from "../../components/Notice";
import { Button, Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Janela } from "./Janela";
import { favorecidoDoTitulo, formatInstallment, isTaxPayment } from "./regras";
import { TabelaAuditoria } from "./TabelaAuditoria";

type EstornoProps = {
  titulo: Payable;
  motivo: string;
  onMotivo: (motivo: string) => void;
  notice: NoticeState | null;
  enviando: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
};

export function ModalEstorno({ titulo, motivo, onMotivo, notice, enviando, onFechar, onConfirmar }: EstornoProps) {
  return (
    <Janela eyebrow="Estorno de pagamento" titulo={favorecidoDoTitulo(titulo)} onFechar={onFechar} ocupado={enviando} largura="estreita">
      <Notice notice={notice} />

      <div className="pay-ctx">
        <div className="pay-ctx-row">
          {isTaxPayment(titulo) ? (
            <>
              {titulo.taxCompanyName && <div><span>Empresa</span><strong>{titulo.taxCompanyName}</strong></div>}
              {titulo.taxCompetenceDate && <div><span>Competência</span><strong>{formatDate(titulo.taxCompetenceDate)}</strong></div>}
            </>
          ) : (
            <>
              {titulo.invoiceNumber && <div><span>NF</span><strong>{titulo.invoiceNumber}</strong></div>}
              {titulo.installment != null && <div><span>Parcela</span><strong>{formatInstallment(titulo.installment, titulo.totalInstallments, titulo.paymentMethodName)}</strong></div>}
            </>
          )}
          <div><span>Valor pago</span><strong><Money value={titulo.paidAmount ?? titulo.amount ?? 0} /></strong></div>
          <div><span>Data pagto.</span><strong>{formatDate(titulo.paidDate)}</strong></div>
        </div>
      </div>

      <p className="pg-nota">O título volta a ficar em aberto. O motivo fica registrado na auditoria.</p>

      <label className="pg-campo-texto">
        <span>Motivo da reversão *</span>
        <textarea rows={3} placeholder="Descreva o motivo do estorno..." value={motivo}
          onChange={(e) => onMotivo(e.target.value)} autoFocus />
      </label>

      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>Cancelar</Button>
        <Button variant="danger" leadingIcon={<RotateCcw size={16} />} disabled={!motivo.trim() || enviando} onClick={onConfirmar}>
          {enviando ? "Estornando…" : "Confirmar estorno"}
        </Button>
      </div>
    </Janela>
  );
}

type HistoricoProps = { titulo: Payable; linhas: AuditLog[]; onFechar: () => void };

export function ModalHistorico({ titulo, linhas, onFechar }: HistoricoProps) {
  return (
    <Janela eyebrow="Histórico do título" titulo={favorecidoDoTitulo(titulo)} onFechar={onFechar}>
      <TabelaAuditoria linhas={linhas} vazio="Este título ainda não tem registros." />
    </Janela>
  );
}
