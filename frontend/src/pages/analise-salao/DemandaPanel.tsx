import type { AnaliseDemanda } from "../../api/client";
import { Alert, PanelEyebrow } from "../../design-system";
import { AlertaSemVenda } from "./AlertaSemVenda";
import { AvisoHoje } from "./AvisoHoje";
import { dataCurta, inteiro, intervalo, percentual } from "./formato";
import { DiasDaSemana } from "./DiasDaSemana";
import { FolgasDeCapacidade } from "./FolgasDeCapacidade";
import { MapaDeCalor } from "./MapaDeCalor";
import { useFormato } from "./useFormato";
import "./visao.css";

export function DemandaPanel({ dados }: { dados: AnaliseDemanda }) {
  const { reais } = useFormato();
  const { cobertura } = dados;

  if (cobertura.vendas === 0) {
    return (
      <div className="analise-stack">
        <AvisoHoje ativo={dados.hojeFicouDeFora} />
        <AlertaSemVenda dados={dados}>
          Ainda não há venda detalhada neste período. O agente do PDV precisa estar atualizado e o período precisa ser reimportado para o
          histórico aparecer aqui.
        </AlertaSemVenda>
      </div>
    );
  }

  const diasCurtos = cobertura.diasComMovimento < 21;
  const principais = dados.turnos.filter((t) => t.turno !== "OUTRO");

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        <strong>{intervalo(dados.periodo)}</strong> · {cobertura.diasComMovimento} dias com movimento · tudo em <strong>média por dia</strong>,
        não em soma
      </p>
      <AvisoHoje ativo={dados.hojeFicouDeFora} />
      {diasCurtos && (
        <Alert tone="info">
          O período tem poucos dias ({cobertura.diasComMovimento}), então cada dia da semana aparece poucas vezes e a média oscila. Use 30
          dias ou mais para decidir.
        </Alert>
      )}
      {cobertura.vendasSemHora > 0 && (
        <p className="analise-nota">{inteiro(cobertura.vendasSemHora)} comandas sem horário ficam fora do mapa de calor, mas entram nas médias por dia.</p>
      )}

      {principais.length > 0 && (
        <div className="turnos">
          {principais.map((t) => (
            <article key={t.turno} className="turno">
              <span className="turno-nome">{t.rotulo}</span>
              <strong className="turno-participacao">{percentual(t.participacao, 0)}</strong>
              <span className="turno-sub">do faturamento</span>
              <span className="turno-linha">
                {inteiro(t.pessoas)} pessoas · {reais(t.ticketPessoa)} por pessoa
              </span>
            </article>
          ))}
        </div>
      )}

      <section aria-labelledby="mapa-titulo">
        <PanelEyebrow id="mapa-titulo">Quantas pessoas chegam, por dia da semana e hora</PanelEyebrow>
        <MapaDeCalor mapa={dados.mapa} diasDaSemana={dados.diasDaSemana} />
      </section>

      <section aria-labelledby="dias-titulo">
        <PanelEyebrow id="dias-titulo">Dias da semana: almoço e jantar</PanelEyebrow>
        <div className="dia-legenda" aria-hidden>
          <span>
            <i className="dia-amostra dia-amostra-almoco" /> almoço
          </span>
          <span>
            <i className="dia-amostra dia-amostra-jantar" /> jantar
          </span>
        </div>
        <DiasDaSemana dias={dados.diasDaSemana} />
      </section>

      <section aria-labelledby="folga-titulo">
        <PanelEyebrow id="folga-titulo">Onde há capacidade sobrando</PanelEyebrow>
        <FolgasDeCapacidade capacidade={dados.capacidade} />
      </section>

      <p className="analise-nota">
        Horário e turno vêm do PDV. O dia da semana usa a data do movimento ({dataCurta(dados.periodo.inicio)} a {dataCurta(dados.periodo.fim)}).
      </p>
    </div>
  );
}
