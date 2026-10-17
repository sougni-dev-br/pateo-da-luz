import { dataBr } from "./feriasFormato";
import type { FolhaEmpresa, LinhaContabilidade, LinhaConversa, ModoImpressao } from "./impressao";

type Props =
  | { modo: "CONVERSA"; folhas: Array<FolhaEmpresa<LinhaConversa>>; emissao: string }
  | { modo: "CONTABILIDADE"; folhas: Array<FolhaEmpresa<LinhaContabilidade>>; emissao: string };

const TITULO: Record<ModoImpressao, { titulo: string; subtitulo: string }> = {
  CONVERSA: { titulo: "Programação de férias", subtitulo: "Para conversar com cada pessoa" },
  CONTABILIDADE: { titulo: "Férias programadas", subtitulo: "Para a contabilidade lançar" },
};

/** Uma folha por empresa (A4 deitado). A quebra de página entre empresas é do CSS de impressão. */
export function FolhaFerias(props: Props) {
  const { modo, emissao } = props;
  return (
    <div className="fe-folhas">
      {props.folhas.map((folha) => (
        <section key={folha.empresa} className="fe-folha" aria-label={`${TITULO[modo].titulo} — ${folha.empresa}`}>
          <header className="fe-folha-topo">
            <div>
              <h2>{TITULO[modo].titulo} · {folha.empresa}</h2>
              <p>{TITULO[modo].subtitulo} · emitido em {dataBr(emissao)}</p>
            </div>
            <p className="fe-folha-total">{folha.linhas.length} {folha.linhas.length === 1 ? "período" : "períodos"}</p>
          </header>
          {props.modo === "CONVERSA"
            ? <TabelaConversa linhas={(folha as FolhaEmpresa<LinhaConversa>).linhas} />
            : <TabelaContabilidade linhas={(folha as FolhaEmpresa<LinhaContabilidade>).linhas} />}
        </section>
      ))}
    </div>
  );
}

function TabelaConversa({ linhas }: { linhas: LinhaConversa[] }) {
  return (
    <>
      <p className="fe-folha-legenda">
        <strong>Começar até</strong> é o último dia para as férias começarem sem vencer (depois disso são pagas em dobro).
        Anote a data combinada, o número de dias e se a pessoa vai vender o abono (10 dias), e peça o ciente.
      </p>
      <table className="fe-folha-tabela">
        <thead>
          <tr>
            <th className="c-nome">Funcionário</th>
            <th className="c-periodo">Período aquisitivo</th>
            <th className="c-limite">Começar até</th>
            <th className="c-dias">Dias a<br />programar</th>
            <th className="c-combinado">Data combinada</th>
            <th className="c-visto">Ciente</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave}>
              <td className="c-nome">
                <strong>{l.nome}</strong>
                {l.admissao && <small>Admissão {dataBr(l.admissao)}</small>}
                {l.jaProgramado && <small>Já combinado: {l.jaProgramado}</small>}
              </td>
              <td className="c-periodo">{l.periodo}</td>
              <td className="c-limite">
                <strong>{l.limite}</strong>
                <small className={l.urgente ? "fe-folha-urgente" : undefined}>{l.prazo}</small>
              </td>
              <td className="c-dias">{l.diasAProgramar}</td>
              <td className="c-combinado">
                <div className="fe-combinado">
                  <span className="fe-campo">Início <i className="fe-risco fe-risco--data" /></span>
                  <span className="fe-campo">Dias <i className="fe-risco fe-risco--curto" /></span>
                  <span className="fe-campo"><i className="fe-caixa" /> Vender abono</span>
                </div>
              </td>
              <td className="c-visto" />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fe-folha-obs">
        <span>Observações</span>
        <i /><i />
      </div>
      <p className="fe-folha-rodape">
        Conversa feita por <i className="fe-risco fe-risco--longo" /> em <i className="fe-risco fe-risco--data" />
      </p>
    </>
  );
}

function TabelaContabilidade({ linhas }: { linhas: LinhaContabilidade[] }) {
  return (
    <table className="fe-folha-tabela fe-folha-tabela--contab">
      <thead>
        <tr>
          <th className="c-nome">Funcionário</th>
          <th className="c-periodo">Período aquisitivo</th>
          <th className="c-data">Início</th>
          <th className="c-data">Último dia</th>
          <th className="c-data">Volta em</th>
          <th className="c-dias">Dias</th>
          <th className="c-dias">Abono</th>
          <th className="c-data">Avisar até</th>
          <th className="c-data">Pagar até</th>
          <th className="c-obs">Observação</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.chave}>
            <td className="c-nome"><strong>{l.nome}</strong></td>
            <td className="c-periodo">{l.periodo}</td>
            <td className="c-data"><strong>{l.inicio}</strong></td>
            <td className="c-data">{l.fim}</td>
            <td className="c-data">{l.retorno}</td>
            <td className="c-dias">{l.dias}</td>
            <td className="c-dias">{l.abono > 0 ? `${l.abono} dias` : "—"}</td>
            <td className="c-data">{l.avisarAte}</td>
            <td className="c-data">{l.pagarAte}</td>
            <td className="c-obs">{l.observacao}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
