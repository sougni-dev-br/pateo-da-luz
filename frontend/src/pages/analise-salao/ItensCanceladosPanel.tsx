import type { AnaliseItensCancelados } from "../../api/client";
import { Alert, KpiCard, Money, PanelEyebrow, Percent, Table } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Barra } from "./Barra";
import { pontos } from "./periodo";

const rotuloHora = (hora: string) => (hora === "—" ? "Sem hora" : `${hora}h`);
const direita = { textAlign: "right" } as const;

type Linha = { pessoa: string; itens: number; vendas: number; valor: number; participacao: number };

function TabelaPessoas({ titulo, coluna, linhas }: { titulo: string; coluna: string; linhas: Linha[] }) {
  const maior = Math.max(0, ...linhas.map((l) => l.valor));
  return (
    <section>
      <PanelEyebrow>{titulo}</PanelEyebrow>
      <Table>
        <thead>
          <tr>
            <th>{coluna}</th>
            <th style={direita}>Itens</th>
            <th style={direita}>Vendas</th>
            <th>Valor</th>
            <th style={direita}>Participação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.pessoa}>
              <td>{l.pessoa}</td>
              <td style={direita}>{l.itens}</td>
              <td style={direita}>{l.vendas}</td>
              <td className="analise-celula-barra">
                <Barra razao={maior > 0 ? l.valor / maior : 0} tom="perigo" />
                <Money value={l.valor} />
              </td>
              <td style={direita}><Percent value={pontos(l.participacao)} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

export function ItensCanceladosPanel({ dados }: { dados: AnaliseItensCancelados }) {
  const { resumo, cobertura } = dados;

  if (cobertura.itensCancelados === 0) {
    return (
      <Alert tone="info">
        Nenhum item cancelado em vendas pagas neste período. Se o período é antigo, o agente do PDV precisa estar atualizado e
        o período reimportado para o histórico aparecer aqui.
      </Alert>
    );
  }

  const semQuem = resumo.semQuemCancelou === resumo.itens;
  const algunsSemQuem = !semQuem && resumo.semQuemCancelou > 0;
  const maiorHora = Math.max(0, ...dados.porHora.map((h) => h.itens));

  return (
    <div className="analise-stack">
      <Alert tone="info">
        Aqui entram só os itens cancelados em vendas que foram pagas. A venda inteira cancelada fica na aba Cancelamentos.
        O valor de um item cancelado não é, necessariamente, dinheiro perdido: muitas vezes o item é lançado de novo
        corrigido.
      </Alert>
      {semQuem && (
        <Alert tone="warning">
          Ainda não temos quem cancelou cada item neste período: a informação só chega depois da atualização do agente do PDV e
          da reimportação. Por enquanto vale olhar quem lançou.
        </Alert>
      )}
      {algunsSemQuem && (
        <Alert tone="info">
          {resumo.semQuemCancelou} de {resumo.itens} itens ainda estão sem quem cancelou (são de antes da atualização do agente).
        </Alert>
      )}
      {cobertura.itensSemVenda > 0 && (
        <Alert tone="info">
          {cobertura.itensSemVenda} itens cancelados ficaram de fora porque a venda deles não foi importada. Reimportar o período
          resolve.
        </Alert>
      )}
      {resumo.semMotivo === resumo.itens && (
        <Alert tone="info">
          Nenhum item cancelado tem motivo registrado no PDV: a análise mostra quem, o quê e quanto, mas não por quê.
        </Alert>
      )}

      <div className="analise-kpis">
        <KpiCard label="Itens cancelados" value={String(resumo.itens)} sub={`em ${resumo.vendasAfetadas} vendas pagas`} />
        <KpiCard label="Valor dos itens" moneyValue={resumo.valorCancelado} sub="soma do valor dos itens cancelados" tone="danger" />
        <KpiCard
          label="Sobre o que foi vendido"
          value={<Percent value={pontos(resumo.taxaValor)} />}
          sub="valor cancelado ÷ (cancelado + itens mantidos)"
          tone={resumo.taxaValor > 0.05 ? "warning" : "neutral"}
        />
        {resumo.comOsDoisNomes > 0 && (
          <KpiCard
            label="Quem lançou também cancelou"
            value={`${resumo.mesmaPessoa} de ${resumo.comOsDoisNomes}`}
            sub="itens em que quem lançou corrigiu o próprio lançamento"
          />
        )}
      </div>

      <TabelaPessoas titulo="Quem lançou os itens cancelados" coluna="Funcionário" linhas={dados.porQuemLancou} />
      {!semQuem && <TabelaPessoas titulo="Quem cancelou" coluna="Funcionário" linhas={dados.porQuemCancelou} />}

      <section>
        <PanelEyebrow>Produtos mais cancelados</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Grupo</th>
              <th style={direita}>Lançamentos</th>
              <th style={direita}>Quantidade</th>
              <th style={direita}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {dados.porProduto.map((p) => (
              <tr key={p.produto}>
                <td>{p.produto}</td>
                <td>{p.grupo}</td>
                <td style={direita}>{p.linhas}</td>
                <td style={direita}>{p.quantidade.toLocaleString("pt-BR")}</td>
                <td style={direita}><Money value={p.valor} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <PanelEyebrow>Por hora do dia</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Hora</th>
              <th style={direita}>Itens</th>
              <th style={direita}>Valor</th>
              <th>Itens cancelados</th>
            </tr>
          </thead>
          <tbody>
            {dados.porHora.map((h) => (
              <tr key={h.hora}>
                <td>{rotuloHora(h.hora)}</td>
                <td style={direita}>{h.itens}</td>
                <td style={direita}><Money value={h.valor} /></td>
                <td className="analise-celula-barra">
                  <Barra razao={maiorHora > 0 ? h.itens / maiorHora : 0} tom="perigo" />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <PanelEyebrow>Maiores itens cancelados</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Hora</th>
              <th>Produto</th>
              <th style={direita}>Qtd.</th>
              <th style={direita}>Valor</th>
              <th>Lançou</th>
              <th>Cancelou</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {dados.maiores.map((m, i) => (
              <tr key={`${m.saleId}-${i}`}>
                <td>{formatDate(m.data)}</td>
                <td>{m.hora ?? "—"}</td>
                <td>{m.produto}</td>
                <td style={direita}>{m.quantidade.toLocaleString("pt-BR")}</td>
                <td style={direita}><Money value={m.valor} /></td>
                <td>{m.quemLancou}</td>
                <td>{m.quemCancelou}</td>
                <td>{m.motivo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
