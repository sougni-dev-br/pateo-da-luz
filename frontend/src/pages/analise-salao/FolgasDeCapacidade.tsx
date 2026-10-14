import type { AnaliseDemanda } from "../../api/client";
import { decimal1, inteiro, percentual } from "./formato";
import { useFormato } from "./useFormato";

// Dias abaixo da meta em relação ao MELHOR dia do mesmo turno. É uma hipótese de trabalho: a tela
// diz isso, mostra a conta e nunca a apresenta como previsão.
export function FolgasDeCapacidade({ capacidade }: { capacidade: AnaliseDemanda["capacidade"] }) {
  const { reaisCompacto } = useFormato();
  const turnos = capacidade.turnos.filter((t) => t.referencia);

  if (turnos.length === 0) {
    return <p className="analise-nota">Ainda não há dias suficientes (pelo menos 3 de cada dia da semana) para comparar a capacidade.</p>;
  }

  return (
    <div className="folgas">
      <p className="analise-nota">
        Compara cada dia com o melhor dia do mesmo turno. A meta é {percentual(capacidade.metaRelativa, 0)} desse melhor dia: um alvo
        realista para um dia fraco, <strong>não uma previsão</strong>. O valor mensal é a diferença de pessoas × o ticket do próprio dia × 4,3
        semanas.
      </p>
      {turnos.map((t) => (
        <section key={t.turno} className="folga-turno" aria-label={`Capacidade no ${t.rotulo.toLowerCase()}`}>
          <h3 className="folga-titulo">
            {t.rotulo}
            <span>
              melhor dia: {t.referencia?.rotulo}, {decimal1(t.referencia?.pessoasPorDia ?? 0)} pessoas · meta {decimal1(t.referencia?.meta ?? 0)}
            </span>
          </h3>
          {t.folgas.length === 0 ? (
            <p className="analise-nota">Todos os dias comparáveis já estão acima da meta.</p>
          ) : (
            <ul className="folga-lista">
              {t.folgas.map((f) => (
                <li key={f.dow} className="folga-item">
                  <div>
                    <strong>{f.rotulo}</strong>
                    <span className="folga-detalhe">
                      {decimal1(f.pessoasPorDia)} pessoas por dia, {percentual(f.pctDoMelhor, 0)} do melhor · faltam {inteiro(f.pessoasAMais)} para a meta
                    </span>
                  </div>
                  <div className="folga-valor">
                    <strong>{reaisCompacto(f.faturamentoMesPotencial)}</strong>
                    <span>por mês, se chegasse à meta</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
