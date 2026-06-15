import { CheckCircle2, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AppUser,
  confirmMonthlyInventory,
  getMonthlyInventories,
  getRevenue,
  InventorySnapshot,
  InventorySnapshotType,
  MonthlyInventoryPreview,
  previewMonthlyInventory,
  RevenueSummary,
  undoMonthlyInventory
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { hasPermission } from "../lib/permissions";
import { PeriodFilter } from "../components/PeriodFilter";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

const inventoryTypes: Array<{ value: InventorySnapshotType; label: string }> = [
  { value: "INVENTARIO_INICIAL", label: "Inventario inicial" },
  { value: "INVENTARIO_FINAL", label: "Inventario final" },
  { value: "CONTAGEM_PARCIAL", label: "Contagem parcial" },
  { value: "AJUSTE", label: "Ajuste" }
];

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function splitMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function MonthlyClosing({ user }: { user: AppUser }) {
  const canEdit = hasPermission(user, "monthly-closing", "edit");
  const isAdmin = hasPermission(user, "monthly-closing", "admin");
  const [month, setMonth] = useState(currentMonth());
  const [inventories, setInventories] = useState<InventorySnapshot[]>([]);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [revenuePeriod, setRevenuePeriod] = useState(currentMonthPeriod());
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [inventoryPreview, setInventoryPreview] = useState<MonthlyInventoryPreview | null>(null);
  const [inventoryForm, setInventoryForm] = useState({
    type: "INVENTARIO_INICIAL" as InventorySnapshotType,
    countDate: today(),
    notes: "",
    allowOverwrite: false,
    overwriteReason: ""
  });
  const [loading, setLoading] = useState(false);
  const { notice, setNotice } = useNotice();

  const competence = useMemo(() => splitMonth(month), [month]);

  async function load() {
    setLoading(true);
    try {
      const filters = { year: String(competence.year), month: String(competence.month) };
      const [inventoryRows, revenueRows] = await Promise.all([
        getMonthlyInventories(filters),
        getRevenue({ ...filters, startDate: revenuePeriod.startDate, endDate: revenuePeriod.endDate })
      ]);
      setInventories(inventoryRows);
      setRevenue(revenueRows);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar fechamento." });
    } finally {
      setLoading(false);
    }
  }

  async function handlePreviewInventory() {
    if (!inventoryFile) return;
    try {
      setInventoryPreview(await previewMonthlyInventory(inventoryFile));
      setNotice({ tone: "success", message: "Preview do inventario gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar preview." });
    }
  }

  async function handleConfirmInventory() {
    if (!inventoryPreview) return;
    try {
      const result = await confirmMonthlyInventory({
        importFileId: inventoryPreview.importFileId,
        originalFileName: inventoryPreview.originalFileName,
        sheetName: inventoryPreview.sheetName,
        competenceYear: competence.year,
        competenceMonth: competence.month,
        type: inventoryForm.type,
        countDate: inventoryForm.countDate,
        notes: inventoryForm.notes,
        allowOverwrite: inventoryForm.allowOverwrite,
        overwriteReason: inventoryForm.overwriteReason
      });
      setNotice({
        tone: result.pendingItems ? "warning" : "success",
        message: result.pendingItems
          ? "Inventario importado com pendencias de produto."
          : "Inventario importado com sucesso."
      });
      setInventoryPreview(null);
      setInventoryFile(null);
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao importar inventario." });
    }
  }

  async function handleUndoInventory(snapshot: InventorySnapshot) {
    const reason = window.prompt("Informe o motivo para desfazer este inventario:");
    if (!reason?.trim()) return;
    await undoMonthlyInventory(snapshot.id, reason);
    setNotice({ tone: "success", message: "Inventario desfeito com sucesso." });
    await load();
  }

  useEffect(() => {
    load();
  }, [month, revenuePeriod.startDate, revenuePeriod.endDate]);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Operacao mensal</p>
            <h2>Fechamento mensal</h2>
          </div>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar fechamento">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="filters-row">
          <label>
            Competencia
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <PeriodFilter value={revenuePeriod} onChange={setRevenuePeriod} />
          {loading && <span className="muted-inline">Carregando...</span>}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Excel</p>
            <h2>Inventarios mensais</h2>
          </div>
        </div>

        {canEdit && (
          <div className="form-grid">
            <label>
              Tipo
              <select value={inventoryForm.type} onChange={(event) => setInventoryForm({ ...inventoryForm, type: event.target.value as InventorySnapshotType })}>
                {inventoryTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <label>
              Data da contagem
              <input type="date" value={inventoryForm.countDate} onChange={(event) => setInventoryForm({ ...inventoryForm, countDate: event.target.value })} />
            </label>
            <label>
              Arquivo
              <input type="file" accept=".xlsx,.xls" onChange={(event) => setInventoryFile(event.target.files?.[0] ?? null)} />
            </label>
            <label>
              Observacao
              <input value={inventoryForm.notes} onChange={(event) => setInventoryForm({ ...inventoryForm, notes: event.target.value })} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={inventoryForm.allowOverwrite} onChange={(event) => setInventoryForm({ ...inventoryForm, allowOverwrite: event.target.checked })} />
              Substituir inventario existente
            </label>
            {inventoryForm.allowOverwrite && (
              <label>
                Motivo
                <input value={inventoryForm.overwriteReason} onChange={(event) => setInventoryForm({ ...inventoryForm, overwriteReason: event.target.value })} />
              </label>
            )}
            <button className="secondary-button" type="button" disabled={!inventoryFile} onClick={handlePreviewInventory}>
              <Upload size={16} /> Gerar preview
            </button>
          </div>
        )}

        {inventoryPreview && (
          <div className="subsection">
            <div className="summary-grid">
              <article><span>Linhas</span><strong>{inventoryPreview.totalRows}</strong></article>
              <article><span>Produtos encontrados</span><strong>{inventoryPreview.validation.matchedItems}</strong></article>
              <article><span>Pendentes</span><strong>{inventoryPreview.validation.pendingItems}</strong></article>
              <article><span>Valor total</span><strong>{formatCurrency(inventoryPreview.validation.totalValue)}</strong></article>
            </div>
            {inventoryPreview.warnings.length > 0 && (
              <div className="alert warning">
                {inventoryPreview.warnings.map((warning, index) => <div key={index}>{warning.message}</div>)}
              </div>
            )}
            <div className="columns-list">
              {Object.entries(inventoryPreview.detectedColumns).map(([field, column]) => <span key={field}>{field}: <strong>{column}</strong></span>)}
            </div>
            <div className="table-wrap subsection">
              <table>
                <thead><tr><th>Linha</th><th>Codigo</th><th>Produto</th><th>Setor</th><th>Unidade</th><th>Qtd.</th><th>Custo unit.</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {inventoryPreview.previewRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>{row.productCode ?? "-"}</td>
                      <td>{row.productName}</td>
                      <td>{row.sectorName ?? "-"}</td>
                      <td>{row.unit ?? "-"}</td>
                      <td>{formatNumber(row.quantity)}</td>
                      <td>{row.unitCost == null ? "-" : formatCurrency(row.unitCost)}</td>
                      <td>{row.totalCost == null ? "-" : formatCurrency(row.totalCost)}</td>
                      <td>{row.resolutionStatus === "MATCHED" ? "Encontrado" : "Pendente"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="primary-button" type="button" onClick={handleConfirmInventory}>
              <CheckCircle2 size={16} /> Confirmar inventario
            </button>
          </div>
        )}

        <div className="table-wrap subsection">
          <table>
            <thead><tr><th>Tipo</th><th>Data</th><th>Itens</th><th>Valor</th><th>Status</th><th>Arquivo</th><th>Acoes</th></tr></thead>
            <tbody>
              {inventories.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td>{inventoryTypes.find((type) => type.value === snapshot.type)?.label ?? snapshot.type}</td>
                  <td>{formatDate(snapshot.countDate)}</td>
                  <td>{formatNumber(snapshot.totalItems)}</td>
                  <td>{formatCurrency(snapshot.totalValue)}</td>
                  <td>{snapshot.status}</td>
                  <td>{snapshot.originalFileName ?? "-"}</td>
                  <td>{isAdmin && snapshot.status !== "CANCELLED" ? <button type="button" onClick={() => handleUndoInventory(snapshot)}>Desfazer</button> : "-"}</td>
                </tr>
              ))}
              {inventories.length === 0 && <tr><td colSpan={7}>Nenhum inventario nesta competencia.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p>Resumo</p><h2>Faturamento aplicado no CMV</h2></div></div>
        <div className="summary-grid subsection">
          <article><span>Bruto</span><strong>{formatCurrency(revenue?.summary.grossAmount ?? 0)}</strong></article>
          <article><span>Descontos</span><strong>{formatCurrency(revenue?.summary.discounts ?? 0)}</strong></article>
          <article><span>Taxas</span><strong>{formatCurrency(revenue?.summary.platformFees ?? 0)}</strong></article>
          <article><span>Liquido</span><strong>{formatCurrency(revenue?.summary.netAmount ?? 0)}</strong></article>
        </div>
        <div className="table-wrap subsection">
          <table>
            <thead><tr><th>Canal</th><th>Qtd.</th><th>Bruto</th><th>Descontos</th><th>Taxas</th><th>Liquido</th></tr></thead>
            <tbody>
              {revenue?.summary.byChannel.map((item) => (
                <tr key={String(item.channel)}>
                  <td>{String(item.channel ?? "-")}</td>
                  <td>{formatNumber(Number(item.count ?? 0))}</td>
                  <td>{formatCurrency(Number(item.grossAmount ?? 0))}</td>
                  <td>{formatCurrency(Number(item.discounts ?? 0))}</td>
                  <td>{formatCurrency(Number(item.platformFees ?? 0))}</td>
                  <td>{formatCurrency(Number(item.netAmount ?? 0))}</td>
                </tr>
              ))}
              {(revenue?.summary.byChannel ?? []).length === 0 && <tr><td colSpan={6}>Nenhum faturamento lançado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
