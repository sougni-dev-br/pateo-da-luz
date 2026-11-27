import { ClipboardList, Eye, FileText } from "lucide-react";
import type { ReactNode } from "react";
import type { PurchaseOrder } from "../../api/client";
import { IconButton, Money, StatusBadge, Table } from "../../design-system";
import { formatDate } from "../../utils/format";
import { entregaAtrasada, rotuloOrigem, rotuloStatus, tomStatus, valorDo } from "./regras";

type Props = {
  pedidos: PurchaseOrder[];
  hoje: string;
  vazio: ReactNode;
  onAbrir: (pedido: PurchaseOrder) => void;
  onPdf: (pedido: PurchaseOrder) => void;
};

const itens = (n: number) => `${n} ${n === 1 ? "item" : "itens"}`;

function Previsao({ pedido, hoje }: { pedido: PurchaseOrder; hoje: string }) {
  if (!pedido.expectedDeliveryDate) return <span className="po-sem-data">Sem previsão</span>;
  const atrasada = entregaAtrasada(pedido, hoje);
  return (
    <span className={`po-previsao${atrasada ? " po-previsao--atrasada" : ""}`}>
      <strong>{formatDate(pedido.expectedDeliveryDate)}</strong>
      {atrasada && <small>atrasada</small>}
    </span>
  );
}

function TabelaDesktop({ pedidos, hoje, vazio, onAbrir, onPdf }: Props) {
  return (
    <div className="po-desktop-list po-tabela">
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.Th style={{ width: 150 }}>Pedido</Table.Th>
            <Table.Th>Fornecedor</Table.Th>
            <Table.Th style={{ width: 150 }}>Situação</Table.Th>
            <Table.Th style={{ width: 120 }}>Previsão</Table.Th>
            <Table.Th align="right" style={{ width: 130 }}>Estimado</Table.Th>
            <Table.Th actions style={{ width: 116 }}>Ações</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {pedidos.map((pedido) => (
            <Table.Row
              key={pedido.id}
              className={`po-linha${entregaAtrasada(pedido, hoje) ? " po-linha--atrasada" : ""}${pedido.status === "CANCELADO" || pedido.status === "ENCERRADO_LEGADO" ? " po-linha--apagada" : ""}`}
              onClick={() => onAbrir(pedido)}
            >
              <Table.Td className="po-celula">
                <strong>{pedido.code}</strong>
                <small>{formatDate(pedido.createdAt)}</small>
              </Table.Td>
              <Table.Td className="po-celula" title={pedido.supplierNameSnapshot}>
                <strong className="po-fornecedor">{pedido.supplierNameSnapshot}</strong>
                <small>{rotuloOrigem(pedido.source)} · {itens(pedido.totalItems ?? 0)}{pedido.createdByUserName ? ` · ${pedido.createdByUserName}` : ""}</small>
              </Table.Td>
              <Table.Td><StatusBadge tone={tomStatus(pedido.status)}>{rotuloStatus(pedido.status)}</StatusBadge></Table.Td>
              <Table.Td><Previsao pedido={pedido} hoje={hoje} /></Table.Td>
              <Table.Td align="right" className="po-valor"><Money value={valorDo(pedido)} /></Table.Td>
              <Table.Td actions onClick={(e) => e.stopPropagation()}>
                <IconButton icon={<Eye size={16} />} label={`Abrir pedido ${pedido.code}`} onClick={() => onAbrir(pedido)} />
                <IconButton icon={<FileText size={16} />} label={`Baixar PDF do pedido ${pedido.code}`} onClick={() => onPdf(pedido)} />
              </Table.Td>
            </Table.Row>
          ))}
          {pedidos.length === 0 && (
            <Table.Row>
              <Table.Td colSpan={6}>{vazio}</Table.Td>
            </Table.Row>
          )}
        </Table.Body>
      </Table>
    </div>
  );
}

function CartoesMobile({ pedidos, hoje, vazio, onAbrir, onPdf }: Props) {
  return (
    <div className="po-mobile-cards">
      {pedidos.map((pedido) => {
        const atrasada = entregaAtrasada(pedido, hoje);
        return (
          <article
            key={`${pedido.id}-mobile`}
            className={`purch-mobile-card${atrasada ? " po-cartao--atrasado" : ""}${pedido.status === "CANCELADO" ? " purch-card-cancelled" : ""}`}
          >
            <div className="purch-mobile-card-header">
              <div className="purch-mobile-card-title">
                <strong className="purch-mobile-supplier">{pedido.supplierNameSnapshot}</strong>
                <div className="purch-mobile-meta-row">
                  <span className="purch-mobile-ref">{pedido.code}</span>
                  <span className="purch-mobile-date">{formatDate(pedido.createdAt)}</span>
                </div>
              </div>
              <div className="purch-mobile-card-right">
                <strong className="purch-mobile-amount"><Money value={valorDo(pedido)} /></strong>
                <StatusBadge className="purch-mobile-status" tone={tomStatus(pedido.status)}>{rotuloStatus(pedido.status)}</StatusBadge>
              </div>
            </div>
            <div className="purch-mobile-card-body">
              <div className="purch-mobile-row"><span>Previsão</span><Previsao pedido={pedido} hoje={hoje} /></div>
              <div className="purch-mobile-row"><span>Itens</span><span>{itens(pedido.totalItems ?? 0)} · {rotuloOrigem(pedido.source)}</span></div>
            </div>
            <div className="purch-mobile-card-footer">
              <div className="purch-mobile-actions">
                <button className="purch-mobile-btn" type="button" onClick={() => onAbrir(pedido)}><Eye size={15} /> Abrir</button>
                <button className="purch-mobile-btn" type="button" onClick={() => onPdf(pedido)}><FileText size={15} /> PDF</button>
              </div>
            </div>
          </article>
        );
      })}
      {pedidos.length === 0 && (
        <div className="cp-vazio-mobile">
          <ClipboardList size={32} aria-hidden="true" />
          {vazio}
        </div>
      )}
    </div>
  );
}

export function ListaPedidos(props: Props) {
  return (
    <>
      <TabelaDesktop {...props} />
      <CartoesMobile {...props} />
    </>
  );
}
