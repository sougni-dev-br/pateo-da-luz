import { ChevronDown, Pencil, Search, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type { RevenueEntry } from "../api/client";
import { EmptyState, IconButton, Money, PanelEyebrow, StatusBadge, Switch, Table, TextField } from "../design-system";
import { formatDate, formatNumber } from "../utils/format";
import { displayChannel, MoneyOrDash } from "./revenueBits";
import { entryDetails, entryOrigin, isZeroMarker, matchesSearch, visibleDescription, type EntryDetail } from "./revenueEntryView";
import { groupEventEntries, type EntryGroup } from "./revenueGroups";
import { weekdayFromIso } from "./revenueView";

type Props = {
  entries: RevenueEntry[];
  eventChannel: string;
  canEdit: boolean;
  canLaunchEvent: boolean;
  onEdit: (entryId: string) => void;
  onCancel: (entry: RevenueEntry) => void;
  onCancelEvent: (group: EntryGroup) => void;
};

// chevron, data, origem, descrição, bruto, líquido, pessoas, ações
const COLUMN_COUNT = 8;

// "Terça-feira": só a primeira letra maiúscula (o capitalize do CSS poria "Feira" em maiúscula também).
const weekday = (entry: RevenueEntry) => {
  const name = (entry.weekdayName ?? weekdayFromIso(entry.date)).toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
};

function formatRange(group: EntryGroup) {
  return group.firstDate === group.lastDate ? formatDate(group.firstDate) : `${formatDate(group.firstDate)} a ${formatDate(group.lastDate)}`;
}

function Details({ entry }: { entry: RevenueEntry }) {
  const items: EntryDetail[] = entryDetails(entry);
  const tickets = Number(entry.tickets ?? 0);
  const net = Number(entry.netAmount ?? 0);
  if (tickets > 0) items.push({ label: "Ticket médio", kind: "money", value: net / tickets });
  if (items.length === 0) return null;
  return (
    <dl className="revenue-entry-details">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.kind === "money" ? <Money value={Number(item.value)} /> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function hasDetails(entry: RevenueEntry) {
  return entryDetails(entry).length > 0 || Number(entry.tickets ?? 0) > 0;
}

function EntryActions({ entry, canEdit, canLaunchEvent, eventChannel, onEdit, onCancel }: {
  entry: RevenueEntry;
  canEdit: boolean;
  canLaunchEvent: boolean;
  eventChannel: string;
  onEdit: (entryId: string) => void;
  onCancel: (entry: RevenueEntry) => void;
}) {
  const isEvent = entry.channel === eventChannel;
  const canEditEntry = entry.status !== "CANCELLED" && canEdit && !isEvent;
  const canCancel = entry.status !== "CANCELLED" && (canEdit || (canLaunchEvent && isEvent));
  if (!canEditEntry && !canCancel) return null;
  return (
    <>
      {canEditEntry && <IconButton icon={<Pencil size={16} />} label="Editar no Caixa" size="sm" onClick={() => onEdit(entry.id)} />}
      {canCancel && <IconButton icon={<Trash2 size={16} />} label="Cancelar lançamento" size="sm" variant="danger" onClick={() => onCancel(entry)} />}
    </>
  );
}

export function RevenueEntriesTable({ entries, eventChannel, canEdit, canLaunchEvent, onEdit, onCancel, onCancelEvent }: Props) {
  const [search, setSearch] = useState("");
  const [showZero, setShowZero] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const zeroCount = useMemo(() => entries.filter(isZeroMarker).length, [entries]);
  const visible = useMemo(
    () => entries.filter((entry) => (showZero || !isZeroMarker(entry)) && matchesSearch(entry, search)),
    [entries, showZero, search]
  );
  const rows = useMemo(() => groupEventEntries(visible, eventChannel), [visible, eventChannel]);
  const filtering = search.trim() !== "";

  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const actionProps = { canEdit, canLaunchEvent, eventChannel, onEdit, onCancel };

  function renderEntryRow(entry: RevenueEntry, nested: boolean) {
    const description = visibleDescription(entry);
    const expandable = hasDetails(entry);
    const isOpen = open.has(entry.id);
    return (
      <Fragment key={entry.id}>
        <Table.Row className={nested ? "revenue-entry-nested" : undefined}>
          <Table.Td className="revenue-cell-toggle">
            {expandable && (
              <button
                type="button"
                className="revenue-row-toggle"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? "Ocultar" : "Ver"} detalhes de ${formatDate(entry.date)}`}
                onClick={() => toggle(entry.id)}
              >
                <ChevronDown size={16} className={`revenue-chevron${isOpen ? " open" : ""}`} />
              </button>
            )}
          </Table.Td>
          <Table.Td style={{ whiteSpace: "nowrap" }}>
            {formatDate(entry.date)}
            <small className="revenue-cell-sub">{weekday(entry)}</small>
          </Table.Td>
          <Table.Td>
            {displayChannel(entry.channel)}
            <small className="revenue-cell-sub">{entryOrigin(entry)}</small>
          </Table.Td>
          <Table.Td>{description ?? <span className="revenue-dash">—</span>}</Table.Td>
          <Table.Td align="right"><MoneyOrDash value={Number(entry.grossAmount ?? 0)} /></Table.Td>
          <Table.Td align="right"><strong><MoneyOrDash value={Number(entry.netAmount ?? 0)} /></strong></Table.Td>
          <Table.Td align="right">{Number(entry.tickets ?? 0) > 0 ? formatNumber(Number(entry.tickets)) : <span className="revenue-dash">—</span>}</Table.Td>
          <Table.Td actions><EntryActions entry={entry} {...actionProps} /></Table.Td>
        </Table.Row>
        {isOpen && expandable && (
          <Table.Row className="revenue-entry-detail-row">
            <Table.Td colSpan={COLUMN_COUNT}>
              <Details entry={entry} />
            </Table.Td>
          </Table.Row>
        )}
      </Fragment>
    );
  }

  function renderGroupRow(group: EntryGroup) {
    const key = `group-${group.name}`;
    const isOpen = open.has(key);
    return (
      <Fragment key={key}>
        <Table.Row className="revenue-entry-group">
          <Table.Td className="revenue-cell-toggle">
            <button type="button" className="revenue-row-toggle" aria-expanded={isOpen} aria-label={`${isOpen ? "Recolher" : "Abrir"} o evento ${group.name}`} onClick={() => toggle(key)}>
              <ChevronDown size={16} className={`revenue-chevron${isOpen ? " open" : ""}`} />
            </button>
          </Table.Td>
          <Table.Td style={{ whiteSpace: "nowrap" }}>
            {formatRange(group)}
            <small className="revenue-cell-sub">{group.entries.length} lançamentos</small>
          </Table.Td>
          <Table.Td>
            {displayChannel(eventChannel)}
            <small className="revenue-cell-sub">Evento</small>
          </Table.Td>
          <Table.Td><strong>{group.name}</strong></Table.Td>
          <Table.Td align="right"><MoneyOrDash value={group.gross} /></Table.Td>
          <Table.Td align="right"><strong><MoneyOrDash value={group.net} /></strong></Table.Td>
          <Table.Td align="right">{formatNumber(group.tickets)}</Table.Td>
          <Table.Td actions>
            {canEdit || canLaunchEvent ? (
              <IconButton icon={<Trash2 size={16} />} label={`Cancelar o evento ${group.name} inteiro`} size="sm" variant="danger" onClick={() => onCancelEvent(group)} />
            ) : null}
          </Table.Td>
        </Table.Row>
        {isOpen && group.entries.map((entry) => renderEntryRow(entry, true))}
      </Fragment>
    );
  }

  const hiddenZero = showZero ? 0 : entries.filter((entry) => isZeroMarker(entry) && matchesSearch(entry, search)).length;

  const emptyState =
    hiddenZero > 0 ? (
      <EmptyState
        title="Só há lançamentos zerados"
        description={`${hiddenZero} ${hiddenZero === 1 ? "lançamento zerado está oculto" : "lançamentos zerados estão ocultos"}. Ative "Mostrar zerados" para ver.`}
      />
    ) : filtering ? (
      <EmptyState title="Nada encontrado" description="Nenhum lançamento combina com a busca. Tente outro termo." />
    ) : (
      <EmptyState title="Nenhum faturamento lançado" description="Os lançamentos do período aparecem aqui." />
    );

  return (
    <>
      <PanelEyebrow>Lançamentos</PanelEyebrow>
      <h2 className="revenue-card-title">
        {visible.length} {visible.length === 1 ? "lançamento" : "lançamentos"}
        {hiddenZero > 0 && <small className="revenue-title-note"> · {hiddenZero} zerados ocultos</small>}
      </h2>
      <div className="revenue-entries-toolbar">
        <TextField
          type="search"
          aria-label="Buscar lançamento"
          placeholder="Buscar por descrição, canal, origem ou data"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          containerClassName="revenue-entries-search"
        />
        {zeroCount > 0 && (
          <label className="revenue-entries-zero">
            <Switch label="Mostrar lançamentos zerados" checked={showZero} onChange={setShowZero} />
            <span>Mostrar zerados ({zeroCount})</span>
          </label>
        )}
      </div>

      <div className="revenue-desktop-entries">
        {rows.length === 0 ? (
          emptyState
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th aria-label="Detalhes" />
                <Table.Th>Data</Table.Th>
                <Table.Th>Origem</Table.Th>
                <Table.Th>Descrição</Table.Th>
                <Table.Th align="right">Bruto</Table.Th>
                <Table.Th align="right">Líquido</Table.Th>
                <Table.Th align="right">Pessoas</Table.Th>
                <Table.Th actions aria-label="Ações" />
              </Table.Row>
            </Table.Head>
            <Table.Body>{rows.map((row) => (row.kind === "group" ? renderGroupRow(row.group) : renderEntryRow(row.entry, false)))}</Table.Body>
          </Table>
        )}
      </div>

      <div className="revenue-mobile-list">
        {rows.length === 0 && emptyState}
        {rows.map((row) =>
          row.kind === "group" ? (
            <details key={`group-${row.group.name}`} className="revenue-mobile-group">
              <summary>
                <strong>{row.group.name}</strong>
                <span>{formatRange(row.group)} · {row.group.entries.length} lançamentos · {formatNumber(row.group.tickets)} pessoas</span>
                <span className="revenue-mobile-amount"><Money value={row.group.net} /></span>
              </summary>
              {row.group.entries.map((entry) => (
                <MobileCard key={entry.id} entry={entry} {...actionProps} />
              ))}
              {(canEdit || canLaunchEvent) && (
                <button className="secondary-button" type="button" onClick={() => onCancelEvent(row.group)}>
                  <Trash2 size={15} /> Cancelar o evento inteiro
                </button>
              )}
            </details>
          ) : (
            <MobileCard key={row.entry.id} entry={row.entry} {...actionProps} />
          )
        )}
      </div>
    </>
  );
}

function MobileCard({ entry, ...actions }: {
  entry: RevenueEntry;
  canEdit: boolean;
  canLaunchEvent: boolean;
  eventChannel: string;
  onEdit: (entryId: string) => void;
  onCancel: (entry: RevenueEntry) => void;
}) {
  const description = visibleDescription(entry);
  const tickets = Number(entry.tickets ?? 0);
  return (
    <article className="revenue-mobile-card">
      <header>
        <div>
          <strong>{formatDate(entry.date)}</strong>
          <small className="revenue-cell-sub">{weekday(entry)}</small>
        </div>
        <span className="revenue-mobile-amount"><MoneyOrDash value={Number(entry.netAmount ?? 0)} /></span>
      </header>
      <p className="revenue-mobile-origin">
        {displayChannel(entry.channel)} <StatusBadge tone="neutral">{entryOrigin(entry)}</StatusBadge>
      </p>
      {description && <p className="revenue-mobile-desc">{description}</p>}
      <p className="revenue-mobile-meta">
        Bruto <MoneyOrDash value={Number(entry.grossAmount ?? 0)} />
        {tickets > 0 && <> · {formatNumber(tickets)} pessoas</>}
      </p>
      {hasDetails(entry) && (
        <details className="revenue-mobile-details">
          <summary>Detalhes</summary>
          <Details entry={entry} />
        </details>
      )}
      <div className="revenue-mobile-actions">
        <EntryActions entry={entry} {...actions} />
      </div>
    </article>
  );
}
