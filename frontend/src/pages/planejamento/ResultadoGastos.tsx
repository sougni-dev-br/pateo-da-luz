import type { ReactNode } from "react";
import type { PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { Alert, Table } from "../../design-system";
import { Reais } from "./Reais";
import { NOMES_DOS_MESES_CURTOS, ROTULO_DO_GRUPO } from "./formato";
import { Quadro } from "./Quadro";

// Do resultado das vendas ao lucro: margem bruta − gastos (com o serviço abatendo a folha). O ponto de equilíbrio
// é a venda do mês em que o lucro zera, com o CMV e os percentuais daquele mês.

const dinheiro = (n: number | null, casas = 0): ReactNode => (n === null ? "—" : <Reais valor={n} casas={casas} moeda={false} />);
const inteiro = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR"));
const classeDoLucro = (n: number | null) => (n === null || n === 0 ? undefined : n > 0 ? "plan-var-sobe" : "plan-var-desce");

type Props = { projecao: PlanejamentoProjecao; resultado: PlanejamentoResultado };

function ComposicaoDosGastos({ resultado }: { resultado: PlanejamentoResultado }) {
  const { total } = resultado;
  const grupos = Object.entries(total.gastosPorGrupo)
    .map(([g, v]) => ({ grupo: g, valor: v ?? 0 }))
    .filter((g) => g.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const maior = grupos[0]?.valor ?? 0;
  if (grupos.length === 0) return null;
  return (
    <div className="plan-composicao">
      <p className="plan-composicao-total">
        <span>Gastos no período</span>
        <strong><Reais valor={total.gastosTotal} /></strong>
        {total.abatimentoDoServico > 0 && <span className="plan-composicao-nota">já abatidos <Reais valor={total.abatimentoDoServico} /> de serviço</span>}
      </p>
      <ul className="plan-composicao-lista" aria-label="Gastos por grupo no período">
        {grupos.map(({ grupo, valor }) => (
          <li key={grupo} className="plan-composicao-item">
            <span className="plan-composicao-rotulo">{ROTULO_DO_GRUPO[grupo] ?? grupo}</span>
            <span className="plan-composicao-trilho" aria-hidden><span className="plan-composicao-barra" style={{ width: `${maior > 0 ? (valor / maior) * 100 : 0}%` }} /></span>
            <span className="plan-composicao-valor"><Reais valor={valor} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultadoGastos({ projecao, resultado }: Props) {
  const semCmv = projecao.meses.some((m) => m.projetado && m.cmvPercentual === null);

  return (
    <>
      {semCmv && <Alert tone="info">Há meses sem CMV definido: sem ele não há margem, então o lucro e o ponto de equilíbrio desses meses ficam em branco.</Alert>}

      <ComposicaoDosGastos resultado={resultado} />

      <Quadro rotulo="Lucro do cenário mês a mês" className="plan-quadro-medio plan-quadro-cabe-no-celular">
        <Table aria-label="Lucro do cenário mês a mês">
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Mês</Table.Th>
              <Table.Th scope="col" align="right">Margem bruta</Table.Th>
              <Table.Th scope="col" align="right">Gastos</Table.Th>
              <Table.Th scope="col" align="right">Lucro<span className="plan-so-largo"> líquido</span></Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo" title="Vendas do mês em que o lucro zera">Equilíbrio (vendas)</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo" title="Clientes necessários no mês, ao ticket projetado">Equilíbrio (clientes)</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {resultado.meses.map((r, i) => {
              const nome = NOMES_DOS_MESES_CURTOS[i];
              const mesProjetado = projecao.meses[i];
              if (!r) {
                return (
                  <Table.Row key={nome} className="plan-linha-sem-base">
                    <Table.Th scope="row">{nome}</Table.Th>
                    <Table.Td colSpan={5}>Sem projeção</Table.Td>
                  </Table.Row>
                );
              }
              return (
                <Table.Row key={nome}>
                  <Table.Th scope="row">{nome}</Table.Th>
                  <Table.Td align="right">{dinheiro(mesProjetado?.margemBruta ?? null)}</Table.Td>
                  <Table.Td align="right">{dinheiro(r.gastosTotal)}</Table.Td>
                  <Table.Td align="right" className={`plan-col-destaque ${classeDoLucro(r.lucro) ?? ""}`}>{dinheiro(r.lucro)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo">{dinheiro(r.equilibrioVendas)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo">{inteiro(r.equilibrioClientes)}</Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
          <tfoot>
            <Table.Row className="plan-linha-total">
              <Table.Th scope="row">Total</Table.Th>
              <Table.Td align="right">{dinheiro(projecao.total.margemBruta)}</Table.Td>
              <Table.Td align="right">{dinheiro(resultado.total.gastosTotal)}</Table.Td>
              <Table.Td align="right" className={`plan-col-destaque ${classeDoLucro(resultado.total.lucro) ?? ""}`}>{dinheiro(resultado.total.lucro)}</Table.Td>
              <Table.Td className="plan-so-largo" />
              <Table.Td className="plan-so-largo" />
            </Table.Row>
          </tfoot>
        </Table>
      </Quadro>
      <p className="plan-sub">Valores em R$. Equilíbrio em branco: o CMV do mês não foi definido ou, junto com os gastos em % das vendas, já consome toda a venda.</p>
    </>
  );
}
