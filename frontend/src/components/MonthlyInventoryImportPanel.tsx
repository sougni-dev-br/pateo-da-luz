import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { useState } from "react";
import {
  confirmMonthlyInventory,
  InventorySnapshotType,
  MonthlyInventoryPreview,
  previewMonthlyInventory,
  undoMonthlyInventory
} from "../api/client";
import { Notice, useNotice } from "./Notice";
import { formatCurrency, formatNumber } from "../utils/format";

const inventoryTypes: Array<{ value: InventorySnapshotType; label: string }> = [
  { value: "INVENTARIO_INICIAL", label: "Inventario inicial" },
  { value: "INVENTARIO_FINAL", label: "Inventario final" },
  { value: "CONTAGEM_PARCIAL", label: "Contagem parcial" },
  { value: "AJUSTE", label: "Ajuste" }
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function splitMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

export function MonthlyInventoryImportPanel() {
  const [month, setMonth] = useState(currentMonth());
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [inventoryPreview, setInventoryPreview] = useState<MonthlyInventoryPreview | null>(null);
  const [inventoryReport, setInventoryReport] = useState<{
    id: string;
    importedRows: number;
    pendingItems: number;
    totalValue: number;
    replacedSnapshotId: string | null;
    warnings: Array<{ rowNumber: number; message: string }>;
  } | null>(null);
  const [inventoryForm, setInventoryForm] = useState({
    type: "INVENTARIO_INICIAL" as InventorySnapshotType,
    countDate: today(),
    notes: "",
    allowOverwrite: false,
    overwriteReason: ""
  });
  const [loading, setLoading] = useState(false);
  const { notice, setNotice } = useNotice();

  const competence = splitMonth(month);

  async function handlePreviewInventory() {
    if (!inventoryFile) {
      setNotice({ tone: "error", message: "Selecione um arquivo Excel para importar." });
      return;
    }
    setLoading(true);
    try {
      const preview = await previewMonthlyInventory(inventoryFile);
      setInventoryPreview(preview);
      setInventoryReport(null);
      setNotice({ tone: "success", message: "Preview do inventario gerado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar preview." });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmInventory() {
    if (!inventoryPreview) return;
    setLoading(true);
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
      setInventoryReport(result);
      setInventoryPreview(null);
      setInventoryFile(null);
      setNotice({
        tone: result.pendingItems ? "warning" : "success",
        message: result.pendingItems ? "Inventario importado com pendencias de produto." : "Inventario importado com sucesso."
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao importar inventario." });
    } finally {
      setLoading(false);
    }
  }

  async function handleUndoInventory() {
    if (!inventoryReport?.id) return;
    const reason = window.prompt("Informe o motivo para desfazer este inventario:");
    if (!reason?.trim()) return;
    setLoading(true);
    try {
      await undoMonthlyInventory(inventoryReport.id, reason);
      setNotice({ tone: "success", message: "Inventario desfeito com sucesso." });
      setInventoryReport(null);
      setInventoryPreview(null);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao desfazer inventario." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Importacao</p>
            <h2>Inventario mensal</h2>
          </div>
          <FileSpreadsheet size={24} />
        </div>

        <div className="filters-row">
          <label>
            Competencia
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label>
            Tipo
            <select
              value={inventoryForm.type}
              onChange={(event) => setInventoryForm({ ...inventoryForm, type: event.target.value as InventorySnapshotType })}
            >
              {inventoryTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data da contagem
            <input
              type="date"
              value={inventoryForm.countDate}
              onChange={(event) => setInventoryForm({ ...inventoryForm, countDate: event.target.value })}
            />
          </label>
          <label className="full-width">
            Observacao
            <input value={inventoryForm.notes} onChange={(event) => setInventoryForm({ ...inventoryForm, notes: event.target.value })} />
          </label>
          <label>
            Arquivo Excel
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                setInventoryFile(event.target.files?.[0] ?? null);
                setInventoryPreview(null);
                setInventoryReport(null);
              }}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={inventoryForm.allowOverwrite}
              onChange={(event) => setInventoryForm({ ...inventoryForm, allowOverwrite: event.target.checked })}
            />
            Substituir inventario existente
          </label>
          {inventoryForm.allowOverwrite && (
            <label className="full-width">
              Motivo
              <input
                value={inventoryForm.overwriteReason}
                onChange={(event) => setInventoryForm({ ...inventoryForm, overwriteReason: event.target.value })}
              />
            </label>
          )}
          <button className="primary-button" type="button" disabled={!inventoryFile || loading} onClick={handlePreviewInventory}>
            <Upload size={16} /> Gerar preview
          </button>
        </div>
      </section>

      {inventoryPreview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Preview</p>
              <h2>Inventario importado</h2>
            </div>
            <strong>{formatNumber(inventoryPreview.totalRows)} linhas</strong>
          </div>
          <div className="summary-grid">
            <article>
              <span>Produtos encontrados</span>
              <strong>{formatNumber(inventoryPreview.validation.matchedItems)}</strong>
            </article>
            <article>
              <span>Pendentes</span>
              <strong>{formatNumber(inventoryPreview.validation.pendingItems)}</strong>
            </article>
            <article>
              <span>Valor total</span>
              <strong>{formatCurrency(inventoryPreview.validation.totalValue)}</strong>
            </article>
          </div>
          <div className="table-wrap subsection">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Codigo</th>
                  <th>Produto</th>
                  <th>Setor</th>
                  <th>Unidade</th>
                  <th>Qtd.</th>
                  <th>Custo unit.</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
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
          <div className="form-actions">
            {inventoryReport?.id && (
              <button className="secondary-button" type="button" onClick={handleUndoInventory} disabled={loading}>
                Desfazer lote
              </button>
            )}
            <button className="primary-button" type="button" onClick={handleConfirmInventory} disabled={loading}>
              <CheckCircle2 size={16} /> Confirmar inventario
            </button>
          </div>
          {inventoryPreview.warnings.length > 0 && (
            <div className="alert warning">
              {inventoryPreview.warnings.map((warning, index) => (
                <div key={`${warning.rowNumber}-${index}`}>Linha {warning.rowNumber}: {warning.message}</div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
