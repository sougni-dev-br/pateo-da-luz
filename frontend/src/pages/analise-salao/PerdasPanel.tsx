import type { AnalisePerdas } from "../../api/client";
import { Alert, PanelEyebrow, Table } from "../../design-system";
import { formatDate } from "../../utils/format";
import { AlertaSemVenda } from "./AlertaSemVenda";
import { AvisoHoje } from "./AvisoHoje";
import { Barra } from "./Barra";
import { CancelamentosPanel } from "./CancelamentosPanel";
import { DescontosPanel } from "./DescontosPanel";
import { FunilDePerdas } from "./FunilDePerdas";
import { ItensCanceladosPanel } from "./ItensCanceladosPanel";
import { inteiro, intervalo, percentual } from "./formato";
import { useFormato } from "./useFormato";
import "./visao.css";

const direita = { textAlign: "right" } as const;

export function PerdasPanel({ dados }: { dados: AnalisePerdas }) {
  const { reais } = useFormato();
  const { funil, cobertura } = dados;

  if (cobertura.vendasComDetalhe === 0) {
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

  const maiorPerda = Math.max(0, ...dados.porPessoa.map((p) => p.perda));
  const semMotivo = dados.cancelamentos.resumo.canceladas > 0 && dados.cancelamentos.resumo.semMotivo === dados.cancelamentos.resumo.canceladas;
  const grandesOcultas = funil.grandesVendas > dados.grandes.length;

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        <strong>{intervalo(dados.periodo)}</strong> · perda potencial estimada em <strong>{reais(funil.perdaTotal)}</strong> ({percentual(funil.perdaPct)} do
        faturamento), até <strong>{reais(funil.perdaTeto)}</strong> se nenhuma refação for real. É uma <strong>estimativa</strong>: nem todo cancelamento ou
        desconto é dinheiro que deixou de entrar.
      </p>
      <AvisoHoje ativo={dados.hojeFicouDeFora} />
      {semMotivo && (
        <Alert tone="warning">
          Nenhum dos {inteiro(dados.cancelamentos.resumo.canceladas)} cancelamentos tem motivo registrado no PDV. Peça à equipe para informar o
          motivo ao cancelar: sem ele a análise mostra quem e quanto, mas não por quê.
        </Alert>
      )}

      <section aria-labelledby="funil-titulo">
        <PanelEyebrow as="h2" id="funil-titulo">Do cancelado à perda potencial</PanelEyebrow>
        <FunilDePerdas funil={funil} refacao={dados.refacao} />
      </section>

      {dados.grandes.length > 0 && (
        <section aria-labelledby="grandes-titulo">
          <PanelEyebrow as="h2" id="grandes-titulo">Cancelamentos de valor muito alto (a partir de {reais(dados.limiteGrande)})</PanelEyebrow>
          <p className="analise-nota">
            Valores assim costumam ser pacote ou evento, não mesa. Confira se tinham comanda própria ou se foi lançamento errado.
            {grandesOcultas && ` Mostrando as ${inteiro(dados.grandes.length)} maiores de ${inteiro(funil.grandesVendas)}.`}
          </p>
          <Table>
            <caption className="sr-only">Cancelamentos de valor muito alto</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Turno</th>
                <th scope="col" style={direita}>
                  Pessoas
                </th>
                <th scope="col" style={direita}>
                  Valor
                </th>
                <th scope="col">Quem cancelou</th>
                <th scope="col">Motivo</th>
                <th scope="col">Refeita?</th>
              </tr>
            </thead>
            <tbody>
              {dados.grandes.map((g) => (
                <tr key={g.saleId}>
                  <td>
                    {formatDate(g.data)}
                    {g.hora ? ` ${g.hora}` : ""}
                  </td>
                  <td>{g.turno}</td>
                  <td style={direita}>{inteiro(g.pessoas)}</td>
                  <td style={direita}>{reais(g.valor)}</td>
                  <td>{g.pessoa}</td>
                  <td>{g.motivo ?? "—"}</td>
                  <td>{g.refeita ? "Provável" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <section aria-labelledby="pessoas-titulo">
        <PanelEyebrow as="h2" id="pessoas-titulo">Quem concentra a perda potencial</PanelEyebrow>
        <p className="analise-nota">
          Soma cancelamentos de venda (já sem a provável refação), itens cancelados e descontos de cada pessoa. O desconto é atribuído a quem o PDV
          registra no campo de quem cancelou (a confirmar com a equipe). Quem tem mais vendas tende a ter mais ocorrências: olhe o conjunto, não só
          o total.
        </p>
        <Table>
          <caption className="sr-only">Perda potencial por funcionário</caption>
          <thead>
            <tr>
              <th scope="col">Funcionário</th>
              <th scope="col" style={direita}>
                Cancelamentos
              </th>
              <th scope="col" style={direita}>
                Itens cancelados
              </th>
              <th scope="col" style={direita}>
                Descontos
              </th>
              <th scope="col" style={direita}>
                Perda potencial
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.porPessoa.map((p) => (
              <tr key={p.pessoa}>
                <td>{p.pessoa}</td>
                <td style={direita}>
                  {inteiro(p.canceladas)} · {reais(p.valorCancelado - p.valorRefeito)}
                </td>
                <td style={direita}>
                  {inteiro(p.itens)} · {reais(p.valorItens)}
                </td>
                <td style={direita}>
                  {inteiro(p.descontos)} · {reais(p.valorDescontos)}
                </td>
                <td style={direita}>
                  <span className="analise-celula-barra">
                    {reais(p.perda)}
                    <Barra razao={maiorPerda > 0 ? p.perda / maiorPerda : 0} tom="perigo" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="detalhe-titulo">
        <PanelEyebrow as="h2" id="detalhe-titulo">Detalhe</PanelEyebrow>
        <details className="detalhe">
          <summary>Cancelamentos de venda: por turno, hora e maiores</summary>
          <CancelamentosPanel dados={dados.cancelamentos} />
        </details>
        <details className="detalhe">
          <summary>Itens cancelados em vendas pagas: produtos, horas e quem lançou</summary>
          <ItensCanceladosPanel dados={dados.itens} />
        </details>
        <details className="detalhe">
          <summary>Descontos: tipos, pessoas e maiores</summary>
          <DescontosPanel dados={dados.descontos} />
        </details>
      </section>
    </div>
  );
}
