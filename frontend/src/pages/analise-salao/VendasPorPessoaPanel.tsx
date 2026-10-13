import type { AnaliseVendasPorPessoa } from "../../api/client";
import { Alert, KpiCard, Money, PanelEyebrow, Percent, Table } from "../../design-system";
import { Barra } from "./Barra";
import { pontos } from "./periodo";

const direita = { textAlign: "right" } as const;

export function VendasPorPessoaPanel({ dados }: { dados: AnaliseVendasPorPessoa }) {
  const { resumo } = dados;

  if (dados.pessoas.length === 0) {
    return (
      <Alert tone="info">
        Nenhum item com o funcionário que o lançou neste período.
        {resumo.itensSemPessoa > 0
          ? ` Há ${resumo.itensSemPessoa} itens sem essa informação: o agente do PDV precisa estar atualizado e o período reimportado.`
          : " O agente do PDV precisa estar atualizado e o período reimportado para o histórico aparecer aqui."}
      </Alert>
    );
  }

  const maior = Math.max(0, ...dados.pessoas.map((p) => p.valor));

  return (
    <div className="analise-stack">
      {resumo.itensSemPessoa > 0 && (
        <Alert tone="warning">
          {resumo.itensSemPessoa} itens (<Money value={resumo.valorSemPessoa} />) estão sem o funcionário que lançou e ficam fora desta
          lista, normalmente por serem de antes da atualização do agente.
        </Alert>
      )}

      <div className="analise-kpis">
        <KpiCard label="Funcionários" value={String(resumo.pessoas)} sub="com itens lançados" />
        <KpiCard label="Valor lançado" moneyValue={resumo.valorTotal} sub="itens de vendas recebidas" />
      </div>

      <section>
        <PanelEyebrow>Vendas por funcionário</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Valor lançado</th>
              <th style={direita}>Participação</th>
              <th style={direita}>Vendas</th>
              <th style={direita}>Itens</th>
              <th style={direita}>Ticket médio</th>
              <th style={direita}>Itens por venda</th>
              <th>O que mais vendeu</th>
            </tr>
          </thead>
          <tbody>
            {dados.pessoas.map((p) => (
              <tr key={p.pessoa}>
                <td>{p.pessoa}</td>
                <td className="analise-celula-barra">
                  <Barra razao={maior > 0 ? p.valor / maior : 0} />
                  <Money value={p.valor} />
                </td>
                <td style={direita}><Percent value={pontos(p.participacao)} /></td>
                <td style={direita}>{p.vendas}</td>
                <td style={direita}>{p.itens}</td>
                <td style={direita}><Money value={p.ticketMedio} /></td>
                <td style={direita}>{p.itensPorVenda.toLocaleString("pt-BR")}</td>
                <td>
                  {p.mix.slice(0, 3).map((m) => (
                    <span key={m.grupo} className="analise-chip">
                      {m.grupo} <Percent value={pontos(m.participacao)} decimals={0} />
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="analise-nota">
          O valor é atribuído a quem lançou cada item. Numa mesa em que duas pessoas lançaram, a venda conta para as duas, por isso o
          ticket médio é o valor lançado pela pessoa dividido pelas vendas em que ela lançou algo, e não o ticket da mesa inteira.
        </p>
      </section>
    </div>
  );
}
