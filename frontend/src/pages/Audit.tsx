import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AuditLog, getAuditLogs } from "../api/client";
import { PeriodFilter } from "../components/PeriodFilter";
import { formatDate } from "../utils/format";
import { currentMonthPeriod } from "../utils/period";

export function Audit() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [filters, setFilters] = useState({ userId: "", entity: "" });
  const [period, setPeriod] = useState(currentMonthPeriod());
  const [selected, setSelected] = useState<AuditLog | null>(null);

  async function load() {
    setRows(await getAuditLogs({ ...filters, startDate: period.startDate, endDate: period.endDate }));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div><p>Controle</p><h2>Auditoria</h2></div>
          <button className="icon-button" type="button" onClick={load} aria-label="Atualizar"><RefreshCw size={18} /></button>
        </div>
        <div className="filters-row">
          <label>Usuário ID<input value={filters.userId} onChange={(event) => setFilters({ ...filters, userId: event.target.value })} /></label>
          <label>Entidade<input placeholder="Purchase, User..." value={filters.entity} onChange={(event) => setFilters({ ...filters, entity: event.target.value })} /></label>
          <PeriodFilter value={period} onChange={setPeriod} />
          <button className="primary-button" type="button" onClick={load}>Filtrar</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>ID</th><th>IP</th><th>Detalhes</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{row.userName ?? row.userEmail ?? row.userId ?? "-"}</td>
                  <td>{row.action}</td>
                  <td>{row.entity}</td>
                  <td>{row.entityId ?? "-"}</td>
                  <td>{row.ipAddress ?? "-"}</td>
                  <td><button type="button" onClick={() => setSelected(row)}>Ver</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected && (
        <section className="panel">
          <div className="section-heading"><div><p>Antes/depois</p><h2>Detalhes da auditoria</h2></div><button type="button" onClick={() => setSelected(null)}>Fechar</button></div>
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
