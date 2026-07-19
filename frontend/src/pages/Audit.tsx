import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { AuditLog, AuditLogsResponse, getAuditLogs, restoreEmployee, restorePayrollItem } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { PeriodFilter } from "../components/PeriodFilter";
import {
  Button,
  EmptyState,
  FormField,
  IconButton,
  PanelEyebrow,
  Table,
  TextField
} from "../design-system";
import { labelAction, extractReason } from "../utils/auditLabels";
import { formatDate } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

// Ações de exclusão que podem ser desfeitas (soft delete) e para qual endpoint.
const RESTORABLE: Record<string, "payroll" | "employee"> = {
  DELETE_PAYROLL_ITEM: "payroll",
  DELETE_EMPLOYEE: "employee",
};

export function Audit() {
  const [response, setResponse] = useState<AuditLogsResponse | null>(null);
  const [filters, setFilters] = useState({ userId: "", entity: "" });
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { notice, setNotice } = useNotice();

  const rows = response?.data ?? [];
  const pagination = response?.pagination;

  async function load(p = page) {
    const result = await getAuditLogs({ ...filters, startDate: period.startDate, endDate: period.endDate, page: p, limit: 50 });
    setResponse(result);
    setPage(p);
  }

  function handleFilter() {
    load(1);
  }

  async function handleRestore(row: AuditLog) {
    const kind = RESTORABLE[row.action];
    if (!kind || !row.entityId) return;
    const label = kind === "payroll" ? "este lançamento" : "este funcionário";
    if (!window.confirm(`Restaurar ${label}? Ele volta a aparecer no sistema.`)) return;
    setRestoringId(row.id);
    try {
      if (kind === "payroll") await restorePayrollItem(row.entityId);
      else await restoreEmployee(row.entityId);
      setNotice({ tone: "success", message: kind === "employee" ? "Funcionário restaurado — volta como inativo; reative em Funcionários se precisar." : "Lançamento restaurado." });
      await load(page);
    } catch (err) {
      setNotice({ tone: "error", message: err instanceof Error ? err.message : "Erro ao restaurar." });
    } finally {
      setRestoringId(null);
    }
  }

  useEffect(() => {
    load(1);
  }, []);

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-heading">
          <PanelEyebrow>Registro de ações por usuário e entidade</PanelEyebrow>
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar" onClick={() => load(page)} />
        </div>
        <div className="filters-row">
          <FormField label="Usuário ID">
            <TextField value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })} />
          </FormField>
          <FormField label="Entidade">
            <TextField placeholder="Purchase, User..." value={filters.entity} onChange={(event) => setFilters({ ...filters, entity: event.target.value })} />
          </FormField>
          <PeriodFilter value={period} onChange={setPeriod} />
          <Button onClick={handleFilter}>Filtrar</Button>
        </div>
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Data</Table.Th>
              <Table.Th>Usuário</Table.Th>
              <Table.Th>Ação</Table.Th>
              <Table.Th>Entidade</Table.Th>
              <Table.Th>ID</Table.Th>
              <Table.Th>Motivo</Table.Th>
              <Table.Th>IP</Table.Th>
              <Table.Th actions>Detalhes</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.id}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{formatDate(row.createdAt)}</Table.Td>
                <Table.Td truncate style={{ maxWidth: 180 }} title={row.userName ?? row.userEmail ?? undefined}>{row.userName ?? row.userEmail ?? row.userId ?? "-"}</Table.Td>
                <Table.Td truncate style={{ maxWidth: 220 }} title={row.action}>{labelAction(row.action)}</Table.Td>
                <Table.Td>{row.entity}</Table.Td>
                <Table.Td truncate style={{ maxWidth: 140 }} title={row.entityId ?? undefined}>{row.entityId ?? "-"}</Table.Td>
                {(() => {
                  const reason = extractReason([row.newValue, row.previousValue]);
                  return (
                    <Table.Td truncate style={{ maxWidth: 220 }} title={reason || undefined}>
                      {reason || "—"}
                    </Table.Td>
                  );
                })()}
                <Table.Td>{row.ipAddress ?? "-"}</Table.Td>
                <Table.Td actions>
                  {RESTORABLE[row.action] && row.entityId && (
                    <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={14} />} onClick={() => handleRestore(row)} disabled={restoringId === row.id}>
                      {restoringId === row.id ? "..." : "Restaurar"}
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setSelected(row)}>Ver</Button>
                </Table.Td>
              </Table.Row>
            ))}
            {rows.length === 0 && (
              <Table.Row>
                <Table.Td colSpan={8}>
                  <EmptyState title="Nenhum registro no período" />
                </Table.Td>
              </Table.Row>
            )}
          </Table.Body>
        </Table>
        {pagination && pagination.totalPages > 1 && (
          <div className="pagination-row">
            <IconButton icon={<ChevronLeft size={16} />} label="Página anterior" disabled={page <= 1} onClick={() => load(page - 1)} />
            <span>Página {pagination.page} de {pagination.totalPages} — {pagination.total} registros</span>
            <IconButton icon={<ChevronRight size={16} />} label="Próxima página" disabled={page >= pagination.totalPages} onClick={() => load(page + 1)} />
          </div>
        )}
        {pagination && <p className="hint">{pagination.total} registro{pagination.total !== 1 ? "s" : ""} encontrado{pagination.total !== 1 ? "s" : ""}.</p>}
      </section>
      {selected && (
        <section className="panel">
          <div className="section-heading"><div><PanelEyebrow>Antes/depois</PanelEyebrow><h2>Detalhes da auditoria</h2></div><Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button></div>
          <div className="summary-columns">
            <div><h3>Antes</h3><pre>{JSON.stringify(selected.previousValue, null, 2)}</pre></div>
            <div><h3>Depois</h3><pre>{JSON.stringify(selected.newValue, null, 2)}</pre></div>
            <div><h3>Contexto</h3><p>{selected.userAgent ?? "-"}</p></div>
          </div>
        </section>
      )}
    </div>
  );
}
