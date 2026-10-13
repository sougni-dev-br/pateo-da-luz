import { Camera, Trash2 } from "lucide-react";
import type { WasteEntry } from "../../api/client";
import { IconButton, Money, StatusBadge, Table } from "../../design-system";
import { formatDate, formatNumber } from "../../utils/format";
import { BotaoAnexarFoto } from "./FotoDoDesperdicio";

/** Foto é prova do momento: depois de uns dias "Anexar foto" em toda linha só vira ruído. */
const DIAS_PARA_ANEXAR_FOTO = 2;
const recente = (criadoEm: string) => Date.now() - new Date(criadoEm).getTime() <= DIAS_PARA_ANEXAR_FOTO * 86_400_000;

type Props = {
  itens: WasteEntry[];
  veCusto: boolean;
  /** Id de quem está usando: só o autor (ou a gestão) pode anexar foto, então o botão só aparece nas linhas dele. */
  usuarioId: string | null;
  podeLancar: boolean;
  podeCancelar: boolean;
  anexandoEm: string | null;
  onAnexar: (item: WasteEntry, arquivo: File) => void;
  onVerFoto: (item: WasteEntry) => void;
  onCancelar: (item: WasteEntry) => void;
};

/** Lançamentos do período. Tabela no computador; cartões no celular (as colunas que importam não ficam fora da tela). */
export function ListaDeDesperdicio({ itens, veCusto, usuarioId, podeLancar, podeCancelar, anexandoEm, onAnexar, onVerFoto, onCancelar }: Props) {
  return (
    <div className="waste-table-wrap" role="region" aria-label="Lançamentos de desperdício" tabIndex={0}>
      <Table noScroll className="waste-table">
        <Table.Head>
          <Table.Row>
            <Table.Th>Data</Table.Th>
            <Table.Th minWidth={180}>Item</Table.Th>
            <Table.Th align="right">Quantidade</Table.Th>
            <Table.Th>Motivo</Table.Th>
            {veCusto && <Table.Th align="right">Valor</Table.Th>}
            {podeCancelar && <Table.Th actions>Ações</Table.Th>}
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {itens.map((item) => {
            const cancelado = Boolean(item.cancelledAt);
            const meu = usuarioId != null && item.registeredById === usuarioId;
            return (
              <Table.Row key={item.id} className={cancelado ? "waste-cancelled" : undefined}>
                <Table.Td data-col="data" style={{ whiteSpace: "nowrap" }}>{formatDate(item.occurredOn)}</Table.Td>
                <Table.Td data-col="item">
                  <strong>{item.productName}</strong>
                  {cancelado && <StatusBadge tone="neutral" className="waste-cancelled-tag">Cancelado</StatusBadge>}
                  {!cancelado && podeLancar && !item.hasPhoto && (meu || podeCancelar) && recente(item.createdAt) && (
                    <BotaoAnexarFoto rotulo={`Anexar foto a ${item.productName}`} ocupado={anexandoEm === item.id} onEscolher={(arquivo) => onAnexar(item, arquivo)} />
                  )}
                  {item.hasPhoto && (
                    <button type="button" className="waste-link" onClick={() => onVerFoto(item)}>
                      <Camera size={14} aria-hidden /> Ver foto
                    </button>
                  )}
                  {(item.sectorName || item.notes || (!cancelado && !item.hasCost)) && (
                    <small className="waste-sub">{[item.sectorName, item.notes, !cancelado && !item.hasCost ? "sem custo conhecido" : null].filter(Boolean).join(" · ")}</small>
                  )}
                  {cancelado && <small className="waste-sub">Motivo do cancelamento: {item.cancelReason}</small>}
                </Table.Td>
                <Table.Td data-col="quantidade" align="right" style={{ whiteSpace: "nowrap" }}>
                  {formatNumber(item.quantity)} {item.unit ?? ""}
                </Table.Td>
                <Table.Td data-col="motivo"><StatusBadge tone="neutral">{item.reasonLabel}</StatusBadge></Table.Td>
                {veCusto && (
                  <Table.Td data-col="valor" align="right">
                    {cancelado ? "cancelado" : typeof item.totalCost === "number"
                      ? <><Money value={item.totalCost} />{item.kind === "PRATO" && <small className="waste-sub">custo da ficha</small>}</>
                      : "sem custo"}
                  </Table.Td>
                )}
                {podeCancelar && (
                  <Table.Td data-col="acoes" actions>
                    {!cancelado && <IconButton icon={<Trash2 size={16} />} label={`Cancelar lançamento de ${item.productName}`} onClick={() => onCancelar(item)} />}
                  </Table.Td>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </div>
  );
}
