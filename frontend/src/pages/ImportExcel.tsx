import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Company,
  ConflictAction,
  confirmImport,
  deleteImport,
  getCompanies,
  ImportPreview,
  ImportReport,
  previewImport,
  saveImportConflictDecision
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { formatCurrency, formatDate, formatNumber } from "../utils/format";

type Status = "idle" | "loading-preview" | "preview-ready" | "confirming" | "done" | "error";

export function ImportExcel() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [historicalMode, setHistoricalMode] = useState(false);
  const [ignoreRowsWithoutProduct, setIgnoreRowsWithoutProduct] = useState(false);
  const [conflictActions, setConflictActions] = useState<Record<string, ConflictAction>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [importCompanyId, setImportCompanyId] = useState<string>("");
  const { notice, setNotice } = useNotice();

  useEffect(() => {
    getCompanies({ includeInactive: false }).then(setCompanies).catch(() => setCompanies([]));
  }, []);

  async function handlePreview() {
    if (!file) return;

    setError(null);
    setReport(null);
    setStatus("loading-preview");

    try {
      const result = await previewImport(file, { historicalMode, ignoreRowsWithoutProduct });
      setPreview(result);
      setConflictActions(
        Object.fromEntries(
          result.conflicts.map((conflict) => [
            conflict.key,
            conflict.savedDecision?.action ?? conflict.recommendedAction ?? ("KEEP_CURRENT" as ConflictAction)
          ])
        )
      );
      setStatus("preview-ready");
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : "Erro ao ler planilha.";
      setError(message);
      setNotice({ tone: "error", message: "Importação falhou. Verifique os erros abaixo." });
      setStatus("error");
    }
  }

  async function handleConfirm() {
    if (!preview?.importFileId) return;
    if (!importCompanyId) {
      setError("Informe a empresa em que as notas foram faturadas antes de confirmar a importação.");
      return;
    }

    setError(null);
    setStatus("confirming");

    try {
      const result = await confirmImport(preview.importFileId, preview.originalFileName, {
        historicalMode,
        ignoreRowsWithoutProduct,
        companyId: importCompanyId
      });
      setReport(result);
      if (result.errors.length > 0) {
        const hasTimeout = result.errors.some((item) => item.message.toLowerCase().includes("timeout"));
        setNotice({
          tone: "error",
          message: hasTimeout
            ? "Importação falhou por timeout. Verifique os erros abaixo."
            : "Importação falhou. Verifique os erros abaixo."
        });
      } else if (result.warnings.length > 0) {
        setNotice({ tone: "warning", message: "Importação concluída com avisos. Revise os pontos abaixo." });
      } else {
        setNotice({ tone: "success", message: "Importação concluída com êxito." });
      }
      setStatus("done");
    } catch (confirmError) {
      const message = confirmError instanceof Error ? confirmError.message : "Erro ao confirmar importacao.";
      setError(message);
      setNotice({ tone: "error", message: "Importação falhou. Verifique os erros abaixo." });
      setStatus("preview-ready");
    }
  }

  async function handleDeleteImport() {
    if (!report?.importBatchId) return;
    const confirmed = window.confirm("Excluir as compras, itens e vencimentos desta importacao de teste?");
    if (!confirmed) return;

    setError(null);

    try {
      await deleteImport(report.importBatchId);
      setReport(null);
      setPreview(null);
      setFile(null);
      setStatus("idle");
      setNotice({ tone: "success", message: "Importação de teste excluída com sucesso." });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "Erro ao excluir importacao.";
      setError(message);
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function handleSaveConflictDecision(conflictKey: string) {
    const conflict = preview?.conflicts.find((item) => item.key === conflictKey);
    if (!conflict) return;

    try {
      const decision = await saveImportConflictDecision({
        conflictKey: conflict.key,
        entityType: conflict.entityType,
        conflictType: conflict.type,
        action: conflictActions[conflict.key] ?? "KEEP_CURRENT",
        targetId: conflict.currentId,
        code: conflict.code ?? conflict.incomingCodes[0] ?? null,
        normalizedName: conflict.normalizedName,
        incomingName: conflict.incomingName,
        notes: null
      });

      setPreview((current) => {
        if (!current) return current;
        const conflicts = current.conflicts.map((item) =>
          item.key === conflict.key ? { ...item, savedDecision: decision } : item
        );
        const resolved = conflicts.filter((item) => item.savedDecision).length;
        return {
          ...current,
          conflicts,
          conflictSummary: {
            conflictsFound: conflicts.length,
            conflictsResolved: resolved,
            conflictsPending: conflicts.length - resolved,
            decisionsAppliedAutomatically: conflicts.filter(
              (item) => item.savedDecision && item.savedDecision.action !== "IGNORE"
            ).length
          }
        };
      });
      setNotice({ tone: "success", message: "Decisão de conflito salva com sucesso." });
    } catch (decisionError) {
      const message = decisionError instanceof Error ? decisionError.message : "Erro ao salvar decisão.";
      setError(message);
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  async function resolveSameCodeAliases() {
    if (!preview) return;
    const targets = preview.conflicts.filter(
      (conflict) => conflict.entityType === "product" && conflict.type === "PRODUCT_CODE_NAME" && conflict.currentId
    );
    for (const conflict of targets) {
      await saveImportConflictDecision({
        conflictKey: conflict.key,
        entityType: conflict.entityType,
        conflictType: conflict.type,
        action: "CREATE_ALIAS",
        targetId: conflict.currentId,
        code: conflict.code,
        normalizedName: conflict.normalizedName,
        incomingName: conflict.incomingName,
        notes: "Resolvido em lote como alias por codigo igual."
      });
    }
    const targetKeys = new Set(targets.map((target) => target.key));
    const conflicts = preview.conflicts.map((conflict) =>
      targetKeys.has(conflict.key) ? { ...conflict, savedDecision: { ...(conflict.savedDecision as any), action: "CREATE_ALIAS" } } : conflict
    );
    setPreview({
      ...preview,
      conflicts,
      conflictSummary: {
        conflictsFound: conflicts.length,
        conflictsResolved: conflicts.filter((item) => item.savedDecision).length,
        conflictsPending: conflicts.filter((item) => !item.savedDecision).length,
        decisionsAppliedAutomatically: conflicts.filter((item) => item.savedDecision && item.savedDecision.action !== "IGNORE").length
      }
    });
    setNotice({ tone: "success", message: "Aliases aplicados para conflitos com mesmo codigo." });
  }

  const hasDuplicateBlocker = Boolean(preview?.warnings.some((item) => item.message.toLowerCase().includes("bloqueio por duplicidade")));
  const canConfirm = Boolean(preview && preview.missingRequiredFields.length === 0 && !hasDuplicateBlocker);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Importacao</p>
            <h2>Planilha de compras</h2>
          </div>
          <FileSpreadsheet size={24} />
        </div>

        <div className="upload-row">
          <input
            aria-label="Selecionar planilha"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setReport(null);
              setError(null);
              setStatus("idle");
            }}
          />
          <button className="primary-button" type="button" disabled={!file} onClick={handlePreview}>
            {status === "loading-preview" ? <Loader2 size={18} /> : <Upload size={18} />}
            Gerar preview
          </button>
        </div>

        <div className="checkbox-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={historicalMode}
              onChange={(event) => {
                setHistoricalMode(event.target.checked);
                setPreview(null);
                setReport(null);
              }}
            />
            Importação histórica (planilhas antigas)
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={ignoreRowsWithoutProduct}
              onChange={(event) => {
                setIgnoreRowsWithoutProduct(event.target.checked);
                setPreview(null);
                setReport(null);
              }}
            />
            Ignorar linhas sem descrição de produto
          </label>
        </div>

        {error && <div className="alert error">{error}</div>}
      </section>

      {preview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Aba {preview.sheetName ?? "-"}</p>
              <h2>Colunas detectadas</h2>
            </div>
            <strong>{preview.totalRows} linhas</strong>
          </div>

          <div className="summary-grid">
            <article>
              <span>Obrigatorias ausentes</span>
              <strong>{preview.missingRequiredFields.length}</strong>
            </article>
            <article>
              <span>Nao reconhecidas</span>
              <strong>{preview.unrecognizedColumns.length}</strong>
            </article>
            <article>
              <span>Campos mapeados</span>
              <strong>{Object.keys(preview.detectedColumns).length}</strong>
            </article>
            <article>
              <span>Total da planilha</span>
              <strong>{formatCurrency(preview.validation.spreadsheetTotal)}</strong>
            </article>
            <article>
              <span>Compras/NFs agrupadas</span>
              <strong>{preview.validation.groupedPurchases ?? 0}</strong>
            </article>
            <article>
              <span>Itens da planilha</span>
              <strong>{preview.validation.itemRows ?? preview.totalRows}</strong>
            </article>
            <article>
              <span>NFs unicas</span>
              <strong>{preview.validation.uniqueInvoices ?? 0}</strong>
            </article>
            <article>
              <span>Com vencimento</span>
              <strong>{preview.validation.rowsWithDueDates ?? 0}</strong>
            </article>
            <article>
              <span>Datas de vencimento</span>
              <strong>{preview.validation.dueDatesDetected ?? 0}</strong>
            </article>
            <article>
              <span>Parcelas previstas</span>
              <strong>{preview.validation.expectedInstallments ?? 0}</strong>
            </article>
            <article>
              <span>Pequenos gastos</span>
              <strong>{preview.validation.smallExpenses ?? 0}</strong>
            </article>
            <article>
              <span>Sem NF</span>
              <strong>{preview.validation.purchasesWithoutInvoice ?? 0}</strong>
            </article>
            <article>
              <span>Sem vencimento</span>
              <strong>{preview.validation.purchasesWithoutDueDate ?? 0}</strong>
            </article>
            <article>
              <span>Linhas vazias ignoradas</span>
              <strong>{preview.validation.emptyRowsIgnored ?? 0}</strong>
            </article>
            <article>
              <span>Fornecedores unicos</span>
              <strong>{preview.validation.uniqueSuppliers}</strong>
            </article>
            <article>
              <span>Produtos unicos</span>
              <strong>{preview.validation.uniqueProducts}</strong>
            </article>
            <article>
              <span>Codigos fornecedores</span>
              <strong>{preview.validation.supplierCodes.length}</strong>
            </article>
            <article>
              <span>Codigos produtos</span>
              <strong>{preview.validation.productCodes.length}</strong>
            </article>
          </div>

          <div className="columns-list">
            {Object.entries(preview.detectedColumns).map(([field, column]) => (
              <span key={field}>
                {field}: <strong>{column}</strong>
              </span>
            ))}
          </div>

          {preview.detectedColumns.unit && (
            <div className="alert success">
              Unidade reconhecida pela coluna: <strong>{preview.detectedColumns.unit}</strong>
            </div>
          )}

          {preview.missingRequiredFields.length > 0 && (
            <div className="alert error">
              Campos obrigatorios ausentes: {preview.missingRequiredFields.join(", ")}
            </div>
          )}

          {preview.unrecognizedColumns.length > 0 && (
            <div className="alert warning">
              Colunas nao reconhecidas: {preview.unrecognizedColumns.join(", ")}
            </div>
          )}

          {preview.validation.duplicateProducts.length > 0 && (
            <div className="alert warning">
              Produtos repetidos na planilha:{" "}
              {preview.validation.duplicateProducts
                .map((item) => `${item.name} (${item.count})`)
                .join(", ")}
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="alert warning">
              {preview.warnings.map((item, index) => (
                <div key={`${item.rowNumber}-${item.message}-${index}`}>
                  {item.rowNumber > 0 ? `Linha ${item.rowNumber}: ` : ""}
                  {item.message}
                </div>
              ))}
            </div>
          )}

          {hasDuplicateBlocker && (
            <div className="alert error">
              Existem compras duplicadas na planilha em relaÃ§Ã£o ao banco. Corrija as linhas sinalizadas antes de confirmar a importaÃ§Ã£o.
            </div>
          )}

          {preview.debugRows && preview.debugRows.length > 0 && (
            <div className="subsection table-wrap">
              <h3>Diagnostico tecnico das linhas 191, 908 e 918</h3>
              <table>
                <thead><tr><th>Linha</th><th>Produto</th><th>Unidade</th><th>NF</th><th>Vencimentos</th><th>Alertas</th></tr></thead>
                <tbody>{preview.debugRows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.productDetected.code ?? "-"}<small>{row.productDetected.description}</small></td>
                    <td>{row.unitDetected ?? "-"}</td>
                    <td>{row.invoiceDetected ?? "-"}</td>
                    <td>{row.dueDatesDetected.length ? row.dueDatesDetected.map((item) => `${item.raw}${item.parsed ? ` -> ${item.parsed}` : ""}`).join(", ") : "-"}</td>
                    <td>{row.alerts.length ? row.alerts.join(" | ") : "Sem alerta"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {preview.validation.groupedInvoiceTotals && preview.validation.groupedInvoiceTotals.length > 0 && (
            <div className="subsection table-wrap">
              <h3>Resumo por NF e vencimentos</h3>
              <table>
                <thead>
                  <tr>
                    <th>NF</th>
                    <th>Fornecedor</th>
                    <th>Total</th>
                    <th>Pagamento</th>
                    <th>Parcelas</th>
                    <th>Vencimentos</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.validation.groupedInvoiceTotals.map((group, index) => (
                    <tr key={`${group.invoiceNumber}-${index}`}>
                      <td>{group.invoiceNumber ?? "-"}</td>
                      <td>{group.supplierName}</td>
                      <td>{formatCurrency(group.total)}</td>
                      <td>{group.paymentMethod ?? "-"}</td>
                      <td>{group.expectedInstallments ?? 1}</td>
                      <td>{group.dueDates?.length ? group.dueDates.join(", ") : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.conflicts.length > 0 && (
            <div className="subsection">
              <div className="section-heading">
                <div>
                  <p>Revisão de dados</p>
                  <h2>Conflitos para resolver</h2>
                </div>
                <strong>
                  {preview.conflictSummary.conflictsPending} pendentes /{" "}
                  {preview.conflictSummary.conflictsResolved} resolvidos
                </strong>
              </div>
              <div className="actions-cell">
                <button className="secondary-button" type="button" onClick={resolveSameCodeAliases}>
                  Resolver todos como alias quando codigo for igual
                </button>
                <button className="secondary-button" type="button" onClick={resolveSameCodeAliases}>
                  Aplicar alias para todos com mesmo codigo
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Código</th>
                      <th>Banco</th>
                      <th>Planilha</th>
                      <th>Categoria</th>
                      <th>Unidade</th>
                      <th>Ocorrências</th>
                      <th>Linhas</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.conflicts.map((conflict) => (
                      <tr key={conflict.key}>
                      <td>
                        {conflict.label}
                        {conflict.severity === "alias_suggestion" && (
                          <small>Sugestao: criar alias e manter cadastro atual</small>
                        )}
                        {conflict.savedDecision && (
                          <small>Decisão salva: {conflict.savedDecision.action}</small>
                        )}
                        </td>
                        <td>{conflict.code ?? (conflict.incomingCodes.join(", ") || "-")}</td>
                        <td>{conflict.currentName ?? "-"}</td>
                        <td>
                          {conflict.incomingName}
                          {conflict.supplierName && conflict.entityType === "product" && (
                            <small>Fornecedor: {conflict.supplierName}</small>
                          )}
                        </td>
                        <td>
                          {conflict.categoryName ?? "-"}
                          {conflict.subcategoryName && <small>{conflict.subcategoryName}</small>}
                        </td>
                        <td>{conflict.unit ?? "-"}</td>
                        <td>{conflict.occurrences}</td>
                        <td>{conflict.exampleRows.join(", ")}</td>
                        <td>
                          <div className="conflict-actions">
                            <select
                              value={conflictActions[conflict.key] ?? conflict.savedDecision?.action ?? "KEEP_CURRENT"}
                              onChange={(event) =>
                                setConflictActions({
                                  ...conflictActions,
                                  [conflict.key]: event.target.value as ConflictAction
                                })
                              }
                            >
                              <option value="KEEP_CURRENT">Manter atual</option>
                              <option value="UPDATE_CURRENT">Atualizar atual</option>
                              {conflict.entityType === "product" && <option value="CREATE_ALIAS">Criar alias</option>}
                              <option value="CREATE_NEW">Criar novo</option>
                              <option value="IGNORE">Ignorar nesta importação</option>
                            </select>
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() => handleSaveConflictDecision(conflict.key)}
                            >
                              Salvar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {preview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Primeiras linhas</p>
              <h2>Preview dos itens</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}
                title="Empresa/CNPJ que aparece como destinatária das notas fiscais desta planilha. Usada no financeiro, contas a pagar, DRE e auditoria.">
                <span style={{ fontWeight: 600 }}>Empresa faturada <span style={{ color: "red" }}>*</span></span>
                <select
                  value={importCompanyId}
                  onChange={(e) => setImportCompanyId(e.target.value)}
                  style={{ minWidth: "180px" }}
                >
                  <option value="">Selecione...</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.tradeName}</option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                type="button"
                disabled={!canConfirm || status === "confirming" || !importCompanyId}
                onClick={handleConfirm}
              >
                {status === "confirming" ? <Loader2 size={18} /> : <CheckCircle2 size={18} />}
                Confirmar importacao
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>NF</th>
                  <th>Cod. forne</th>
                  <th>Fornecedor</th>
                  <th>Cod. produto</th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Qtde</th>
                  <th>Unidade</th>
                  <th>Total</th>
                  <th>Pagamento</th>
                  <th>Vencimentos</th>
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row, index) => (
                  <tr key={`${row.productDescription}-${index}`}>
                    <td>{formatDate(row.purchaseDate)}</td>
                    <td>{row.invoiceNumber ?? "-"}</td>
                    <td>{row.supplierCode ?? "-"}</td>
                    <td>{row.supplierName}</td>
                    <td>{row.productCode ?? "-"}</td>
                    <td>{row.productDescription}</td>
                    <td>{row.categoryName ?? "-"}</td>
                    <td>{formatNumber(row.quantity)}</td>
                    <td>{row.unit ?? "-"}</td>
                    <td>{formatCurrency(row.totalPrice)}</td>
                    <td>{row.paymentMethod ?? "-"}</td>
                    <td>{row.dueDates ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Resultado</p>
              <h2>Relatorio da importacao</h2>
            </div>
            {report.importBatchId && (
              <button className="danger-button" type="button" onClick={handleDeleteImport}>
                Excluir importacao de teste
              </button>
            )}
          </div>

          <div className="summary-grid">
            <article>
              <span>Total planilha</span>
              <strong>{formatCurrency(report.spreadsheetTotal)}</strong>
            </article>
            <article>
              <span>Total importado</span>
              <strong>{formatCurrency(report.importedTotal)}</strong>
            </article>
            <article>
              <span>Diferenca</span>
              <strong>{formatCurrency(report.differenceTotal)}</strong>
            </article>
            <article>
              <span>Linhas importadas</span>
              <strong>{report.importedRows}</strong>
            </article>
            <article>
              <span>Linhas ignoradas</span>
              <strong>{report.ignoredRows}</strong>
            </article>
            <article>
              <span>Sem produto ignoradas</span>
              <strong>{report.ignoredWithoutProduct}</strong>
            </article>
            <article>
              <span>Vazias ignoradas</span>
              <strong>{report.emptyRowsIgnored ?? 0}</strong>
            </article>
            <article>
              <span>Fornecedores criados</span>
              <strong>{report.suppliersCreated}</strong>
            </article>
            <article>
              <span>Fornecedores reaproveitados</span>
              <strong>{report.suppliersReused}</strong>
            </article>
            <article>
              <span>Produtos criados</span>
              <strong>{report.productsCreated}</strong>
            </article>
            <article>
              <span>Produtos reaproveitados</span>
              <strong>{report.productsReused}</strong>
            </article>
            <article>
              <span>Produtos por fallback</span>
              <strong>{report.productsLinkedByFallback}</strong>
            </article>
            <article>
              <span>Conflitos encontrados</span>
              <strong>{report.conflictsFound}</strong>
            </article>
            <article>
              <span>Conflitos resolvidos</span>
              <strong>{report.conflictsResolved}</strong>
            </article>
            <article>
              <span>Conflitos pendentes</span>
              <strong>{report.conflictsPending}</strong>
            </article>
            <article>
              <span>Decisões automáticas</span>
              <strong>{report.decisionsAppliedAutomatically}</strong>
            </article>
            <article>
              <span>Unidades criadas</span>
              <strong>{report.unitsCreated}</strong>
            </article>
            <article>
              <span>Unidades reaproveitadas</span>
              <strong>{report.unitsReused}</strong>
            </article>
            <article>
              <span>Tipos de gasto criados</span>
              <strong>{report.expenseTypesCreated}</strong>
            </article>
            <article>
              <span>Tipos reaproveitados</span>
              <strong>{report.expenseTypesReused}</strong>
            </article>
            <article>
              <span>Compras criadas</span>
              <strong>{report.purchasesCreated}</strong>
            </article>
            <article>
              <span>Duplicadas bloqueadas</span>
              <strong>{report.duplicatePurchasesBlocked}</strong>
            </article>
            <article>
              <span>Duplicadas autorizadas</span>
              <strong>{report.duplicatePurchasesAuthorized}</strong>
            </article>
            <article>
              <span>Parcelas criadas</span>
              <strong>{report.installmentsCreated}</strong>
            </article>
            <article>
              <span>Tempo</span>
              <strong>{report.elapsedMs >= 1000 ? `${(report.elapsedMs / 1000).toFixed(1)}s` : `${report.elapsedMs}ms`}</strong>
            </article>
          </div>

          {report.purchaseNumbers.length > 0 && (
            <div className="alert success">
              Pedidos internos criados: {report.purchaseNumbers.slice(0, 20).join(", ")}
              {report.purchaseNumbers.length > 20 ? ` e mais ${report.purchaseNumbers.length - 20}` : ""}
            </div>
          )}

          <div className="summary-columns">
            <div>
              <h3>Categorias</h3>
              <p>{report.categories.join(", ") || "-"}</p>
            </div>
            <div>
              <h3>Subcategorias</h3>
              <p>{report.subcategories.join(", ") || "-"}</p>
            </div>
            <div>
              <h3>Pagamentos</h3>
              <p>{report.paymentMethods.join(", ") || "-"}</p>
            </div>
          </div>

          {report.duplicateProducts.length > 0 && (
            <div className="alert warning">
              Possiveis produtos duplicados/repetidos no mes:{" "}
              {report.duplicateProducts.map((item) => `${item.name} (${item.count})`).join(", ")}
            </div>
          )}

          {report.warnings.length > 0 && (
            <div className="alert warning">
              {report.warnings.map((item) => (
                <div key={`${item.rowNumber}-${item.message}`}>
                  {item.rowNumber > 0 ? `Linha ${item.rowNumber}: ` : ""}
                  {item.message}
                </div>
              ))}
            </div>
          )}

          {report.errors.length > 0 && (
            <div className="alert error">
              {report.errors.map((item) => (
                <div key={`${item.rowNumber}-${item.message}`}>
                  Linha {item.rowNumber}: {item.message}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
