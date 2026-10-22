import { CalendarClock, CheckCircle2, Layers, WalletCards } from "lucide-react";
import { KpiCard } from "../../design-system";
import { formatDate } from "../../utils/format";
import type { ResumoDasFaturas } from "./resumo-de-faturas";
import { vencimentoRelativo } from "./resumo-de-faturas";
import "./cards-pagina.css";

function pluralFaturas(qtd: number, adjetivo: string): string {
  if (qtd === 0) return "Nenhuma fatura no período";
  return `${qtd} ${qtd === 1 ? `fatura ${adjetivo}` : `faturas ${adjetivo}s`}`;
}

type Props = {
  resumo: ResumoDasFaturas;
  /** A conta tem cartões (físico/virtual) cadastrados? Sem isso, o tile de classificação não faz sentido. */
  temFinais: boolean;
};

export function ResumoDosCartoes({ resumo, temFinais }: Props) {
  const proximo = resumo.proximoVencimento;
  const prazo = proximo ? vencimentoRelativo(proximo.dueDate, "OPEN") : null;

  return (
    <div className="cartoes-kpis">
      <KpiCard
        label="Em conferência"
        moneyValue={resumo.abertas.valor}
        sub={pluralFaturas(resumo.abertas.qtd, "aberta")}
        tone={resumo.abertas.qtd > 0 ? "warning" : "neutral"}
        icon={<WalletCards size={18} />}
      />
      <KpiCard
        label="Conferidas"
        moneyValue={resumo.conferidas.valor}
        sub={resumo.conferidas.qtd > 0 ? `${pluralFaturas(resumo.conferidas.qtd, "conferida")} — prontas para fechar` : "Nenhuma pronta para fechar"}
        tone={resumo.conferidas.qtd > 0 ? "info" : "neutral"}
        icon={<CheckCircle2 size={18} />}
      />
      <KpiCard
        label="Próximo vencimento"
        value={proximo ? formatDate(proximo.dueDate) : "—"}
        sub={proximo ? `${prazo?.texto ?? ""} · ${proximo.cartao}` : "Nada a pagar no período"}
        tone={!proximo ? "neutral" : proximo.atrasada ? "danger" : "success"}
        icon={<CalendarClock size={18} />}
      />
      {temFinais && (
        <KpiCard
          label="Sem cartão definido"
          value={resumo.semCartao}
          sub={resumo.semCartao > 0 ? "Classifique como físico ou virtual dentro da fatura" : "Tudo classificado"}
          tone={resumo.semCartao > 0 ? "warning" : "success"}
          icon={<Layers size={18} />}
        />
      )}
    </div>
  );
}
