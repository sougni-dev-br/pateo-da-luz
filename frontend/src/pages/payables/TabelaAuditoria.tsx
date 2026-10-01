import type { AuditLog } from "../../api/client";
import { formatDate } from "../../utils/format";

type LinhaAuditoria = Pick<AuditLog, "id" | "action" | "userName" | "createdAt">;
type Props = { linhas: LinhaAuditoria[]; vazio?: string };

export function TabelaAuditoria({ linhas, vazio = "Nenhum registro de auditoria." }: Props) {
  if (linhas.length === 0) return <p className="pg-vazio-curto">{vazio}</p>;
  return (
    <div className="table-wrap">
      <table className="pg-tabela">
        <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th></tr></thead>
        <tbody>
          {linhas.map((a) => (
            <tr key={a.id}>
              <td className="pg-tnum">{formatDate(a.createdAt)}</td>
              <td>{a.userName ?? "-"}</td>
              <td>{a.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
