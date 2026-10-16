import { X } from "lucide-react";
import type { Supplier } from "../../api/client";
import { OPCOES_STATUS, OPCOES_SUBTIPO, OPCOES_TIPO } from "./PainelFiltros";
import type { FiltrosPagar } from "./regras";

export type CampoFiltro = "supplierId" | "paymentMethodId" | "status" | "origin" | "sourceType";

type Props = {
  filtros: FiltrosPagar;
  fornecedores: Supplier[];
  formas: Array<{ id: string; label: string }>;
  /** Dia escolhido na agenda (YYYY-MM-DD), quando há. */
  dia?: string | null;
  onRemover: (campo: CampoFiltro) => void;
  onRemoverDia?: () => void;
};

/** Os filtros avançados em vigor, sempre à vista (mesmo com o painel recolhido), cada um removível. */
export function PilulasDeFiltros({ filtros, fornecedores, formas, dia, onRemover, onRemoverDia }: Props) {
  const nomeDe = <T extends { value: string; label: string }>(lista: T[], valor: string) => lista.find((o) => o.value === valor)?.label ?? valor;
  const pilulas: Array<{ campo: CampoFiltro; rotulo: string; valor: string }> = [];
  if (filtros.supplierId) pilulas.push({ campo: "supplierId", rotulo: "Fornecedor", valor: fornecedores.find((s) => s.id === filtros.supplierId)?.name ?? "—" });
  if (filtros.paymentMethodId) pilulas.push({ campo: "paymentMethodId", rotulo: "Forma", valor: formas.find((f) => f.id === filtros.paymentMethodId)?.label ?? "—" });
  if (filtros.status) pilulas.push({ campo: "status", rotulo: "Status", valor: nomeDe(OPCOES_STATUS, filtros.status) });
  if (filtros.origin !== "all") pilulas.push({ campo: "origin", rotulo: "Tipo", valor: nomeDe(OPCOES_TIPO, filtros.origin) });
  if (filtros.sourceType) pilulas.push({ campo: "sourceType", rotulo: "Sub-tipo", valor: nomeDe(OPCOES_SUBTIPO, filtros.sourceType) });
  if (pilulas.length === 0 && !dia) return null;

  return (
    <ul className="pg-pilulas" aria-label="Filtros ativos">
      {dia && (
        <li>
          <button type="button" className="pg-pilula" onClick={onRemoverDia} aria-label={`Remover filtro Vencimento: ${dia.slice(8, 10)}/${dia.slice(5, 7)}`}>
            <span>Vencimento: <b>{dia.slice(8, 10)}/{dia.slice(5, 7)}</b></span>
            <X size={13} aria-hidden="true" />
          </button>
        </li>
      )}
      {pilulas.map((p) => (
        <li key={p.campo}>
          <button type="button" className="pg-pilula" onClick={() => onRemover(p.campo)} aria-label={`Remover filtro ${p.rotulo}: ${p.valor}`}>
            <span>{p.rotulo}: <b>{p.valor}</b></span>
            <X size={13} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
