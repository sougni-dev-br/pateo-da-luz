import type { ReactNode } from "react";
import { StatusBadge } from "../../design-system";
import { statusLabels, statusTones } from "./regras";

export function StatusTitulo({ status }: { status: string }) {
  return <StatusBadge tone={statusTones[status] ?? "neutral"}>{statusLabels[status] ?? status}</StatusBadge>;
}

/** Par rótulo/valor das janelas de detalhe (dentro de um <dl className="pg-campos">). */
export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="pg-campo">
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}
