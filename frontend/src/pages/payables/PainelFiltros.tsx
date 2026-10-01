import type { Supplier } from "../../api/client";
import { Select } from "../../design-system";
import type { PeriodState } from "../../utils/period";
import { OPCOES_PERIODO, TIPOS_FOLHA, type FiltrosPagar } from "./regras";

type Props = {
  id: string;
  filtros: FiltrosPagar;
  periodo: PeriodState;
  fornecedores: Supplier[];
  formas: Array<{ id: string; label: string }>;
  onPeriodo: (preset: string) => void;
  onData: (campo: "startDate" | "endDate", valor: string) => void;
  onFiltros: (novos: FiltrosPagar) => void;
  onStatus: (status: string) => void;
  onTipo: (origin: string) => void;
};

const OPCOES_SUBTIPO = [
  { value: "DIRECT", label: "Título normal" },
  { value: "CARD_STATEMENT", label: "Fatura cartão" },
  { value: "LEGACY_CREDIT_CARD", label: "Cartão legado" },
  { value: "SUPPLIER_CYCLE", label: "Ciclo fornecedor" },
  { value: "PAYROLL", label: "Folha de pagamento (tudo)" },
  ...TIPOS_FOLHA.map((t) => ({ value: `PAYROLL:${t}`, label: `Folha · ${t}` })),
  { value: "EXTRA", label: "Diárias de extras" }
];

const OPCOES_STATUS = [
  { value: "OPEN", label: "Em aberto" },
  { value: "OVERDUE", label: "Vencido" },
  { value: "PAID", label: "Pago" },
  { value: "PAID_LATE", label: "Pago com atraso" },
  { value: "CANCELLED", label: "Cancelado" }
];

const OPCOES_TIPO = [
  { value: "all", label: "Todos" },
  { value: "purchases", label: "Compras" },
  { value: "taxes", label: "Impostos" }
];

/** Filtros avançados (recolhíveis). Cada mudança recarrega a lista pelo pai. */
export function PainelFiltros({ id, filtros, periodo, fornecedores, formas, onPeriodo, onData, onFiltros, onStatus, onTipo }: Props) {
  return (
    <div id={id} className="pg-filtros" role="group" aria-label="Filtros avançados">
      <Select label="Período de vencimento" value={periodo.preset} onChange={(e) => onPeriodo(e.target.value)} options={OPCOES_PERIODO} />
      {periodo.preset === "custom" && (
        <>
          <label className="pg-filtro-data">
            Data inicial
            <input type="date" value={periodo.startDate} onChange={(e) => onData("startDate", e.target.value)} />
          </label>
          <label className="pg-filtro-data">
            Data final
            <input type="date" value={periodo.endDate} onChange={(e) => onData("endDate", e.target.value)} />
          </label>
        </>
      )}
      <Select
        label="Fornecedor"
        value={filtros.supplierId}
        onChange={(e) => onFiltros({ ...filtros, supplierId: e.target.value })}
        placeholder="Todos"
        options={fornecedores.map((s) => ({ value: s.id, label: s.name }))}
      />
      <Select
        label="Forma de pagamento"
        value={filtros.paymentMethodId}
        onChange={(e) => onFiltros({ ...filtros, paymentMethodId: e.target.value })}
        placeholder="Todas"
        options={formas.map((o) => ({ value: o.id, label: o.label }))}
      />
      <Select label="Status" value={filtros.status} onChange={(e) => onStatus(e.target.value)} placeholder="Todos" options={OPCOES_STATUS} />
      <Select label="Tipo" value={filtros.origin} onChange={(e) => onTipo(e.target.value)} options={OPCOES_TIPO} />
      {filtros.origin !== "taxes" && (
        <Select
          label="Sub-tipo"
          value={filtros.sourceType}
          onChange={(e) => onFiltros({ ...filtros, sourceType: e.target.value })}
          placeholder="Todos"
          options={OPCOES_SUBTIPO}
        />
      )}
    </div>
  );
}
