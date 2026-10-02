import type { Supplier } from "../../api/client";
import { Select } from "../../design-system";
import type { PeriodState } from "../../utils/period";
import { OPCOES_PERIODO, type FiltrosPagar } from "./regras";

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

// Em grupos para achar de olho. "Folha (tudo)" traz também os títulos da folha liberada.
export const OPCOES_SUBTIPO = [
  { value: "DIRECT", label: "Título normal", group: "Compras" },
  { value: "CARD_STATEMENT", label: "Fatura do cartão", group: "Compras" },
  { value: "LEGACY_CREDIT_CARD", label: "Cartão (legado)", group: "Compras" },
  { value: "SUPPLIER_CYCLE", label: "Ciclo do fornecedor", group: "Compras" },
  { value: "PAYROLL", label: "Folha (tudo)", group: "Folha" },
  { value: "FOLHA_LOTE", label: "Folha liberada (títulos por empresa)", group: "Folha" },
  { value: "PAYROLL:Salário", label: "Salário CLT", group: "Folha" },
  { value: "PAYROLL:Salário (acerto)", label: "Salário sem registro (acerto)", group: "Folha" },
  { value: "PAYROLL:1ª quinzena", label: "1ª quinzena", group: "Folha" },
  { value: "PAYROLL:Adiantamento", label: "Adiantamento", group: "Folha" },
  { value: "PAYROLL:Vale-transporte", label: "Vale-transporte", group: "Folha" },
  { value: "PAYROLL:Rescisão", label: "Rescisão", group: "Folha" },
  { value: "PAYROLL:Férias", label: "Férias", group: "Folha" },
  { value: "EXTRA", label: "Diárias de extras", group: "Extras" },
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
