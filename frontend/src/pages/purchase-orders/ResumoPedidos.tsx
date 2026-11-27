import { Money } from "../../design-system";
import type { Etapa, TotalEtapa } from "./regras";

type Cartao = { etapa: Etapa; rotulo: string; dica: string; tom: "neutral" | "warning" | "info" | "success" | "danger" };

// Uma etapa por cartão, na ordem do fluxo: o que está parado em cada passo e quanto vale.
const CARTOES: Cartao[] = [
  { etapa: "rascunho", rotulo: "Rascunho", dica: "falta revisar", tom: "warning" },
  { etapa: "revisao", rotulo: "Em revisão", dica: "esperando aprovação", tom: "info" },
  { etapa: "aEnviar", rotulo: "Aprovados", dica: "falta enviar", tom: "success" },
  { etapa: "aReceber", rotulo: "Aguardando entrega", dica: "enviados ao fornecedor", tom: "neutral" },
  { etapa: "recebidos", rotulo: "Recebidos", dica: "entregues", tom: "success" }
];

type Props = {
  totais: Record<Etapa, TotalEtapa>;
  ativa: Etapa | null;
  onEtapa: (etapa: Etapa | null) => void;
};

/** Faixa do fluxo: cada cartão é um botão que filtra a lista pela etapa (clicar de novo desfaz). */
export function ResumoPedidos({ totais, ativa, onEtapa }: Props) {
  return (
    <div className="cp-kpis po-kpis" role="group" aria-label="Pedidos por etapa — clique para filtrar">
      {CARTOES.map((cartao) => {
        const total = totais[cartao.etapa];
        const selecionado = ativa === cartao.etapa;
        return (
          <button
            key={cartao.etapa}
            type="button"
            className={`cp-kpi cp-kpi--${cartao.tom}${selecionado ? " cp-kpi--ativo" : ""}${total.quantidade === 0 ? " po-kpi--vazio" : ""}`}
            aria-pressed={selecionado}
            onClick={() => onEtapa(selecionado ? null : cartao.etapa)}
          >
            <span className="cp-kpi-rotulo">{cartao.rotulo}</span>
            <strong className="cp-kpi-valor po-kpi-qtd">{total.quantidade}</strong>
            <span className="cp-kpi-legenda">
              {total.quantidade > 0 ? <Money value={total.valor} /> : cartao.dica}
            </span>
          </button>
        );
      })}
    </div>
  );
}
