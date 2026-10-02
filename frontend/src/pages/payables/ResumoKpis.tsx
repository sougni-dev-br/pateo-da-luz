import { Money } from "../../design-system";

export type CartaoResumo = "open" | "overdue" | "paidMonth" | "paidToday" | "next7" | "next30";

export type TotaisResumo = Record<CartaoResumo, number>;

const CARTOES: Array<{ chave: CartaoResumo; rotulo: string; tom: "warning" | "danger" | "success" | "info" }> = [
  { chave: "overdue", rotulo: "Vencido", tom: "danger" },
  // Só os ainda não vencidos: a aba "Em aberto" da lista soma estes mais os vencidos.
  { chave: "open", rotulo: "A vencer", tom: "warning" },
  { chave: "next7", rotulo: "Próx. 7 dias", tom: "info" },
  { chave: "next30", rotulo: "Próx. 30 dias", tom: "info" },
  { chave: "paidToday", rotulo: "Pago hoje", tom: "success" },
  { chave: "paidMonth", rotulo: "Pago no mês", tom: "success" }
];

type Props = { totais: TotaisResumo; onCartao: (c: CartaoResumo) => void };

/** Faixa de totais: cada cartão é um botão que filtra a lista (mesmo efeito de antes). */
export function ResumoKpis({ totais, onCartao }: Props) {
  return (
    <div className="pg-kpis" role="group" aria-label="Resumo financeiro — clique para filtrar">
      {CARTOES.map((c) => {
        const valor = totais[c.chave];
        const alerta = c.chave === "overdue" && valor > 0;
        return (
          <button
            key={c.chave}
            type="button"
            className={`pg-kpi pg-kpi--${c.tom}${alerta ? " pg-kpi--alerta" : ""}`}
            onClick={() => onCartao(c.chave)}
          >
            <span className="pg-kpi-rotulo">{c.rotulo}</span>
            <strong className="pg-kpi-valor"><Money value={valor} /></strong>
          </button>
        );
      })}
    </div>
  );
}
