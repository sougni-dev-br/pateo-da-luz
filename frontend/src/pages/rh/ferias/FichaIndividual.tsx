import { dataBr } from "./feriasFormato";
import type { FichaIndividual as Ficha } from "./impressao";

/** A ficha de férias de uma pessoa (A4 em pé): períodos, datas combinadas e um espaço para o ciente. */
export function FichaIndividual({ ficha, emissao }: { ficha: Ficha; emissao: string }) {
  const detalhe = [ficha.empresa, ficha.setor, ficha.admissao ? `Admissão ${dataBr(ficha.admissao)}` : null].filter(Boolean).join(" · ");
  return (
    <div className="fe-folhas">
      <section className="fe-folha fe-ficha" aria-label={`Férias de ${ficha.nome}`}>
        <header className="fe-folha-topo">
          <div>
            <h2>Férias · {ficha.nome}</h2>
            <p>{detalhe}</p>
          </div>
          <p className="fe-folha-total">emitido em {dataBr(emissao)}</p>
        </header>

        <p className="fe-folha-legenda">
          <strong>Começar até</strong> é o último dia para as férias começarem sem vencer (depois disso são pagas em dobro).
          O aviso à pessoa é por escrito, com 30 dias de antecedência, e o pagamento sai até 2 dias antes do início.
        </p>

        {ficha.periodos.length === 0 ? <p className="fe-folha-legenda">Nenhum período de férias em aberto.</p> : ficha.periodos.map((p) => (
          <article key={p.chave} className="fe-ficha-periodo">
            <h3>Período aquisitivo {p.periodo} <span>{p.situacao}</span></h3>
            <dl className="fe-ficha-resumo">
              <div><dt>Pode sair desde</dt><dd>{p.podeSair}</dd></div>
              <div><dt>Começar até</dt><dd>{p.limite}{p.prazo ? <small> · {p.prazo}</small> : null}</dd></div>
              {p.pedido && <div><dt>Pedido do colaborador</dt><dd>{p.pedido}</dd></div>}
            </dl>
            {p.partes.length === 0 ? <p className="fe-ficha-vazio">Sem data combinada.</p> : (
              <table className="fe-folha-tabela fe-ficha-tabela">
                <thead>
                  <tr><th>Início</th><th>Último dia</th><th>Volta em</th><th>Dias</th><th>Abono</th><th>Avisar até</th><th>Pagar até</th></tr>
                </thead>
                <tbody>
                  {p.partes.map((g) => (
                    <tr key={g.chave}>
                      <td><strong>{g.inicio}</strong>{g.gozou ? <small>já gozou</small> : null}</td>
                      <td>{g.ultimoDia}</td><td>{g.volta}</td><td>{g.dias}</td><td>{g.abono > 0 ? g.abono : "—"}</td><td>{g.avisarAte}</td><td>{g.pagarAte}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {p.observacao && <p className="fe-ficha-obs">{p.observacao}</p>}
          </article>
        ))}

        <footer className="fe-ficha-ciente">
          <p>Ciente das datas acima:</p>
          <div className="fe-ficha-linhas">
            <span><i /> Assinatura de {ficha.nome}</span>
            <span><i /> Data</span>
          </div>
        </footer>
      </section>
    </div>
  );
}
