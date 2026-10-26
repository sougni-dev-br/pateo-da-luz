import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { RevenueEntry } from "../api/client";
import { EmptyState, IconButton, Money, Table } from "../design-system";
import { formatDate, formatNumber } from "../utils/format";
import { displayChannel, MoneyOrDash, RevenueStatusBadge } from "./revenueBits";
import { groupEventEntries, type EntryGroup } from "./revenueGroups";
import { hasAnyValue, weekdayFromIso } from "./revenueView";

type Props = {
  entries: RevenueEntry[];
  eventChannel: string;
  canEdit: boolean;
  canLaunchEvent: boolean;
  onEdit: (entryId: string) => void;
  onCancel: (entry: RevenueEntry) => void;
  onCancelEvent: (group: EntryGroup) => void;
};

function formatRange(group: EntryGroup) {
  return group.firstDate === group.lastDate
    ? formatDate(group.firstDate)
    : `${formatDate(group.firstDate)} a ${formatDate(group.lastDate)}`;
}

function MobileEntryCard({ entry, canEdit, onEdit, onCancel }: {
  entry: RevenueEntry;
  canEdit: boolean;
  onEdit: (entryId: string) => void;
  onCancel: (entry: RevenueEntry) => void;
}) {
  return (
    <article className="revenue-mobile-card">
      <div className="revenue-mobile-row">
        <span>Data</span>
        <strong>{formatDate(entry.date)}</strong>
      </div>
      <div className="revenue-mobile-row">
        <span>Dia da semana</span>
        <span>{entry.weekdayName ?? weekdayFromIso(entry.date)}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>Canal</span>
        <span>{displayChannel(entry.channel)}</span>
      </div>
      {entry.description && (
        <div className="revenue-mobile-row">
          <span>Descrição</span>
          <span>{entry.description}</span>
        </div>
      )}
      <div className="revenue-mobile-row">
        <span>1º turno</span>
        <span><Money value={entry.salesFirstShift ?? 0} /></span>
      </div>
      <div className="revenue-mobile-row">
        <span>2º turno</span>
        <span><Money value={entry.salesSecondShift ?? 0} /></span>
      </div>
      <div className="revenue-mobile-row revenue-mobile-row--highlight">
        <span>Venda total</span>
        <strong><Money value={entry.grossAmount ?? 0} /></strong>
      </div>
      <div className="revenue-mobile-row">
        <span>Serviço</span>
        <span><Money value={entry.serviceAmount ?? 0} /></span>
      </div>
      <div className="revenue-mobile-row">
        <span>TCs</span>
        <span>{formatNumber(Number(entry.tickets ?? 0))}</span>
      </div>
      <div className="revenue-mobile-row">
        <span>Ticket médio</span>
        <span><Money value={entry.ticketAverage ?? 0} /></span>
      </div>
      <div className="revenue-mobile-row">
        <span>Acumulado</span>
        <span><Money value={entry.accumulatedAmount ?? 0} /></span>
      </div>
      <div className="revenue-mobile-row">
        <span>Status</span>
        <RevenueStatusBadge status={entry.status} />
      </div>

      {canEdit && entry.status !== "CANCELLED" ? (
        <div className="revenue-mobile-actions">
          <button className="secondary-button" type="button" onClick={() => onEdit(entry.id)}>
            <Pencil size={15} /> Editar
          </button>
          <button className="secondary-button" type="button" onClick={() => onCancel(entry)}>
            <Trash2 size={15} /> Cancelar
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function RevenueEntriesTable({ entries, eventChannel, canEdit, canLaunchEvent, onEdit, onCancel, onCancelEvent }: Props) {
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => groupEventEntries(entries, eventChannel), [entries, eventChannel]);

  const showShifts = hasAnyValue(entries.flatMap((entry) => [entry.salesFirstShift, entry.salesSecondShift]));
  const showService = hasAnyValue(entries.map((entry) => entry.serviceAmount));
  const showAccumulated = hasAnyValue(entries.map((entry) => entry.accumulatedAmount));
  const columnCount = 8 + Number(showShifts) * 2 + Number(showService) + Number(showAccumulated);
  // Colunas entre a descrição e a venda total que o grupo não tem: ficam vazias na linha-resumo.
  const emptyMiddleCells = Number(showShifts) * 2 + Number(showService);

  function toggleGroup(name: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function renderEntryRow(entry: RevenueEntry, nested: boolean) {
    const canCancel = entry.status !== "CANCELLED" && (canEdit || (canLaunchEvent && entry.channel === eventChannel));
    const canEditEntry = entry.status !== "CANCELLED" && canEdit && entry.channel !== eventChannel;
    return (
      <Table.Row key={entry.id} className={nested ? "revenue-entry-nested" : undefined}>
        <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(entry.date)}</Table.Td>
        <Table.Td>{entry.weekdayName ?? weekdayFromIso(entry.date)}</Table.Td>
        <Table.Td>
          <span>{nested ? "" : displayChannel(entry.channel)}</span>
          {entry.description && <small className="revenue-entry-description">{entry.description}</small>}
        </Table.Td>
        {showShifts && <Table.Td align="right"><MoneyOrDash value={Number(entry.salesFirstShift ?? 0)} /></Table.Td>}
        {showShifts && <Table.Td align="right"><MoneyOrDash value={Number(entry.salesSecondShift ?? 0)} /></Table.Td>}
        {showService && <Table.Td align="right"><MoneyOrDash value={Number(entry.serviceAmount ?? 0)} /></Table.Td>}
        <Table.Td align="right"><strong><MoneyOrDash value={Number(entry.grossAmount ?? 0)} /></strong></Table.Td>
        <Table.Td align="right">{formatNumber(Number(entry.tickets ?? 0))}</Table.Td>
        <Table.Td align="right"><MoneyOrDash value={Number(entry.ticketAverage ?? 0)} /></Table.Td>
        {showAccumulated && <Table.Td align="right"><MoneyOrDash value={Number(entry.accumulatedAmount ?? 0)} /></Table.Td>}
        <Table.Td><RevenueStatusBadge status={entry.status} /></Table.Td>
        <Table.Td actions>
          {canCancel || canEditEntry ? (
            <>
              {canEditEntry && <IconButton icon={<Pencil size={16} />} label="Editar no Caixa" size="sm" onClick={() => onEdit(entry.id)} />}
              {canCancel && <IconButton icon={<Trash2 size={16} />} label="Cancelar lançamento" size="sm" variant="danger" onClick={() => onCancel(entry)} />}
            </>
          ) : (
            "-"
          )}
        </Table.Td>
      </Table.Row>
    );
  }

  function renderGroupRow(group: EntryGroup) {
    const open = openGroups.has(group.name);
    const average = group.tickets > 0 ? group.net / group.tickets : 0;
    return (
      <Fragment key={`group-${group.name}`}>
        <Table.Row className="revenue-entry-group">
          <Table.Td style={{ whiteSpace: "nowrap" }}>{formatRange(group)}</Table.Td>
          <Table.Td>{group.entries.length} lançamentos</Table.Td>
          <Table.Td>
            <button
              type="button"
              className="revenue-group-toggle"
              aria-expanded={open}
              onClick={() => toggleGroup(group.name)}
            >
              <ChevronDown size={15} className={`revenue-chevron${open ? " open" : ""}`} />
              <strong>{group.name}</strong>
            </button>
            <small className="revenue-entry-description">{displayChannel(eventChannel)}</small>
          </Table.Td>
          {Array.from({ length: emptyMiddleCells }, (_, index) => <Table.Td key={index} />)}
          <Table.Td align="right"><strong><MoneyOrDash value={group.gross} /></strong></Table.Td>
          <Table.Td align="right">{formatNumber(group.tickets)}</Table.Td>
          <Table.Td align="right"><MoneyOrDash value={average} /></Table.Td>
          {showAccumulated && <Table.Td />}
          <Table.Td />
          <Table.Td actions>
            {canEdit || canLaunchEvent ? (
              <IconButton icon={<Trash2 size={16} />} label={`Cancelar o evento ${group.name} inteiro`} size="sm" variant="danger" onClick={() => onCancelEvent(group)} />
            ) : (
              "-"
            )}
          </Table.Td>
        </Table.Row>
        {open && group.entries.map((entry) => renderEntryRow(entry, true))}
      </Fragment>
    );
  }

  return (
    <>
      <div className="revenue-desktop-entries">
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Data</Table.Th>
              <Table.Th>Dia da semana</Table.Th>
              <Table.Th>Canal / descrição</Table.Th>
              {showShifts && <Table.Th align="right">1º turno</Table.Th>}
              {showShifts && <Table.Th align="right">2º turno</Table.Th>}
              {showService && <Table.Th align="right">Serviço</Table.Th>}
              <Table.Th align="right">Venda total</Table.Th>
              <Table.Th align="right">TCs</Table.Th>
              <Table.Th align="right">TM</Table.Th>
              {showAccumulated && <Table.Th align="right">Acumulado</Table.Th>}
              <Table.Th>Status</Table.Th>
              <Table.Th actions>Ações</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((row) => (row.kind === "group" ? renderGroupRow(row.group) : renderEntryRow(row.entry, false)))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columnCount}>
                  <EmptyState title="Nenhum faturamento lançado" description="Os lançamentos do período aparecem aqui." />
                </td>
              </tr>
            )}
          </Table.Body>
        </Table>
      </div>

      <div className="revenue-mobile-list">
        {rows.map((row) =>
          row.kind === "group" ? (
            <details key={`group-${row.group.name}`} className="revenue-mobile-group">
              <summary>
                <strong>{row.group.name}</strong>
                <span>{row.group.entries.length} lançamentos · {formatNumber(row.group.tickets)} pessoas · <Money value={row.group.gross} /></span>
              </summary>
              {row.group.entries.map((entry) => (
                <MobileEntryCard
                  key={entry.id}
                  entry={entry}
                  canEdit={false}
                  onEdit={onEdit}
                  onCancel={onCancel}
                />
              ))}
              {(canEdit || canLaunchEvent) && (
                <button className="secondary-button" type="button" onClick={() => onCancelEvent(row.group)}>
                  <Trash2 size={15} /> Cancelar o evento inteiro
                </button>
              )}
            </details>
          ) : (
            <MobileEntryCard
              key={`${row.entry.id}-mobile`}
              entry={row.entry}
              canEdit={canEdit && row.entry.channel !== eventChannel}
              onEdit={onEdit}
              onCancel={onCancel}
            />
          )
        )}
        {rows.length === 0 && <EmptyState title="Nenhum faturamento lançado" description="Os lançamentos do período aparecem aqui." />}
      </div>
    </>
  );
}
