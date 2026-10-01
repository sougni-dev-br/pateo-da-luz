import { CheckCircle2 } from "lucide-react";
import type { Company, CompanyBankAccount, Payable } from "../../api/client";
import { Notice, type NoticeState } from "../../components/Notice";
import { Button, Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Janela } from "./Janela";
import { favorecidoDoTitulo, formatInstallment, isExtra, isPayroll, isSimpleLedger, isTaxPayment } from "./regras";

export type FormBaixa = {
  paidDate: string;
  paidAmount: string;
  paidPaymentMethod: string;
  paymentNotes: string;
  differenceReason: string;
  payingCompanyId: string;
  companyBankAccountId: string;
};

export type OpcaoForma = { id: string; label: string };

type Props = {
  paying: Payable;
  form: FormBaixa;
  onCampo: <K extends keyof FormBaixa>(campo: K, valor: FormBaixa[K]) => void;
  onEmpresa: (companyId: string) => void;
  formas: OpcaoForma[];
  companies: Company[];
  bankAccounts: CompanyBankAccount[];
  notice: NoticeState | null;
  enviando: boolean;
  onFechar: () => void;
  onConfirmar: () => void;
};

const TOLERANCIA = 0.009;

export function ModalBaixa({ paying, form, onCampo, onEmpresa, formas, companies, bankAccounts, notice, enviando, onFechar, onConfirmar }: Props) {
  const imposto = isTaxPayment(paying);
  const original = Number(paying.amount ?? 0);
  const pago = Number(form.paidAmount || 0);
  const diferenca = Number((pago - original).toFixed(2));
  const temDiferenca = Math.abs(diferenca) > TOLERANCIA;
  const parcela = paying.installment != null ? formatInstallment(paying.installment, paying.totalInstallments, paying.paymentMethodName) : "";

  return (
    <Janela eyebrow="Baixa financeira" titulo={favorecidoDoTitulo(paying)} onFechar={onFechar} ocupado={enviando}>
      <Notice notice={notice} />

      <div className="pay-ctx">
        <div className="pay-ctx-row">
          {isSimpleLedger(paying) ? (
            <>
              <div><span>Tipo</span><strong>{paying.taxDocumentType ?? paying.supplierName}</strong></div>
              {paying.taxCompanyName && <div><span>{isExtra(paying) ? "Pessoa" : isPayroll(paying) ? "Funcionário" : "Empresa"}</span><strong>{paying.taxCompanyName}</strong></div>}
              {paying.taxDescription && <div><span>Descrição</span><strong>{paying.taxDescription}</strong></div>}
              {paying.taxCompetenceDate && <div><span>Competência</span><strong>{formatDate(paying.taxCompetenceDate)}</strong></div>}
            </>
          ) : (
            <>
              {paying.invoiceNumber && <div><span>NF</span><strong>{paying.invoiceNumber}</strong></div>}
              {paying.purchaseNumber && <div><span>Pedido</span><strong>{paying.purchaseNumber}</strong></div>}
              {parcela && <div><span>Parcela</span><strong>{parcela}</strong></div>}
            </>
          )}
          <div><span>Vencimento</span><strong>{formatDate(paying.dueDate)}</strong></div>
          <div className="pg-ctx-valor"><span>Valor original</span><strong className="pay-ctx-amount"><Money value={original} /></strong></div>
        </div>
      </div>

      <div className="form-grid payment-grid">
        <label>
          Data do pagamento *
          <input type="date" value={form.paidDate} onChange={(e) => onCampo("paidDate", e.target.value)} />
        </label>
        <label>
          Valor pago *
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.paidAmount}
            onChange={(e) => onCampo("paidAmount", e.target.value)} />
        </label>
        {!imposto && (
          <label>
            Forma de pagamento *
            <select value={form.paidPaymentMethod} onChange={(e) => onCampo("paidPaymentMethod", e.target.value)}>
              <option value="">Selecione</option>
              {formas.map((opt) => <option key={opt.id} value={`id:${opt.id}`}>{opt.label}</option>)}
            </select>
          </label>
        )}
        <label>
          Observação
          <input value={form.paymentNotes} onChange={(e) => onCampo("paymentNotes", e.target.value)} />
        </label>
        {!imposto && companies.length > 0 && (
          <label>
            Empresa pagadora
            <select value={form.payingCompanyId} onChange={(e) => onEmpresa(e.target.value)}>
              <option value="">Selecione…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
            </select>
          </label>
        )}
        {!imposto && form.payingCompanyId && (
          <label>
            Conta bancária
            <select value={form.companyBankAccountId} onChange={(e) => onCampo("companyBankAccountId", e.target.value)}>
              <option value="">Selecione…</option>
              {bankAccounts.map((ba) => <option key={ba.id} value={ba.id}>{ba.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Diferença e justificativa — compras e folha */}
      {!imposto && pago > 0 && (
        <div className="pay-diff" aria-live="polite">
          {!temDiferenca ? (
            <span className="pay-diff-equal">Sem diferença em relação ao valor original</span>
          ) : diferenca < 0 ? (
            <span className="pay-diff-discount">Desconto: <Money value={Math.abs(diferenca)} /></span>
          ) : (
            <span className="pay-diff-surcharge">Juros / acréscimo: <Money value={diferenca} /></span>
          )}
        </div>
      )}
      {!imposto && temDiferenca && (
        <label className="pay-diff-reason">
          Justificativa da diferença *
          <input value={form.differenceReason} onChange={(e) => onCampo("differenceReason", e.target.value)}
            placeholder="Informe o motivo do desconto ou acréscimo" />
        </label>
      )}

      <p className="pay-confirm-phrase">
        {isSimpleLedger(paying) ? (
          <>Você está baixando <strong>{paying.taxDocumentType ?? paying.supplierName}</strong> no valor de{" "}<strong><Money value={pago > 0 ? pago : original} /></strong>.</>
        ) : (
          <>
            Você está baixando{parcela ? ` a parcela ${parcela}` : ""}
            {paying.invoiceNumber ? ` da NF ${paying.invoiceNumber}` : paying.purchaseNumber ? ` do pedido ${paying.purchaseNumber}` : ""}
            {" "}no valor de{" "}<strong><Money value={pago > 0 ? pago : original} /></strong>.
          </>
        )}
      </p>

      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>Cancelar</Button>
        <Button leadingIcon={<CheckCircle2 size={16} />} onClick={onConfirmar} disabled={enviando}>
          {enviando ? "Registrando…" : "Confirmar baixa"}
        </Button>
      </div>
    </Janela>
  );
}
