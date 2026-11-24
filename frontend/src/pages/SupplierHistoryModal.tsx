import { FileDown, FileSpreadsheet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { downloadSupplierHistoryXlsx, getSupplierHistory, SupplierHistory, SupplierHistoryFilters, SupplierHistoryTitleFilter } from "../api/client";
import { Alert, Button, EmptyState, FormField, Money, PanelEyebrow, Select, StatusBadge, Switch, Table, TextField } from "../design-system";
import {
  daysSince,
  describeDaysSince,
  describeTitle,
  exportFileName,
  pageRangeLabel,
  parcelDateText,
  parcelStateLabel,
  parcelStateTone,
  PERIOD_OPTIONS,
  PeriodPreset,
  purchaseStatusLabel,
  purchaseStatusTone,
  resolvePeriod,
  splitByParcel,
  titleStateLabel,
  titleStateTone
} from "../lib/supplier-history";
import { formatDate } from "../utils/format";
import { gerarPdfHistoricoFornecedor } from "./supplierHistoryPdf";
import "./SupplierHistoryModal.css";

const PAGE_SIZE = 15;
const SEARCH_DEBOUNCE_MS = 300;

const TITLE_CHIPS: Array<{ key: "all" | SupplierHistoryTitleFilter; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "open", label: "Em aberto" },
  { key: "overdue", label: "Vencidas" },
  { key: "paid", label: "Baixadas" },
  { key: "none", label: "Sem título" }
];

type Props = {
  supplier: { id: string; name: string };
  onClose: () => void;
};

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="supplier-history-stat">
      <span>{label}</span>
      <strong>{children}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function SupplierHistoryModal({ supplier, onClose }: Props) {
  const navigate = useNavigate();
  const [preset, setPreset] = useState<PeriodPreset>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [titleFilter, setTitleFilter] = useState<SupplierHistoryTitleFilter | "all">("all");
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<SupplierHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const search = useDebounced(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  const period = preset === "custom" ? { from: customFrom, to: customTo } : resolvePeriod(preset);
  // O que a tela está filtrando agora; é o mesmo filtro que vai para o PDF e para a planilha.
  const currentFilters: SupplierHistoryFilters = {
    from: period.from,
    to: period.to,
    search,
    includeCancelled,
    titleState: titleFilter === "all" ? undefined : titleFilter
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSupplierHistory(supplier.id, { ...currentFilters, page, pageSize: PAGE_SIZE })
      .then((result) => { if (!cancelled) setHistory(result); })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o histórico.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // period é derivado de preset/customFrom/customTo; listá-los evita refazer a busca a cada render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id, preset, customFrom, customTo, search, includeCancelled, titleFilter, page]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function changeFilter(apply: () => void) {
    apply();
    setPage(1);
  }

  async function exportPdf() {
    setExporting("pdf");
    setError(null);
    try {
      const full = await getSupplierHistory(supplier.id, { ...currentFilters, all: true });
      await gerarPdfHistoricoFornecedor(full, { supplierName: supplier.name, titleFilter, search, includeCancelled });
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Não foi possível gerar o PDF.");
    } finally {
      setExporting(null);
    }
  }

  async function exportXlsx() {
    setExporting("xlsx");
    setError(null);
    try {
      await downloadSupplierHistoryXlsx(supplier.id, currentFilters, exportFileName(supplier.name, "xlsx"));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Não foi possível gerar a planilha.");
    } finally {
      setExporting(null);
    }
  }

  const lastPurchase = history?.lastPurchase ?? null;
  const totalPages = history ? Math.max(1, Math.ceil(history.purchases.total / history.purchases.pageSize)) : 1;
  const averageTicket = history && history.purchaseCount > 0 ? history.periodTotal / history.purchaseCount : null;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="panel modal-panel supplier-history-panel" role="dialog" aria-modal="true" aria-label={`Histórico de ${supplier.name}`}>
        <div className="section-heading">
          <div>
            <PanelEyebrow>Histórico do fornecedor</PanelEyebrow>
            <h2>{supplier.name}</h2>
          </div>
          <div className="supplier-history-actions">
            <Button variant="secondary" size="sm" leadingIcon={<FileDown size={15} />} disabled={!history || exporting !== null} onClick={exportPdf}>
              {exporting === "pdf" ? "Gerando…" : "Exportar PDF"}
            </Button>
            <Button variant="secondary" size="sm" leadingIcon={<FileSpreadsheet size={15} />} disabled={!history || exporting !== null} onClick={exportXlsx}>
              {exporting === "xlsx" ? "Gerando…" : "Exportar Excel"}
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          </div>
        </div>

        <div className="supplier-history-filters">
          <FormField label="Período">
            <Select
              value={preset}
              onChange={(event) => changeFilter(() => setPreset(event.target.value as PeriodPreset))}
              options={PERIOD_OPTIONS}
            />
          </FormField>
          {preset === "custom" && (
            <>
              <FormField label="De">
                <TextField type="date" value={customFrom} max={customTo || undefined} onChange={(event) => changeFilter(() => setCustomFrom(event.target.value))} />
              </FormField>
              <FormField label="Até">
                <TextField type="date" value={customTo} min={customFrom || undefined} onChange={(event) => changeFilter(() => setCustomTo(event.target.value))} />
              </FormField>
            </>
          )}
          <FormField label="Buscar NF ou pedido">
            <TextField value={searchInput} placeholder="Nº da NF ou do pedido" onChange={(event) => changeFilter(() => setSearchInput(event.target.value))} />
          </FormField>
          <FormField label="Mostrar canceladas" inline>
            <Switch checked={includeCancelled} onChange={(checked) => changeFilter(() => setIncludeCancelled(checked))} label="Mostrar compras canceladas" />
          </FormField>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="supplier-history-stats" aria-busy={loading}>
          <Stat label="Total no período"><Money value={history?.periodTotal ?? 0} /></Stat>
          <Stat label="Compras" hint={averageTicket === null ? undefined : "ticket médio"}>
            {history?.purchaseCount ?? 0}
            {averageTicket !== null && <> · <Money value={averageTicket} /></>}
          </Stat>
          <Stat label="Última compra" hint={lastPurchase ? describeDaysSince(daysSince(lastPurchase.purchaseDate)) : undefined}>
            {lastPurchase ? formatDate(lastPurchase.purchaseDate) : "-"}
          </Stat>
          <Stat label="Prazo médio">{history?.averagePaymentTermDays == null ? "-" : `${Math.round(history.averagePaymentTermDays)} dias`}</Stat>
        </div>

        {history && history.paymentMethods.length > 0 && (
          <p className="supplier-history-methods">
            {history.paymentMethods.map((method) => (
              <span key={method.name}>{method.name} <b>{method.count}×</b> <Money value={method.total} /></span>
            ))}
          </p>
        )}

        <div className="supplier-history-chips" role="group" aria-label="Situação do título">
          {TITLE_CHIPS.map((chip) => {
            const bucket = history?.titleBuckets[chip.key];
            const active = titleFilter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                className={`supplier-history-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => changeFilter(() => setTitleFilter(chip.key))}
              >
                {chip.label}
                {bucket && <span className="supplier-history-chip-count">{bucket.count}</span>}
                {bucket && chip.key !== "all" && chip.key !== "none" && bucket.count > 0 && <Money value={bucket.amount} />}
              </button>
            );
          })}
        </div>

        {history && history.purchases.items.length === 0 ? (
          <EmptyState title="Nenhuma compra encontrada" description="Ajuste o período, a situação ou a busca para ver outras compras." />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Data</Table.Th>
                <Table.Th>NF / Pedido</Table.Th>
                <Table.Th>Pagamento</Table.Th>
                <Table.Th align="right">Total</Table.Th>
                <Table.Th>Título</Table.Th>
                <Table.Th actions>Abrir</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {(history?.purchases.items ?? []).flatMap((purchase) => {
                const cancelled = purchase.status === "CANCELLED";
                const detail = cancelled ? "" : describeTitle(purchase.title);
                // Compra parcelada: a mesma compra repetida em cada parcela (1/3, 2/3, 3/3).
                return splitByParcel(purchase).map(({ key, parcel, fraction }) => (
                  <Table.Row key={key} className={fraction && !fraction.startsWith("1/") ? "supplier-history-row-continued" : undefined}>
                    <Table.Td>{formatDate(purchase.purchaseDate)}</Table.Td>
                    <Table.Td>
                      <span className="supplier-history-cell-main">{purchase.invoiceNumber ?? "-"}</span>
                      <span className="supplier-history-cell-sub">{purchase.purchaseNumber ?? "-"}</span>
                    </Table.Td>
                    <Table.Td>
                      <span className="supplier-history-cell-main">{purchase.paymentMethod ?? "-"}</span>
                      {fraction && <span className="supplier-history-cell-sub">Parcela {fraction}</span>}
                    </Table.Td>
                    <Table.Td align="right">
                      <Money value={parcel ? parcel.amount : purchase.totalAmount} />
                      {parcel && <span className="supplier-history-cell-sub">de <Money value={purchase.totalAmount} /></span>}
                    </Table.Td>
                    <Table.Td>
                      {cancelled ? (
                        <StatusBadge tone={purchaseStatusTone(purchase.status)}>{purchaseStatusLabel(purchase.status)}</StatusBadge>
                      ) : parcel ? (
                        <>
                          <StatusBadge tone={parcelStateTone(parcel)}>{parcelStateLabel(parcel)}</StatusBadge>
                          <span className="supplier-history-cell-sub">
                            {parcelDateText(parcel)}
                            {parcel.state === "PAID" && parcel.paidAmount > 0 && <> · pago <Money value={parcel.paidAmount} /></>}
                          </span>
                        </>
                      ) : (
                        <>
                          <StatusBadge tone={titleStateTone(purchase.title)}>{titleStateLabel(purchase.title)}</StatusBadge>
                          {detail && <span className="supplier-history-cell-sub">{detail}</span>}
                        </>
                      )}
                    </Table.Td>
                    <Table.Td actions>
                      <Button variant="secondary" size="sm" onClick={() => navigate(`/compras/${purchase.id}/editar`)} aria-label={`Abrir compra ${purchase.purchaseNumber ?? purchase.invoiceNumber ?? ""}`}>Abrir compra</Button>
                    </Table.Td>
                  </Table.Row>
                ));
              })}
            </Table.Body>
          </Table>
        )}

        {history && history.purchases.total > 0 && (
          <div className="supplier-history-pager">
            <span>{pageRangeLabel(history.purchases.page, history.purchases.pageSize, history.purchases.total)}</span>
            <div>
              <Button variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
              <span>Página {page} de {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={loading || page >= totalPages} onClick={() => setPage(page + 1)}>Próxima</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
