// A lista de pendências do fechamento, agrupada por área.
//
// Cada linha tem o QUE (título, em destaque) e o POR QUÊ (detalhe, apagado), e
// a ação à direita. Antes era uma frase corrida por pendência, todas com o mesmo
// peso: com mais de uma dezena de itens ninguém achava onde agir.

import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { agruparPendencias } from "../../lib/fechamento-apresentacao";
import { destinoDaPendencia } from "../../lib/fechamento-destinos";
import { ehConferencia, type PendenciaClassificada } from "../../lib/fechamento-pendencias";

type Props = {
  pendencias: PendenciaClassificada[];
  /** Sem isto a lista é só informativa (ex.: "aguardando o mês"). */
  acao?: {
    ativa: boolean;
    ocupado: boolean;
    onAgir: (pendencia: PendenciaClassificada) => void;
  };
};

export function PendenciasAgrupadas({ pendencias, acao }: Props) {
  const grupos = agruparPendencias(pendencias);

  return (
    <div className="fpend">
      {grupos.map(({ grupo, itens }) => (
        <section key={grupo} className="fpend-grupo" aria-label={grupo}>
          <h4>
            {grupo}
            <span className="fpend-contagem">{itens.length}</span>
          </h4>
          <ul>
            {itens.map((p) => {
              const destino = destinoDaPendencia(p.key);
              return (
                <li key={p.key}>
                  <div className="fpend-texto">
                    <strong>{p.titulo}</strong>
                    {p.detalhe && <span>{p.detalhe}</span>}
                  </div>
                  <div className="fpend-lado">
                    {destino && (
                      <Link to={destino.rota} className="fpend-destino" aria-label={`${destino.rotulo}: ${p.titulo}`}>
                        <ExternalLink size={13} aria-hidden="true" /> {destino.rotulo}
                      </Link>
                    )}
                    {acao?.ativa && (
                      <button
                        type="button"
                        className={`fpend-acao${ehConferencia(p.key) ? " fpend-acao-conferir" : ""}`}
                        onClick={() => acao.onAgir(p)}
                        disabled={acao.ocupado}
                        aria-label={`${ehConferencia(p.key) ? "Registrar conferência" : "Justificar"}: ${p.titulo}`}
                      >
                        {ehConferencia(p.key) ? "Registrar conferência" : "Justificar"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
