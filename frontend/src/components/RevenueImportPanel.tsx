import { BadgeDollarSign, FileSpreadsheet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  confirmRevenueImport,
  previewRevenueImport,
  undoRevenueImport,
  RevenueImportPreview,
  RevenueImportReport
} from "../api/client";
import { Notice, useNotice } from "./Notice";
import { formatCurrency, formatNumber } from "../utils/format";

const channels = ["Salão", "Delivery", "Eventos / Empreitada", "Outros"];

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function splitMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

type Props = {
  onImported?: () => void;
  onOpenRevenue?: () => void;
};

export function RevenueImportPanel({ onImported, onOpenRevenue }: Props) {
  const [month, setMonth] = useState(currentMonth());
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSheetName, setImportSheetName] = useState("Planilha1");
  const [importDefaultChannel, setImportDefaultChannel] = useState("Salão");
  const [importNotes, setImportNotes] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importOverwriteReason, setImportOverwriteReason] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState<RevenueImportPreview | null>(null);
  const [importReport, setImportReport] = useState<RevenueImportReport | null>(null);
  const { notice, setNotice } = useNotice();

  const competence = useMemo(() => splitMonth(month), [month]);
  const isDeliveryPreview = importPreview?.importKind === "DELIVERY" || Boolean(importPreview?.previewRows.some((row) => row.delivery));

  useEffect(() => {
    setImportSheetName((current) => {
      if (importDefaultChannel === "Delivery" && current === "Planilha1") return "";
      if (importDefaultChannel !== "Delivery" && !current.trim()) return "Planilha1";
      return current;
    });
  }, [importDefaultChannel]);

  async function handlePreviewImport() {
    if (!importFile) {
      setNotice({ tone: "error", message: "Selecione um arquivo Excel para importar." });
      return;
    }
    setImportLoading(true);
    try {
      const result = await previewRevenueImport(importFile, {
        competenceYear: competence.year,
        competenceMonth: competence.month,
        defaultChannel: importDefaultChannel,
        sheetName: importSheetName.trim() || (importDefaultChannel === "Delivery" ? null : "Planilha1"),
        notes: importNotes.trim() || null
      });
      setImportPreview(result);
      setImportReport(null);
      setNotice({ tone: "success", message: "Preview de faturamento carregado." });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao gerar preview de faturamento." });
    } finally {
      setImportLoading(false);
    }
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    if (importOverwrite && !importOverwriteReason.trim()) {
      setNotice({ tone: "error", message: "Informe o motivo para substituir a importacao existente." });
      return;
    }
    setImportLoading(true);
    try {
      const report = await confirmRevenueImport({
        importFileId: importPreview.importFileId,
        originalFileName: importPreview.originalFileName,
        sheetName: importPreview.sheetName,
        competenceYear: competence.year,
        competenceMonth: competence.month,
        defaultChannel: importDefaultChannel,
        notes: importNotes.trim() || null,
        allowOverwrite: importOverwrite,
        overwriteReason: importOverwrite ? importOverwriteReason.trim() || null : null
      });
      setImportReport(report);
      setImportPreview(null);
      setNotice({
        tone: report.ignoredRows > 0 || report.existingRows > 0 ? "warning" : "success",
        message: report.ignoredRows > 0 || report.existingRows > 0
          ? "Importacao concluida com avisos. Revise os pontos abaixo."
          : "Faturamento importado com sucesso."
      });
      onImported?.();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao confirmar importacao de faturamento." });
    } finally {
      setImportLoading(false);
    }
  }

  async function handleUndoImport() {
    if (!importReport?.importBatchId) return;
    if (!window.confirm("Deseja desfazer este lote de faturamento?")) return;
    setImportLoading(true);
    try {
      await undoRevenueImport(importReport.importBatchId);
      setNotice({ tone: "success", message: "Lote de faturamento desfeito com sucesso." });
      setImportReport(null);
      setImportPreview(null);
      setImportOverwrite(false);
      setImportOverwriteReason("");
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao desfazer lote de faturamento." });
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Importacao</p>
            <h2>Faturamento</h2>
          </div>
          <BadgeDollarSign size={24} />
        </div>
        <div className="filters-row">
          <label>
            Competencia
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label>
            Aba
            <input
              value={importSheetName}
              onChange={(event) => setImportSheetName(event.target.value)}
              placeholder={importDefaultChannel === "Delivery" ? "automatica" : "Planilha1"}
              disabled={importDefaultChannel === "Delivery"}
            />
          </label>
          <label>
            Canal padrao
            <select value={importDefaultChannel} onChange={(event) => setImportDefaultChannel(event.target.value)}>
              {channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
            </select>
          </label>
          <label className="full-width">
            Observacao opcional
            <input value={importNotes} onChange={(event) => setImportNotes(event.target.value)} />
          </label>
        </div>
        <div className="upload-row">
          <input
            aria-label="Selecionar arquivo Excel"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setImportFile(file);
              setImportPreview(null);
              setImportReport(null);
            }}
          />
          <button className="primary-button" type="button" onClick={handlePreviewImport} disabled={!importFile || importLoading}>
            <FileSpreadsheet size={16} /> Gerar preview
          </button>
        </div>
        <p className="muted-inline">A importacao de faturamento agora fica centralizada aqui.</p>
      </section>

      {importPreview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Preview</p>
              <h2>{isDeliveryPreview ? "Faturamento delivery importado" : "Faturamento salao importado"}</h2>
            </div>
            <strong>{formatNumber(importPreview.validation.dailyRows)} dias</strong>
          </div>

          <div className="summary-grid financial-summary">
            <article><span>Dias</span><strong>{formatNumber(importPreview.validation.dailyRows)}</strong></article>
            <article><span>{isDeliveryPreview ? "Faturamento bruto delivery" : "Venda total"}</span><strong>{formatCurrency(importPreview.validation.totalGross)}</strong></article>
            {isDeliveryPreview ? (
              <>
                <article><span>99Food total</span><strong>{formatCurrency(importPreview.validation.total99Food)}</strong></article>
                <article><span>iFood total</span><strong>{formatCurrency(importPreview.validation.totalIfood)}</strong></article>
                <article><span>Keeta total</span><strong>{formatCurrency(importPreview.validation.totalKeeta)}</strong></article>
              </>
            ) : (
              <>
                <article><span>Servico</span><strong>{formatCurrency(importPreview.validation.totalService)}</strong></article>
                <article><span>1 turno</span><strong>{formatCurrency(importPreview.validation.totalFirstShift)}</strong></article>
                <article><span>2 turno</span><strong>{formatCurrency(importPreview.validation.totalSecondShift)}</strong></article>
              </>
            )}
            <article><span>{isDeliveryPreview ? "Pedidos totais" : "Tickets"}</span><strong>{formatNumber(importPreview.validation.totalTickets)}</strong></article>
            <article><span>Ticket medio</span><strong>{formatCurrency(importPreview.validation.ticketAverageGeneral)}</strong></article>
            <article><span>Ignoradas</span><strong>{formatNumber(importPreview.validation.ignoredRows)}</strong></article>
            <article><span>Primeiro dia</span><strong>{importPreview.validation.firstDate ?? "-"}</strong></article>
            <article><span>Ultimo dia</span><strong>{importPreview.validation.lastDate ?? "-"}</strong></article>
          </div>

          <div className="table-wrap subsection">
            <table>
              {isDeliveryPreview ? (
                <>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Dia da semana</th>
                      <th>Pedidos 99Food</th>
                      <th>Ganhos 99Food</th>
                      <th>Pedidos iFood</th>
                      <th>Ganhos iFood</th>
                      <th>Pedidos Keeta</th>
                      <th>Ganhos Keeta</th>
                      <th>Pedidos total</th>
                      <th>Faturamento total</th>
                      <th>Ticket medio calculado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.previewRows.slice(0, 3).map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.date}</td>
                        <td>{row.dayOfWeek ?? "-"}</td>
                        <td>{formatNumber(row.delivery?.orders99Food ?? 0)}</td>
                        <td>{formatCurrency(row.delivery?.earnings99Food ?? 0)}</td>
                        <td>{formatNumber(row.delivery?.ordersIfood ?? 0)}</td>
                        <td>{formatCurrency(row.delivery?.earningsIfood ?? 0)}</td>
                        <td>{formatNumber(row.delivery?.ordersKeeta ?? 0)}</td>
                        <td>{formatCurrency(row.delivery?.earningsKeeta ?? 0)}</td>
                        <td>{formatNumber(row.tickets)}</td>
                        <td>{formatCurrency(row.grossAmount)}</td>
                        <td>{formatCurrency(row.ticketAverage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                <tr>
                  <th>Dia</th>
                  <th>1 Turno Vendas</th>
                  <th>2 Turno Vendas</th>
                  <th>Venda Total Calculada</th>
                  <th>1 Turno TC's</th>
                  <th>2 Turno TC's</th>
                  <th>Tickets Totais</th>
                  <th>Servico</th>
                  <th>Repique</th>
                  <th>Ticket Medio</th>
                </tr>
                  </thead>
                  <tbody>
                {importPreview.previewRows.slice(0, 3).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{Number(row.date.slice(-2))}</td>
                    <td>{formatCurrency(row.salesFirstShift)}</td>
                    <td>{formatCurrency(row.salesSecondShift)}</td>
                    <td>{formatCurrency(row.grossAmount)}</td>
                    <td>{formatNumber(row.ticketsFirstShift)}</td>
                    <td>{formatNumber(row.ticketsSecondShift)}</td>
                    <td>{formatNumber(row.tickets)}</td>
                    <td>{formatCurrency(row.serviceAmount)}</td>
                    <td>{formatCurrency(row.repiqueAmount)}</td>
                    <td>{formatCurrency(row.ticketAverage)}</td>
                  </tr>
                ))}
                  </tbody>
                </>
              )}
            </table>
          </div>

          <div className="form-actions">
            {importReport?.importBatchId && (
              <button className="secondary-button" type="button" onClick={handleUndoImport} disabled={importLoading}>
                Desfazer lote
              </button>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={importOverwrite}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setImportOverwrite(checked);
                  if (!checked) setImportOverwriteReason("");
                }}
              />
              Substituir existentes
            </label>
            {importOverwrite && (
              <label className="full-width">
                Motivo da substituicao
                <input
                  value={importOverwriteReason}
                  onChange={(event) => setImportOverwriteReason(event.target.value)}
                  placeholder="Ex.: corrigir faturamento duplicado"
                />
              </label>
            )}
            <button
              className="primary-button"
              type="button"
              onClick={handleConfirmImport}
              disabled={importLoading || !importPreview || (importOverwrite && !importOverwriteReason.trim())}
            >
              Confirmar importacao
            </button>
          </div>
        </section>
      )}

      {importReport && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Historico</p>
              <h2>Lote importado</h2>
            </div>
            {onOpenRevenue && (
              <button className="secondary-button" type="button" onClick={onOpenRevenue}>
                Ver faturamento
              </button>
            )}
          </div>
          <div className="summary-grid financial-summary">
            <article><span>Importadas</span><strong>{formatNumber(importReport.importedRows)}</strong></article>
            <article><span>Criadas</span><strong>{formatNumber(importReport.createdRows)}</strong></article>
            <article><span>Atualizadas</span><strong>{formatNumber(importReport.updatedRows)}</strong></article>
            <article><span>Ignoradas</span><strong>{formatNumber(importReport.ignoredRows)}</strong></article>
            <article><span>Bruto</span><strong>{formatCurrency(importReport.totalGross)}</strong></article>
            <article><span>Servico</span><strong>{formatCurrency(importReport.totalService)}</strong></article>
          </div>
          <p className="muted-inline">Lote importado: {importReport.importBatchId}</p>
        </section>
      )}
    </div>
  );
}
