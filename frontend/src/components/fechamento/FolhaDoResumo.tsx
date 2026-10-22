// A folha impressa do resumo do fechamento (A4, retrato).
//
// Só desenha o que `montarResumoDoFechamento` devolveu. Papel pede texto, não cor:
// a situação de cada área vai escrita ("PENDENTE", "OK") para continuar legível em
// preto e branco e numa fotocópia.

import type { ResumoImprimivel, SituacaoDaArea } from "../../lib/fechamento-resumo";

const ROTULO_DA_SITUACAO: Record<SituacaoDaArea, string> = {
  OK: "✔ OK",
  PENDENTE: "✖ PENDENTE",
  AGUARDANDO: "… AGUARDANDO",
  JUSTIFICADO: "✔ JUSTIFICADO"
};

export function FolhaDoResumo({ resumo }: { resumo: ResumoImprimivel }) {
  return (
    <article className="fres">
      <header className="fres-topo">
        <p className="fres-casa">Pateo da Luz</p>
        <h1>{resumo.titulo}</h1>
        <p className="fres-periodo">
          Período: {resumo.periodo} · <strong>{resumo.situacaoTexto}</strong>
        </p>
      </header>

      <section>
        <h2>Números do mês</h2>
        <dl className="fres-numeros">
          {resumo.numeros.map((n) => (
            <div key={n.rotulo}>
              <dt>{n.rotulo}</dt>
              <dd>{n.valor}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>Situação por área</h2>
        <table className="fres-tabela">
          <thead>
            <tr><th>Área</th><th>Situação</th><th>Observação</th></tr>
          </thead>
          <tbody>
            {resumo.areas.map((a) => (
              <tr key={a.area}>
                <td>{a.area}</td>
                <td className={`fres-sit fres-sit--${a.situacao.toLowerCase()}`}>{ROTULO_DA_SITUACAO[a.situacao]}</td>
                <td>{a.observacao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>
          Pendências em aberto
          <span className="fres-contagem">
            {resumo.totais.pendentes} a resolver · {resumo.totais.aguardando} aguardando o fim do mês
          </span>
        </h2>
        {resumo.pendencias.length === 0 ? (
          <p className="fres-vazio">Nenhuma pendência em aberto.</p>
        ) : (
          resumo.pendencias.map((g) => (
            <div key={g.grupo} className="fres-grupo">
              <h3>{g.grupo}</h3>
              <ul>
                {g.itens.map((i) => (
                  <li key={`${g.grupo}-${i.titulo}`}>
                    <strong>{i.titulo}</strong>
                    {i.aguardando && <span className="fres-etiqueta">aguardando o mês terminar</span>}
                    {i.detalhe && <span className="fres-detalhe"> — {i.detalhe}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>
          Conferências e justificativas registradas
          <span className="fres-contagem">{resumo.totais.registros}</span>
        </h2>
        {resumo.registros.length === 0 ? (
          <p className="fres-vazio">Nenhum registro neste mês.</p>
        ) : (
          <table className="fres-tabela fres-tabela--registros">
            <thead>
              <tr><th>Item</th><th>Tipo</th><th>Registro</th><th>Quem e quando</th></tr>
            </thead>
            <tbody>
              {resumo.registros.map((r, i) => (
                <tr key={`${r.nome}-${i}`}>
                  <td>{r.nome}</td>
                  <td>{r.tipo}</td>
                  <td>{r.texto}</td>
                  <td>{r.por}<br /><small>{r.data}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="fres-assinaturas">
        <div><span /> Responsável pela conferência</div>
        <div><span /> Data</div>
      </section>

      <footer className="fres-rodape">
        Gerado em {resumo.geradoEm} por {resumo.geradoPor}. O documento reflete o estado do sistema nesse momento.
      </footer>
    </article>
  );
}
