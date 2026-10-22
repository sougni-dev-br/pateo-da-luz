import { Download, Eye, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import type { CreditCard, CreditCardStatement } from "../../api/client";
import { Button, EmptyState, Money, RowMenu, StatusBadge, type StatusTone } from "../../design-system";
import { PeriodFilter } from "../../components/PeriodFilter";
import { formatDate } from "../../utils/format";
import { vencimentoRelativo } from "./resumo-de-faturas";
import "./cards-pagina.css";

type Periodo = React.ComponentProps<typeof PeriodFilter>["value"];

export const STATUS_DAS_FATURAS = [
  { valor: "", rotulo: "Todas" },
  { valor: "OPEN", rotulo: "Abertas" },
  { valor: "CHECKED", rotulo: "Conferidas" },
  { valor: "CLOSED", rotulo: "Fechadas" },
  { valor: "PAID", rotulo: "Pagas" }
] as const;

const ROTULO: Record<string, string> = {
  OPEN: "Aberta",
  CHECKED: "Conferida",
  CLOSED: "Fechada",
  PAID: "Paga",
  CANCELLED: "Cancelada"
};

const TOM: Record<string, StatusTone> = {
  OPEN: "warning",
  CHECKED: "info",
  CLOSED: "neutral",
  PAID: "success",
  CANCELLED: "neutral"
};

type Props = {
  faturas: CreditCardStatement[];
  contas: CreditCard[];
  filtroStatus: string;
  filtroConta: string;
  periodo: Periodo;
  podeEditar: boolean;
  podeReabrir: boolean;
  onFiltroStatus: (status: string) => void;
  onFiltroConta: (id: string) => void;
  onPeriodo: (periodo: Periodo) => void;
  onAbrir: (fatura: CreditCardStatement, conferir?: boolean) => void;
  onFechar: (fatura: CreditCardStatement) => void;
  onReabrir: (fatura: CreditCardStatement) => void;
  onPdf: (fatura: CreditCardStatement) => void;
  onNova: () => void;
};

function Conferencia({ fatura }: { fatura: CreditCardStatement }) {
  const total = fatura._count?.items ?? 0;
  const conferidos = fatura.itensConferidos ?? 0;
  const semCartao = fatura.itensSemCartao ?? 0;
  const temFinais = (fatura.creditCard?.finais ?? []).some((final) => final.isActive);
  if (total === 0) return <span className="fatura-linha-vazio">Sem lançamentos</span>;
  const percentual = Math.round((conferidos / total) * 100);
  return (
    <div className="fatura-linha-conferencia">
      <div className="fatura-linha-barra" role="img" aria-label={`${conferidos} de ${total} lançamentos conferidos`}>
        <span style={{ width: `${percentual}%` }} />
      </div>
      <small>{conferidos}/{total} conferidos</small>
      {temFinais && semCartao > 0 && <small className="fatura-linha-aviso">{semCartao} sem cartão definido</small>}
    </div>
  );
}

export function ListaDeFaturas(props: Props) {
  const { faturas, contas } = props;
  const emAberto = (status: string) => status === "OPEN" || status === "CHECKED";

  return (
    <section className="panel cartoes-faturas" aria-label="Faturas">
      <div className="cartoes-faturas-barra">
        <div className="cartoes-chips" role="group" aria-label="Filtrar por situação">
          {STATUS_DAS_FATURAS.map((opcao) => (
            <button
              key={opcao.valor || "todas"}
              type="button"
              className={`cartoes-chip${props.filtroStatus === opcao.valor ? " ativo" : ""}`}
              aria-pressed={props.filtroStatus === opcao.valor}
              onClick={() => props.onFiltroStatus(opcao.valor)}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>
        <div className="cartoes-faturas-filtros">
          {contas.length > 1 && (
            <label>
              <span className="visually-hidden">Cartão</span>
              <select value={props.filtroConta} onChange={(event) => props.onFiltroConta(event.target.value)} aria-label="Cartão">
                <option value="">Todos os cartões</option>
                {contas.map((conta) => <option key={conta.id} value={conta.id}>{conta.name}</option>)}
              </select>
            </label>
          )}
          <PeriodFilter value={props.periodo} onChange={props.onPeriodo} />
        </div>
      </div>

      {faturas.length === 0 ? (
        <EmptyState
          title="Nenhuma fatura neste filtro"
          description="Troque o período ou a situação. As faturas nascem sozinhas quando uma compra no cartão é lançada."
          action={props.podeEditar ? <Button variant="secondary" onClick={props.onNova}>Criar fatura manualmente</Button> : undefined}
        />
      ) : (
        <ul className="fatura-linhas">
          {faturas.map((fatura) => {
            const prazo = vencimentoRelativo(fatura.dueDate, fatura.status);
            const competencia = `${String(fatura.competenceMonth).padStart(2, "0")}/${fatura.competenceYear}`;
            const aberta = emAberto(fatura.status);
            const itensDoMenu = [
              ...(props.podeEditar && fatura.status !== "CLOSED" && fatura.status !== "PAID" && fatura.status !== "CANCELLED"
                ? [{ label: "Fechar fatura", icon: <Lock size={15} />, onClick: () => props.onFechar(fatura) }]
                : []),
              ...(props.podeReabrir && (fatura.status === "CLOSED" || fatura.status === "PAID")
                ? [{ label: "Reabrir fatura", icon: <RotateCcw size={15} />, onClick: () => props.onReabrir(fatura) }]
                : []),
              { label: "Baixar PDF", icon: <Download size={15} />, onClick: () => props.onPdf(fatura) }
            ];
            return (
              <li key={fatura.id} className="fatura-linha">
                <div className="fatura-linha-titulo">
                  <strong>{competencia}</strong>
                  <span>{fatura.creditCard?.name ?? "—"}</span>
                </div>
                <div className="fatura-linha-vencimento">
                  <span>{formatDate(fatura.dueDate)}</span>
                  {prazo.texto && <small className={`prazo-${prazo.tom}`}>{prazo.texto}</small>}
                </div>
                <Conferencia fatura={fatura} />
                <div className="fatura-linha-total">
                  <Money value={fatura.totalAmount} />
                </div>
                <div className="fatura-linha-status">
                  <StatusBadge tone={TOM[fatura.status] ?? "neutral"}>{ROTULO[fatura.status] ?? fatura.status}</StatusBadge>
                </div>
                <div className="fatura-linha-acoes">
                  {aberta && props.podeEditar ? (
                    <Button size="sm" leadingIcon={<ShieldCheck size={15} />} onClick={() => props.onAbrir(fatura, true)}>
                      Conferir
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" leadingIcon={<Eye size={15} />} onClick={() => props.onAbrir(fatura)}>
                      Ver
                    </Button>
                  )}
                  <RowMenu items={itensDoMenu} label={`Mais ações da fatura ${competencia}`} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
