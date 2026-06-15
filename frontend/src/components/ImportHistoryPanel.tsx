import { RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getImportHistory, ImportHistoryEntry, undoRevenueImport } from "../api/client";
import { Notice, useNotice } from "./Notice";
import { formatDate } from "../utils/format";
import { EmptyState, StatusBadge } from "./ui";

function formatType(type: string) {
  const normalized = type.toUpperCase();
  if (normalized === "IMPORT_REVENUE_EXCEL") return "Faturamento";
  if (normalized === "UNDO_REVENUE_IMPORT_BATCH") return "Desfazer faturamento";
  if (normalized === "IMPORT_PURCHASE") return "Compras";
  if (normalized === "IMPORT_INVENTORY_INITIAL") return "Inventario inicial";
  if (normalized === "IMPORT_INVENTORY_FINAL") return "Inventario final";
  return normalized.replace(/^IMPORT_/, "").replace(/_/g, " ").toLowerCase();
}

function statusTone(status: string) {
  const normalized = status.toUpperCase();
  if (["SUCCESS", "COMPLETED", "IMPORTED"].includes(normalized)) return "success" as const;
  if (["FAILED", "ERROR", "CANCELLED"].includes(normalized)) return "danger" as const;
  if (["PENDING", "PROCESSING"].includes(normalized)) return "warning" as const;
  return "neutral" as const;
}

export function ImportHistoryPanel() {
  const [rows, setRows] = useState<ImportHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { notice, setNotice } = useNotice();

  async function load() {
    setLoading(true);
    try {
      setRows(await getImportHistory());
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar historico de importacoes." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleUndo(row: ImportHistoryEntry) {
    if (!row.importId) return;
    if (row.type !== "IMPORT_REVENUE_EXCEL") {
      setNotice({ tone: "warning", message: "Desfazer direto pelo historico esta disponivel apenas para faturamento." });
      return;
    }
    if (!window.confirm("Deseja desfazer este lote de faturamento?")) return;
    try {
      await undoRevenueImport(row.importId);
      setNotice({ tone: "success", message: "Lote de faturamento desfeito com sucesso." });
      await load();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao desfazer lote." });
    }
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Importacoes</p>
            <h2>Historico de lotes</h2>
          </div>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar historico">
            <RefreshCw size={18} />
          </button>
        </div>
        {loading && <p className="muted-inline">Carregando...</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Arquivo</th>
                <th>Usuario</th>
                <th>Data/hora</th>
                <th>Total linhas</th>
                <th>Importadas</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="truncate-cell" title={formatType(row.type)}>{formatType(row.type)}</td>
                  <td className="truncate-cell" title={row.fileName}>{row.fileName}</td>
                  <td className="truncate-cell" title={row.userName ?? row.userEmail ?? "-"}>{row.userName ?? row.userEmail ?? "-"}</td>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{row.totalRows}</td>
                  <td>{row.importedRows}</td>
                  <td><StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge></td>
                  <td>
                    {row.undoAvailable ? (
                      <button className="secondary-button" type="button" onClick={() => handleUndo(row)}>
                        <Undo2 size={14} /> Desfazer
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState title="Nenhuma importacao realizada." description="Os lotes importados vao aparecer aqui com arquivo, usuario, data e status." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
