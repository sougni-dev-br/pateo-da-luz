import type { AnaliseDescontos } from "../../api/client";
import { Alert, KpiCard, Money, PanelEyebrow, Percent, Table } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Barra } from "./Barra";
import { pontos } from "./periodo";

const direita = { textAlign: "right" } as const;
const LIMITE_TAXA_ALERTA = 0.1;

type Linha = { nome: string; vendas: number; valor: number; participacao: number; percentualMedio: number };

// Barras neutras: o ranking e por volume absoluto e nao deve parecer uma lista de culpados.

function TabelaAgrupada({ titulo, coluna, linhas, nota }: { titulo: string; coluna: string; linhas: Linha[]; nota?: string }) {
  const maior = Math.max(0, ...linhas.map((l) => l.valor));
  return (
    <section>
      <PanelEyebrow>{titulo}</PanelEyebrow>
      <Table>
        <thead>
          <tr>
            <th>{coluna}</th>
            <th style={direita}>Vendas</th>
            <th>Valor</th>
            <th style={direita}>Participação</th>
            <th style={direita}>Desconto médio (% do subtotal)</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.nome}>
              <td>{l.nome}</td>
              <td style={direita}>{l.vendas}</td>
              <td className="analise-celula-barra">
                <Barra razao={maior > 0 ? l.valor / maior : 0} />
                <Money value={l.valor} />
              </td>
              <td style={direita}><Percent value={pontos(l.participacao)} /></td>
              <td style={direita}><Percent value={pontos(l.percentualMedio)} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
      {nota && <p className="analise-nota">{nota}</p>}
    </section>
  );
}

export function DescontosPanel({ dados }: { dados: AnaliseDescontos }) {
  const { resumo, cobertura } = dados;

  if (cobertura.vendasComDado === 0 && cobertura.vendasSemDado === 0) {
    return <Alert tone="info">Nenhuma venda recebida neste período.</Alert>;
  }

  if (cobertura.vendasComDado === 0) {
    return (
      <Alert tone="info">
        Ainda não há dado de desconto neste período. O agente do PDV precisa estar atualizado e o período reimportado para o
        histórico aparecer aqui.
      </Alert>
    );
  }

  const avisoSemDado = cobertura.vendasSemDado > 0;
  const faltas = [
    resumo.semPessoa > 0 ? `${resumo.semPessoa} descontos sem a pessoa que registrou` : null,
    resumo.semTipo > 0 ? `${resumo.semTipo} ${resumo.semPessoa > 0 ? "" : "descontos "}sem o tipo` : null
  ].filter((parte): parte is string => parte !== null);

  return (
    <div className="analise-stack">
      {avisoSemDado && (
        <Alert tone="info">
          {cobertura.vendasSemDado} vendas do período ainda não têm dado de desconto (são de antes da atualização do agente) e
          ficam fora das contas abaixo.
        </Alert>
      )}

      {resumo.vendasComDesconto === 0 ? (
        <Alert tone="info">Nenhuma venda com desconto neste período.</Alert>
      ) : (
        <>
          {resumo.acimaDe50 > 0 && (
            <Alert tone="warning">
              {resumo.acimaDe50} {resumo.acimaDe50 === 1 ? "venda com desconto acima" : "vendas com desconto acima"} de 50% do subtotal.
              Vale conferir {resumo.acimaDe50 === 1 ? "essa" : "uma a uma"} na tabela dos maiores descontos.
            </Alert>
          )}
          {faltas.length > 0 && <Alert tone="info">{faltas.join(" e ")}.</Alert>}
          <Alert tone="info">
            A pessoa mostrada é a do campo de quem cancelou/registrou do PDV, que nas amostras vem preenchido em todas as vendas com
            desconto. Confirme com a equipe do salão que ela é mesmo quem aplicou o desconto antes de usar isso como cobrança.
          </Alert>

          <div className="analise-kpis">
            <KpiCard
              label="Vendas com desconto"
              value={<Percent value={pontos(resumo.taxaVendas)} />}
              sub={`${resumo.vendasComDesconto} de ${resumo.vendasRecebidas} vendas`}
              tone={resumo.taxaVendas > LIMITE_TAXA_ALERTA ? "warning" : "neutral"}
            />
            <KpiCard label="Valor dos descontos" moneyValue={resumo.valorDescontos} sub="somado no período" tone="danger" />
            <KpiCard
              label="Sobre o subtotal dos itens"
              value={<Percent value={pontos(resumo.percentualSobreSubtotal)} />}
              sub="descontos ÷ subtotal das vendas"
            />
            <KpiCard label="Desconto médio" moneyValue={resumo.descontoMedio} sub="por venda com desconto" />
          </div>

          <TabelaAgrupada
            titulo="Descontos por tipo"
            coluna="Tipo"
            linhas={dados.porTipo.map((t) => ({ nome: t.tipo, vendas: t.vendas, valor: t.valor, participacao: t.participacao, percentualMedio: t.percentualMedio }))}
          />
          <TabelaAgrupada
            titulo="Quem registrou"
            coluna="Registrado por (campo do PDV)"
            nota="Volume absoluto: não considera quantas vendas cada pessoa atendeu, então quem atende mais tende a aparecer mais."
            linhas={dados.porPessoa.map((p) => ({ nome: p.pessoa, vendas: p.vendas, valor: p.valor, participacao: p.participacao, percentualMedio: p.percentualMedio }))}
          />

          <section>
            <PanelEyebrow>Por turno</PanelEyebrow>
            <Table>
              <thead>
                <tr>
                  <th>Turno</th>
                  <th style={direita}>Vendas</th>
                  <th style={direita}>Com desconto</th>
                  <th style={direita}>Taxa</th>
                  <th style={direita}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {dados.porTurno.map((t) => (
                  <tr key={t.turno}>
                    <td>{t.turno}</td>
                    <td style={direita}>{t.vendas}</td>
                    <td style={direita}>{t.vendasComDesconto}</td>
                    <td style={direita}><Percent value={pontos(t.taxa)} /></td>
                    <td style={direita}><Money value={t.valor} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>

          <section>
            <PanelEyebrow>Maiores descontos</PanelEyebrow>
            <Table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Hora</th>
                  <th>Turno</th>
                  <th style={direita}>Pessoas</th>
                  <th style={direita}>Subtotal</th>
                  <th style={direita}>Desconto</th>
                  <th style={direita}>% do subtotal</th>
                  <th>Tipo</th>
                  <th>Registrado por</th>
                </tr>
              </thead>
              <tbody>
                {dados.maiores.map((m) => (
                  <tr key={m.saleId}>
                    <td>{formatDate(m.data)}</td>
                    <td>{m.hora ?? "—"}</td>
                    <td>{m.turno}</td>
                    <td style={direita}>{m.pessoas}</td>
                    <td style={direita}><Money value={m.subtotal} /></td>
                    <td style={direita}><Money value={m.desconto} /></td>
                    <td style={direita}><Percent value={pontos(m.percentual)} decimals={0} /></td>
                    <td>{m.tipo}</td>
                    <td>{m.pessoa}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        </>
      )}
    </div>
  );
}
