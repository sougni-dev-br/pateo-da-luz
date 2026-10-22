import { Copy, Eye, Package, Pencil, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Purchase } from "../../api/client";
import {
  Button,
  EmptyState,
  IconButton,
  Money,
  RowMenu,
  StatusBadge,
  Table
} from "../../design-system";
import { formatDate } from "../../utils/format";
import type { ResumoVencimento } from "./vencimento";

export type LinhaCompra = { compra: Purchase; vencimento: ResumoVencimento };

export type AcoesLista = {
  podeCriar: boolean;
  podeEditar: boolean;
  podeCancelar: boolean;
  onVer: (compra: Purchase) => void;
  onEditar: (compra: Purchase) => void;
  onCopiar: (compra: Purchase) => void;
  onCancelar: (compra: Purchase) => void;
  onRestaurar: (compra: Purchase) => void;
  onNova: () => void;
};

const ROTULO_CICLO: Record<string, string> = {
  OPEN: "Aberto",
  CHECKED: "Conferido",
  CLOSED: "Fechado",
  PAID: "Pago",
  CANCELLED: "Cancelado"
};

function referencia(compra: Purchase): string {
  return compra.invoiceNumber ? `NF ${compra.invoiceNumber}` : compra.purchaseNumber ?? "Compra manual";
}

function competencia(compra: Purchase): string {
  return `${String(compra.competenceMonth).padStart(2, "0")}/${compra.competenceYear}`;
}

function resumoItens(compra: Purchase): string {
  const primeiro = compra.items[0];
  if (!primeiro) return "-";
  const extra = compra.items.length > 1 ? ` +${compra.items.length - 1}` : "";
  return `${primeiro.rawProductCode ? `${primeiro.rawProductCode} • ` : ""}${primeiro.rawProductName}${extra}`;
}

function pagamento(compra: Purchase): { titulo: string; detalhe: string } {
  if (compra.cycleStatus != null) {
    return { titulo: "Ciclo fornecedor", detalhe: ROTULO_CICLO[compra.cycleStatus] ?? compra.cycleStatus };
  }
  const n = compra.installments.length;
  const detalhe =
    compra.reimbursementPayeeId && n === 0 ? "Reembolso"
    : compra.creditCardId && n === 0 ? "Fatura(s) cartão"
    : `${n} parcela(s)`;
  return { titulo: compra.installments[0]?.paymentMethodName ?? compra.paymentMethod ?? "-", detalhe };
}

/** Célula/linha de vencimento: data em destaque, prazo e parcelas abaixo, cor pelo tom. */
function Vencimento({ resumo }: { resumo: ResumoVencimento }) {
  if (resumo.tom === "pago") {
    return (
      <div className="cp-venc cp-venc--pago">
        <StatusBadge tone="success">Paga</StatusBadge>
        {resumo.prazo && <small>{resumo.prazo}</small>}
        {resumo.parcelas && <small>{resumo.parcelas}</small>}
      </div>
    );
  }
  return (
    <div className={`cp-venc cp-venc--${resumo.tom}`}>
      <strong>{resumo.rotulo}</strong>
      {resumo.prazo && <small className="cp-venc-prazo">{resumo.prazo}</small>}
      {resumo.parcelas && <small>{resumo.parcelas}</small>}
    </div>
  );
}

function Vazio({ acoes }: { acoes: AcoesLista }) {
  return (
    <EmptyState
      title="Nenhuma compra encontrada"
      description="Ajuste os filtros ou cadastre uma nova compra."
      action={acoes.podeCriar ? <Button leadingIcon={<Plus size={15} />} onClick={acoes.onNova}>Nova compra</Button> : undefined}
    />
  );
}

function MenuMais({ compra, acoes }: { compra: Purchase; acoes: AcoesLista }): ReactNode {
  const itens = [
    ...(acoes.podeCriar
      ? [{ label: "Copiar para nova compra", icon: <Copy size={15} />, onClick: () => acoes.onCopiar(compra) }]
      : []),
    ...(acoes.podeCancelar
      ? [
          { separator: true as const },
          compra.status === "CANCELLED"
            ? { label: "Restaurar", onClick: () => acoes.onRestaurar(compra) }
            : { label: "Cancelar compra", icon: <Trash2 size={15} />, tone: "danger" as const, onClick: () => acoes.onCancelar(compra) }
        ]
      : [])
  ];
  return itens.length ? <RowMenu label={`Mais ações — ${compra.supplier.name}`} items={itens} /> : null;
}

function TabelaDesktop({ linhas, acoes }: { linhas: LinhaCompra[]; acoes: AcoesLista }) {
  return (
    <div className="purchases-desktop-list cp-tabela">
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.Th style={{ width: 140 }}>Compra</Table.Th>
            <Table.Th>Fornecedor</Table.Th>
            <Table.Th style={{ width: 160 }}>Itens</Table.Th>
            <Table.Th style={{ width: 120 }}>Pagamento</Table.Th>
            <Table.Th style={{ width: 140 }}>Vencimento</Table.Th>
            <Table.Th align="right" style={{ width: 100 }}>Total</Table.Th>
            <Table.Th actions style={{ width: 132 }}>Ações</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {linhas.map(({ compra, vencimento }) => {
            const pag = pagamento(compra);
            const cancelada = compra.status === "CANCELLED";
            return (
              <Table.Row
                key={compra.id}
                className={`cp-linha cp-linha--${vencimento.tom}${cancelada ? " cp-linha--cancelada" : ""}`}
                onClick={() => acoes.onVer(compra)}
              >
                <Table.Td className="purchase-main-cell">
                  <strong>{referencia(compra)}</strong>
                  <small>{formatDate(compra.purchaseDate)} • {competencia(compra)}</small>
                </Table.Td>
                <Table.Td truncate className="purchase-supplier-cell" title={compra.supplier.name}>
                  <strong className="truncate-cell">{compra.supplier.name}</strong>
                  <small>{compra.supplier.document ?? compra.rawSupplierCode ?? "Sem documento"}</small>
                </Table.Td>
                <Table.Td className="purchase-items-summary">
                  <strong>{compra.items.length} {compra.items.length === 1 ? "item" : "itens"}</strong>
                  <small className="truncate-cell" title={compra.items.map((i) => i.rawProductName).join(", ")}>{resumoItens(compra)}</small>
                </Table.Td>
                <Table.Td className="purchase-payment-cell">
                  <strong>{pag.titulo}</strong>
                  <small>{pag.detalhe}</small>
                </Table.Td>
                <Table.Td>
                  {cancelada ? (
                    <div className="cp-venc cp-venc--neutro">
                      <StatusBadge tone="neutral">Cancelada</StatusBadge>
                      {compra.cancellationReason && <small className="cp-motivo" title={compra.cancellationReason}>{compra.cancellationReason}</small>}
                    </div>
                  ) : (
                    <Vencimento resumo={vencimento} />
                  )}
                </Table.Td>
                <Table.Td align="right" style={{ whiteSpace: "nowrap" }}><Money value={Number(compra.totalAmount ?? 0)} /></Table.Td>
                <Table.Td actions onClick={(e) => e.stopPropagation()}>
                  <IconButton icon={<Eye size={16} />} label="Ver compra" onClick={() => acoes.onVer(compra)} />
                  {acoes.podeEditar && !cancelada && <IconButton icon={<Pencil size={16} />} label="Editar" onClick={() => acoes.onEditar(compra)} />}
                  <MenuMais compra={compra} acoes={acoes} />
                </Table.Td>
              </Table.Row>
            );
          })}
          {linhas.length === 0 && (
            <Table.Row>
              <Table.Td colSpan={7}><Vazio acoes={acoes} /></Table.Td>
            </Table.Row>
          )}
        </Table.Body>
      </Table>
    </div>
  );
}

function CartoesMobile({ linhas, acoes }: { linhas: LinhaCompra[]; acoes: AcoesLista }) {
  return (
    <div className="purchases-mobile-list">
      {linhas.map(({ compra, vencimento }) => {
        const pag = pagamento(compra);
        const cancelada = compra.status === "CANCELLED";
        return (
          <article className={`purch-mobile-card cp-cartao--${vencimento.tom}${cancelada ? " purch-card-cancelled" : ""}`} key={`${compra.id}-mobile`}>
            <div className="purch-mobile-card-header">
              <div className="purch-mobile-card-title">
                <strong className="purch-mobile-supplier">{compra.supplier.name}</strong>
                <div className="purch-mobile-meta-row">
                  <span className="purch-mobile-ref">{referencia(compra)}</span>
                  <span className="purch-mobile-date">{formatDate(compra.purchaseDate)}</span>
                </div>
              </div>
              <div className="purch-mobile-card-right">
                <strong className="purch-mobile-amount"><Money value={compra.totalAmount} /></strong>
                {cancelada && <StatusBadge className="purch-mobile-status" tone="neutral">Cancelada</StatusBadge>}
              </div>
            </div>
            <div className="purch-mobile-card-body">
              <div className="purch-mobile-row">
                <span>Vencimento</span>
                {cancelada ? <span>—</span> : <Vencimento resumo={vencimento} />}
              </div>
              <div className="purch-mobile-row">
                <span>Itens</span>
                <span>{compra.items.length} {compra.items.length === 1 ? "item" : "itens"}{compra.items[0] ? ` · ${compra.items[0].rawProductName}${compra.items.length > 1 ? ` +${compra.items.length - 1}` : ""}` : ""}</span>
              </div>
              <div className="purch-mobile-row">
                <span>Pagamento</span>
                <span>{pag.titulo} · {pag.detalhe}</span>
              </div>
            </div>
            <div className="purch-mobile-card-footer">
              <div className="purch-mobile-actions">
                <button className="purch-mobile-btn" type="button" onClick={() => acoes.onVer(compra)}><Eye size={15} /> Ver</button>
                {acoes.podeEditar && !cancelada && <button className="purch-mobile-btn" type="button" onClick={() => acoes.onEditar(compra)}><Pencil size={15} /> Editar</button>}
                {acoes.podeCriar && <button className="purch-mobile-btn purch-mobile-btn-ghost" type="button" title="Copiar" onClick={() => acoes.onCopiar(compra)}><Copy size={14} /></button>}
                {acoes.podeCancelar && (
                  cancelada
                    ? <button className="purch-mobile-btn purch-mobile-btn-ghost" type="button" onClick={() => acoes.onRestaurar(compra)}>Restaurar</button>
                    : <button className="purch-mobile-btn purch-mobile-btn-danger" type="button" title="Cancelar" onClick={() => acoes.onCancelar(compra)}><Trash2 size={14} /></button>
                )}
              </div>
            </div>
          </article>
        );
      })}
      {linhas.length === 0 && (
        <div className="cp-vazio-mobile">
          <Package size={32} aria-hidden="true" />
          <Vazio acoes={acoes} />
        </div>
      )}
    </div>
  );
}

export function ListaCompras({ linhas, acoes }: { linhas: LinhaCompra[]; acoes: AcoesLista }) {
  return (
    <>
      <TabelaDesktop linhas={linhas} acoes={acoes} />
      <CartoesMobile linhas={linhas} acoes={acoes} />
    </>
  );
}
