import { Money } from "../../design-system";
import type { FaixaVencimento, TotaisCompras } from "./vencimento";

type Cartao = {
  faixa: FaixaVencimento;
  rotulo: string;
  tom: "neutral" | "warning" | "danger" | "info" | "success";
  valor: (t: TotaisCompras) => number;
  legenda: (t: TotaisCompras) => string;
};

const plural = (n: number) => `${n} ${n === 1 ? "compra" : "compras"}`;

const CARTOES: Cartao[] = [
  { faixa: "todas", rotulo: "Comprado no período", tom: "neutral", valor: (t) => t.total, legenda: (t) => plural(t.quantidade) },
  { faixa: "abertas", rotulo: "Em aberto", tom: "warning", valor: (t) => t.aberto.valor, legenda: (t) => plural(t.aberto.compras) },
  { faixa: "vencidas", rotulo: "Vencido", tom: "danger", valor: (t) => t.vencido.valor, legenda: (t) => plural(t.vencido.compras) },
  { faixa: "vence7", rotulo: "Vence em 7 dias", tom: "info", valor: (t) => t.vence7.valor, legenda: (t) => plural(t.vence7.compras) },
  { faixa: "pagas", rotulo: "Pagas", tom: "success", valor: (t) => t.pago.valor, legenda: (t) => plural(t.pago.compras) }
];

type Props = {
  totais: TotaisCompras;
  faixa: FaixaVencimento;
  onFaixa: (faixa: FaixaVencimento) => void;
};

/** Faixa de totais: cada cartão é um botão que filtra a lista pelo vencimento. */
export function ResumoCompras({ totais, faixa, onFaixa }: Props) {
  return (
    <div className="cp-kpis" role="group" aria-label="Resumo das compras — clique para filtrar">
      {CARTOES.map((cartao) => {
        const valor = cartao.valor(totais);
        const ativo = faixa === cartao.faixa;
        const alerta = cartao.faixa === "vencidas" && valor > 0;
        return (
          <button
            key={cartao.faixa}
            type="button"
            className={`cp-kpi cp-kpi--${cartao.tom}${alerta ? " cp-kpi--alerta" : ""}${ativo ? " cp-kpi--ativo" : ""}`}
            aria-pressed={ativo}
            onClick={() => onFaixa(ativo && cartao.faixa !== "todas" ? "todas" : cartao.faixa)}
          >
            <span className="cp-kpi-rotulo">{cartao.rotulo}</span>
            <strong className="cp-kpi-valor"><Money value={valor} /></strong>
            <span className="cp-kpi-legenda">{cartao.legenda(totais)}</span>
          </button>
        );
      })}
    </div>
  );
}
