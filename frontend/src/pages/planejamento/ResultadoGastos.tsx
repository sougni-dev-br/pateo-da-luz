import type { ReactNode } from "react";
import type { PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { Alert, KpiCard, Money, Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, ROTULO_DO_GRUPO } from "./formato";

// Do resultado das vendas ao lucro: margem bruta − gastos (com o serviço abatendo a folha). O ponto de equilíbrio
// é a venda do mês em que o lucro zera, com o CMV e os percentuais daquele mês.

const dinheiro = (n: number | null, casas = 0): ReactNode => (n === null ? "—" : <Money value={n} decimals={casas} />);
const inteiro = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR"));
const classeDoLucro = (n: number | null) => (n === null || n === 0 ? undefined : n > 0 ? "plan-var-sobe" : "plan-var-desce");

type Props = { projecao: PlanejamentoProjecao; resultado: PlanejamentoResultado };

export function ResultadoGastos({ projecao, resultado }: Props) {
  const { total } = resultado;
  const grupos = Object.entries(total.gastosPorGrupo).filter(([, v]) => (v ?? 0) !== 0);
  const semCmv = projecao.meses.some((m) => m.projetado && m.cmvPercentual === null);

  return (
    <>
      {semCmv && <Alert tone="info">Há meses sem CMV definido: sem ele não há margem, então o lucro e o ponto de equilíbrio desses meses ficam em branco.</Alert>}

      <div className="plan-kpis plan-kpis-4">
        <KpiCard label="Lucro líquido do ano" value={dinheiro(total.lucro)} tone={total.lucro === null ? "neutral" : total.lucro >= 0 ? "success" : "danger"} sub={total.lucro === null ? "Defina o CMV de todos os meses com base" : "Margem bruta − gastos"} />
        <KpiCard label="Gastos do ano" value={dinheiro(total.gastosTotal)} sub={total.abatimentoDoServico > 0 ? <>Já abatidos {dinheiro(total.abatimentoDoServico)} de serviço</> : undefined} />
      </div>

      {grupos.length > 0 && (
        <p className="plan-sub">
          Gastos por grupo no ano: {grupos.map(([g, v]) => `${ROTULO_DO_GRUPO[g] ?? g} ${Math.round(v ?? 0).toLocaleString("pt-BR")}`).join(" · ")}.
        </p>
      )}

      <p className="plan-sub">Equilíbrio em branco: o CMV do mês não foi definido ou, junto com os gastos em % das vendas, já consome toda a venda.</p>
      <div className="plan-quadro">
        <Table aria-label="Lucro do cenário mês a mês">
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Mês</Table.Th>
              <Table.Th align="right">Margem bruta</Table.Th>
              <Table.Th align="right">Gastos</Table.Th>
              <Table.Th align="right">Lucro líquido</Table.Th>
              <Table.Th align="right" title="Vendas do mês em que o lucro zera">Equilíbrio (vendas)</Table.Th>
              <Table.Th align="right" title="Clientes necessários no mês, ao ticket projetado">Equilíbrio (clientes)</Table.Th>
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
                  <Table.Td align="right">{dinheiro(r.equilibrioVendas)}</Table.Td>
                  <Table.Td align="right">{inteiro(r.equilibrioClientes)}</Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>
    </>
  );
}
