import { ArrowRight } from "lucide-react";
import type { AnaliseInsight } from "../../api/client";
import { useFormato } from "./useFormato";

export type SecaoDaAnalise = "resumo" | "demanda" | "cardapio" | "perdas";

const ROTULO_TOM: Record<AnaliseInsight["tom"], string> = { alerta: "Atenção", oportunidade: "Oportunidade", info: "Para conferir" };
const ROTULO_SECAO: Record<Exclude<SecaoDaAnalise, "resumo">, string> = { demanda: "Quando vendemos", cardapio: "Cardápio", perdas: "Perdas" };

// Um aviso de decisão: o que mudou, a evidência, o que fazer e quanto está em jogo. O impacto é
// sempre rotulado como estimativa; quando depende de suposição, diz que é hipótese. Os textos vêm
// prontos do servidor e podem trazer reais: passam por `mascarar` para respeitar "ocultar valores".
export function InsightCard({ insight, onAbrir }: { insight: AnaliseInsight; onAbrir?: (secao: SecaoDaAnalise) => void }) {
  const { reaisCompacto, mascarar } = useFormato();
  const destino = insight.secao === "resumo" ? null : insight.secao;
  return (
    <li className={`insight insight-${insight.tom}`}>
      <div className="insight-corpo">
        <span className="insight-tom">{ROTULO_TOM[insight.tom]}</span>
        <h3 className="insight-titulo">{mascarar(insight.titulo)}</h3>
        <p className="insight-detalhe">{mascarar(insight.detalhe)}</p>
        <p className="insight-acao">
          <strong>O que fazer: </strong>
          {mascarar(insight.acao)}
        </p>
        {destino && onAbrir && (
          <button type="button" className="insight-link" onClick={() => onAbrir(destino)}>
            Abrir {ROTULO_SECAO[destino]}
            <ArrowRight size={14} aria-hidden />
          </button>
        )}
      </div>
      {insight.impactoMes !== null && (
        <div className="insight-impacto" role="group" aria-label="Impacto estimado por mês">
          <span className="insight-impacto-valor">{reaisCompacto(insight.impactoMes)}</span>
          <span className="insight-impacto-rotulo">por mês</span>
          <span className="insight-impacto-nota">{insight.hipotese ? "hipótese, não previsão" : "estimativa ao ritmo atual"}</span>
        </div>
      )}
    </li>
  );
}
