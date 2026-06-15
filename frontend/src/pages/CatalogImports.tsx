import { CheckCircle2, Loader2, RotateCcw, Upload } from "lucide-react";
import { useState } from "react";
import {
  CatalogImportKind,
  CatalogImportReport,
  CatalogPreview,
  confirmCatalogImport,
  deleteCatalogImport,
  previewCatalogImport
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { formatDate } from "../utils/format";

type Status = "idle" | "loading-preview" | "preview-ready" | "confirming" | "done" | "error";

const tabs: Array<{ id: CatalogImportKind; label: string }> = [
  { id: "suppliers", label: "Fornecedores" },
  { id: "products", label: "Produtos" }
];

const ignoredReasonLabels: Record<string, string> = {
  LINHA_INVALIDA: "Linha invalida",
  EXISTENTE_NAO_ATUALIZADO: "Existente nao atualizado",
  ERRO_AO_PROCESSAR_LINHA: "Erro ao processar linha"
};

const MAX_IGNORED_ROWS_PREVIEW = 10;

export function CatalogImports() {
  const [kind, setKind] = useState<CatalogImportKind>("suppliers");
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState<string>("");
  const [updateExisting, setUpdateExisting] = useState(false);
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [report, setReport] = useState<CatalogImportReport | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();

  function resetResult() {
    setPreview(null);
    setReport(null);
    setError(null);
    setStatus("idle");
  }

  async function handlePreview(selectedSheetName = sheetName) {
    if (!file) return;
    setError(null);
    setReport(null);
    setStatus("loading-preview");

    try {
      const result = await previewCatalogImport(kind, file, selectedSheetName || null);
      setPreview(result);
      setSheetName(result.sheetName ?? "");
      setStatus("preview-ready");
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : "Erro ao gerar preview.";
      setError(message);
      setNotice({ tone: "error", message: "Importação falhou. Verifique os erros abaixo." });
      setStatus("error");
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setError(null);
    setStatus("confirming");

    try {
      const result = await confirmCatalogImport(kind, {
        importFileId: preview.importFileId,
        originalFileName: preview.originalFileName,
        sheetName: preview.sheetName,
        updateExisting
      });
      setReport(result);
      if (result.processedRows > 0 && result.ignoredRows > 0) {
        setNotice({
          tone: "warning",
          message: `Importação concluída com ${result.processedRows} linha(s) válida(s) processadas e ${result.ignoredRows} ignorada(s).`
        });
      } else if (result.errors.length > 0) {
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

  async function handleUndo() {
    if (!report?.importBatchId) return;
    const confirmed = window.confirm("Desfazer este lote de cadastro?");
    if (!confirmed) return;

    try {
      await deleteCatalogImport(report.importBatchId);
      resetResult();
      setFile(null);
      setSheetName("");
      setNotice({ tone: "success", message: "Importação de teste excluída com sucesso." });
    } catch (undoError) {
      const message = undoError instanceof Error ? undoError.message : "Erro ao desfazer lote.";
      setError(message);
      setNotice({ tone: "error", message: "Erro ao salvar." });
    }
  }

  const canConfirm = Boolean(
    preview && preview.missingRequiredFields.length === 0 && preview.validation.validRows > 0
  );

  const previewIgnoredRows = preview?.ignoredRowDetails ?? [];
  const reportIgnoredRows = report?.ignoredRowDetails ?? [];
  const invalidIgnoredCount = report?.ignoredReasons.find((item) => item.reason === "LINHA_INVALIDA")?.count ?? 0;
  const processingErrorCount = report?.ignoredReasons.find((item) => item.reason === "ERRO_AO_PROCESSAR_LINHA")?.count ?? 0;
  const unchangedExistingCount = report?.reusedRows ?? 0;

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel">
        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={kind === tab.id ? "active" : ""}
              type="button"
              onClick={() => {
                setKind(tab.id);
                setFile(null);
                setSheetName("");
                resetResult();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="section-heading">
          <div>
            <p>Cadastro mestre</p>
            <h2>Importar {kind === "suppliers" ? "fornecedores" : "produtos"}</h2>
          </div>
          <Upload size={24} />
        </div>

        <div className="upload-row">
          <input
            aria-label="Selecionar planilha de cadastro"
            type="file"
            accept=".xlsx,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setSheetName("");
              resetResult();
            }}
          />
          <button className="primary-button" type="button" disabled={!file} onClick={() => handlePreview()}>
            {status === "loading-preview" ? <Loader2 size={18} /> : <Upload size={18} />}
            Gerar preview
          </button>
        </div>

        {preview && preview.sheetNames.length > 1 && (
          <div className="form-grid">
            <label>
              Aba
              <select
                value={sheetName}
                onChange={(event) => {
                  setSheetName(event.target.value);
                  handlePreview(event.target.value);
                }}
              >
                {preview.sheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={updateExisting}
            onChange={(event) => setUpdateExisting(event.target.checked)}
          />
          Atualizar registros existentes quando houver divergencia confirmada
        </label>

        {error && <div className="alert error">{error}</div>}
      </section>

      {preview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Aba {preview.sheetName ?? "-"}</p>
              <h2>Validacao do cadastro</h2>
            </div>
            <strong>{preview.validation.recognizedRows} linhas reconhecidas</strong>
          </div>

          <div className="summary-grid">
            <article>
              <span>Linhas lidas</span>
              <strong>{preview.validation.spreadsheetRows}</strong>
            </article>
            <article>
              <span>Reconhecidas</span>
              <strong>{preview.validation.recognizedRows}</strong>
            </article>
            <article>
              <span>Validas</span>
              <strong>{preview.validation.validRows}</strong>
            </article>
            <article>
              <span>Ignoradas</span>
              <strong>{preview.validation.ignoredRows + preview.validation.emptyRowsIgnored}</strong>
            </article>
            <article>
              <span>Com codigo</span>
              <strong>{preview.validation.rowsWithCode}</strong>
            </article>
            <article>
              <span>Sem codigo</span>
              <strong>{preview.validation.rowsWithoutCode}</strong>
            </article>
            <article>
              <span>Existentes por codigo</span>
              <strong>{preview.validation.existingByCode}</strong>
            </article>
            <article>
              <span>Existentes por nome</span>
              <strong>{preview.validation.existingByName}</strong>
            </article>
            <article>
              <span>Novos estimados</span>
              <strong>{preview.validation.newRows}</strong>
            </article>
            <article>
              <span>Colunas mapeadas</span>
              <strong>{Object.keys(preview.detectedColumns).length}</strong>
            </article>
            {kind === "products" && (
              <>
                <article>
                  <span>Sem setor</span>
                  <strong>{preview.validation.withoutSector}</strong>
                </article>
                <article>
                  <span>Sem controle estoque</span>
                  <strong>{preview.validation.withoutControlsStock}</strong>
                </article>
                <article>
                  <span>Fora da contagem setorial</span>
                  <strong>{preview.validation.notCountableRows}</strong>
                </article>
              </>
            )}
          </div>

          <div className="columns-list">
            {Object.entries(preview.detectedColumns).map(([field, column]) => (
              <span key={field}>
                {field}: <strong>{column}</strong>
              </span>
            ))}
          </div>

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

          {preview.errors.length > 0 && (
            <div className="panel-section">
              <div className="section-heading">
                <div>
                  <p>Linhas ignoradas</p>
                  <h2>Motivos da validacao</h2>
                </div>
                <strong>
                  Exibindo {Math.min(previewIgnoredRows.length, MAX_IGNORED_ROWS_PREVIEW)} de {previewIgnoredRows.length}
                </strong>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Codigo</th>
                      <th>{kind === "suppliers" ? "Fornecedor" : "Descricao"}</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewIgnoredRows.slice(0, MAX_IGNORED_ROWS_PREVIEW).map((item) => (
                      <tr key={`preview-ignored-${item.rowNumber}-${item.reason}`}>
                        <td>{item.rowNumber}</td>
                        <td>{item.code ?? "-"}</td>
                        <td>{item.label ?? "-"}</td>
                        <td>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        </section>
      )}

      {preview && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p>Primeiras linhas</p>
              <h2>Preview dos registros</h2>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={!canConfirm || status === "confirming"}
              onClick={handleConfirm}
            >
              {status === "confirming" ? <Loader2 size={18} /> : <CheckCircle2 size={18} />}
              Confirmar importacao
            </button>
          </div>
          <div className="alert">
            Exibindo {preview.previewRows.length} de {preview.validation.validRows} {kind === "suppliers" ? "registros" : "produtos"} validos. Ao confirmar, todos os {preview.validation.validRows} validos serao processados e {preview.validation.ignoredRows + preview.validation.emptyRowsIgnored} linha(s) invalidas permanecerao ignoradas.
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Codigo</th>
                  <th>{kind === "suppliers" ? "Fornecedor" : "Produto"}</th>
                  {kind === "suppliers" ? <th>CNPJ/CPF</th> : <th>Categoria</th>}
                  {kind === "suppliers" && <th>Data cadastro</th>}
                  {kind === "products" && <th>Subcategoria</th>}
                  {kind === "products" && <th>Unidade</th>}
                  {kind === "products" && <th>Setor</th>}
                  {kind === "products" && <th>TP conta</th>}
                  {kind === "products" && <th>Controla est.</th>}
                  {kind === "products" && <th>Entra na contagem</th>}
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row) => (
                  <tr key={String(row.rowNumber)}>
                    <td>{row.rowNumber}</td>
                    <td>{row.code ?? "-"}</td>
                    <td>{row.name ?? row.description ?? "-"}</td>
                    {kind === "suppliers" ? <td>{row.document ?? "-"}</td> : <td>{row.categoryName ?? "-"}</td>}
                    {kind === "suppliers" && <td>{formatDate(String(row.registrationDate ?? ""))}</td>}
                    {kind === "products" && <td>{row.subcategoryName ?? "-"}</td>}
                    {kind === "products" && <td>{row.unit ?? "-"}</td>}
                    {kind === "products" && <td>{row.sectorName ?? "-"}</td>}
                    {kind === "products" && <td>{row.accountType ?? "-"}</td>}
                    {kind === "products" && <td>{row.controlsStock === false ? "Nao" : "Sim"}</td>}
                    {kind === "products" && <td>{row.countableInSectoral === false ? "Nao (setorial)" : "Sim"}</td>}
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
              <button className="secondary-button" type="button" onClick={handleUndo}>
                <RotateCcw size={18} />
                Desfazer lote
              </button>
            )}
          </div>

          <div className="summary-grid">
            <article>
              <span>Total linhas</span>
              <strong>{report.totalRows}</strong>
            </article>
            <article>
              <span>Reconhecidas</span>
              <strong>{report.recognizedRows}</strong>
            </article>
            <article>
              <span>Validas</span>
              <strong>{report.validRows}</strong>
            </article>
            <article>
              <span>Processadas</span>
              <strong>{report.processedRows}</strong>
            </article>
            <article>
              <span>Importados</span>
              <strong>{report.importedRows}</strong>
            </article>
            <article>
              <span>Criados</span>
              <strong>{report.createdRows}</strong>
            </article>
            <article>
              <span>Atualizados</span>
              <strong>{report.updatedRows}</strong>
            </article>
            <article>
              <span>Reaproveitados existentes</span>
              <strong>{report.reusedRows}</strong>
            </article>
            <article>
              <span>Existentes mantidos</span>
              <strong>{unchangedExistingCount}</strong>
            </article>
            <article>
              <span>Linhas invalidas ignoradas</span>
              <strong>{invalidIgnoredCount}</strong>
            </article>
            <article>
              <span>Nao alterados</span>
              <strong>{report.ignoredRows}</strong>
            </article>
            {kind === "products" && (
              <>
                <article>
                  <span>Sem setor</span>
                  <strong>{report.withoutSector}</strong>
                </article>
                <article>
                  <span>Sem controle estoque</span>
                  <strong>{report.withoutControlsStock}</strong>
                </article>
                <article>
                  <span>Fora da contagem setorial</span>
                  <strong>{report.notCountableRows}</strong>
                </article>
              </>
            )}
          </div>

          {report.ignoredReasons.length > 0 && (
            <div className="alert warning">
              {report.ignoredReasons.map((item) => (
                <div key={item.reason}>
                  {ignoredReasonLabels[item.reason] ?? item.reason}: {item.count}
                </div>
              ))}
              <div>
                Resumo: {report.processedRows} processadas, {report.importedRows} importadas, {unchangedExistingCount} existentes mantidas e {invalidIgnoredCount} invalidas ignoradas.
              </div>
              {processingErrorCount > 0 && (
                <div>Falhas durante o processamento: {processingErrorCount}</div>
              )}
            </div>
          )}

          {reportIgnoredRows.length > 0 && (
            <div className="panel-section">
              <div className="section-heading">
                <div>
                  <p>Linhas ignoradas</p>
                  <h2>Resumo dos erros por linha</h2>
                </div>
                <strong>
                  Exibindo {Math.min(reportIgnoredRows.length, MAX_IGNORED_ROWS_PREVIEW)} de {reportIgnoredRows.length}
                </strong>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Codigo</th>
                      <th>{kind === "suppliers" ? "Fornecedor" : "Descricao"}</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportIgnoredRows.slice(0, MAX_IGNORED_ROWS_PREVIEW).map((item) => (
                      <tr key={`report-ignored-${item.rowNumber}-${item.reason}`}>
                        <td>{item.rowNumber}</td>
                        <td>{item.code ?? "-"}</td>
                        <td>{item.label ?? "-"}</td>
                        <td>{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.errors.length > 0 && (
            <div className="alert error">
              {report.errors.map((item, index) => (
                <div key={`${item.rowNumber}-${item.message}-${index}`}>
                  {item.rowNumber > 0 ? `Linha ${item.rowNumber}: ` : ""}
                  {item.message}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
