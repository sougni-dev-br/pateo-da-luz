import type { AuditLog, Payable, PurchaseDetail } from "../../api/client";
import { Money } from "../../design-system";
import { formatDate, formatNumber } from "../../utils/format";
import { Campo, StatusTitulo as Status } from "./Campos";
import { Janela } from "./Janela";
import { formatInstallment } from "./regras";
import { TabelaAuditoria } from "./TabelaAuditoria";

type Props = {
  titulo: Payable;
  compra: PurchaseDetail;
  historico: AuditLog[];
  onFechar: () => void;
};

/** Título de compra: resumo, itens da NF, parcelas e auditoria. Somente leitura. */
export function DetalheTitulo({ titulo, compra, historico, onFechar }: Props) {
  const baixas = historico.filter((a) => a.action.includes("PAY") || a.action.includes("REVERSE"));
  const pago = ["PAID", "PAID_LATE"].includes(titulo.status) && titulo.paidDate;

  return (
    <Janela eyebrow="Título de compra · somente leitura" titulo={titulo.supplierName} onFechar={onFechar} largura="larga">
      <section className="modal-section pg-sec-primeira">
        <div className="pg-resumo-titulo">
          <dl className="pg-campos">
            <Campo rotulo="Status"><Status status={titulo.status} /></Campo>
            <Campo rotulo="Vencimento">{formatDate(titulo.dueDate)}</Campo>
            <Campo rotulo="Valor original"><Money value={titulo.amount ?? 0} /></Campo>
            {pago && <Campo rotulo="Pago em">{formatDate(titulo.paidDate)}</Campo>}
            {pago && <Campo rotulo="Valor pago"><Money value={titulo.paidAmount ?? 0} /></Campo>}
            {titulo.invoiceNumber && <Campo rotulo="NF">{titulo.invoiceNumber}</Campo>}
            {titulo.purchaseNumber && <Campo rotulo="Pedido">{titulo.purchaseNumber}</Campo>}
            {titulo.installment != null && (
              <Campo rotulo="Parcela">{formatInstallment(titulo.installment, titulo.totalInstallments, titulo.paymentMethodName)}</Campo>
            )}
            <Campo rotulo="Data da compra">{formatDate(compra.purchaseDate)}</Campo>
            <Campo rotulo="Forma">{compra.paymentMethodName ?? compra.paymentMethod ?? "-"}</Campo>
            <Campo rotulo="Total da NF"><Money value={compra.totalAmount} /></Campo>
          </dl>
        </div>
      </section>

      <section className="modal-section">
        <h3 className="modal-section-title">Itens da compra ({compra.items.length})</h3>
        <div className="table-wrap modal-table-scroll">
          <table className="pg-tabela">
            <thead>
              <tr>
                <th>Código</th><th>Produto</th><th>Categoria</th>
                <th>Unidade</th><th className="pg-num">Qtd.</th><th className="pg-num">Unit.</th><th className="pg-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {compra.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.rawProductCode ?? item.productCode ?? "-"}</td>
                  <td>{item.rawProductName ?? item.productName}</td>
                  <td>{item.rawCategory ?? item.categoryName ?? "-"}</td>
                  <td>{item.unit ?? "-"}</td>
                  <td className="pg-num">{formatNumber(Number(item.quantity))}</td>
                  <td className="pg-num"><Money value={item.unitPrice} /></td>
                  <td className="pg-num"><Money value={item.totalPrice} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="modal-section">
        <h3 className="modal-section-title">Parcelas</h3>
        <div className="table-wrap">
          <table className="pg-tabela">
            <thead>
              <tr>
                <th>Forma</th><th>Vencimento</th><th>Parcela</th>
                <th className="pg-num">Valor</th><th>Pago em</th><th className="pg-num">Valor pago</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {compra.installments.map((inst) => (
                <tr key={inst.id}>
                  <td>{inst.paymentMethodName ?? compra.paymentMethodName ?? "-"}</td>
                  <td className="pg-tnum">{formatDate(inst.dueDate)}</td>
                  <td>{inst.installment != null ? formatInstallment(inst.installment, inst.totalInstallments, inst.paymentMethodName) : "-"}</td>
                  <td className="pg-num"><Money value={inst.amount ?? 0} /></td>
                  <td className="pg-tnum">{formatDate(inst.paidDate)}</td>
                  <td className="pg-num"><Money value={inst.paidAmount ?? 0} /></td>
                  <td><Status status={inst.status ?? "OPEN"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {baixas.length > 0 && (
        <section className="modal-section">
          <h3 className="modal-section-title">Histórico de baixas</h3>
          <TabelaAuditoria linhas={baixas} />
        </section>
      )}

      <details className="modal-section modal-section-audit">
        <summary className="modal-section-title modal-section-summary">Auditoria completa</summary>
        <div className="pg-auditoria">
          <TabelaAuditoria linhas={[...historico, ...compra.audits]} />
        </div>
      </details>
    </Janela>
  );
}
