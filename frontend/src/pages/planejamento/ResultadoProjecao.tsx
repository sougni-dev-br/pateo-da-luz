import type { ReactNode } from "react";
import type { PlanejamentoProjecao } from "../../api/client";
import { KpiCard, Money, Table } from "../../design-system";
import type { KpiDelta } from "../../design-system";
import { leituraDaVariacao, MOTIVO_SEM_BASE, NOMES_DOS_MESES_CURTOS, descricaoDoPeriodo, textoDaVariacao } from "./formato";

// Resultado do cenário: totais do ano (só dos meses que têm base) e o mês a mês com vendas por turno,
// CMV e margem bruta. Mês sem base aparece com o motivo, nunca zerado.

const inteiro = (n: number) => Math.round(n).toLocaleString("pt-BR");
const dinheiro = (n: number | null, casas = 0): ReactNode => (n === null ? "—" : <Money value={n} decimals={casas} />);

function deltaDe(variacao: number | null): KpiDelta | null {
  const leitura = leituraDaVariacao(variacao);
  if (!leitura) return null;
  return { text: textoDaVariacao(variacao), direction: leitura === "Aumento" ? "up" : leitura === "Redução" ? "down" : "flat" };
}

export function ResultadoProjecao({ projecao, ano, anoBase }: { projecao: PlanejamentoProjecao; ano: number; anoBase: number }) {
  const { total, meses } = projecao;
  const periodo = descricaoDoPeriodo(total.meses);
  const semBase = meses.filter((m) => m.motivoSemBase);

  if (total.meses.length === 0) return null;

  return (
    <>
      <div className="plan-kpis plan-kpis-4">
        <KpiCard label={`Vendas ${ano}`} value={dinheiro(total.projetado.vendas.total)} delta={deltaDe(total.variacaoVendas)} sub={<>{anoBase}: {dinheiro(total.base.vendas.total)}</>} />
        <KpiCard label={`Clientes ${ano}`} value={inteiro(total.projetado.clientes.total)} delta={deltaDe(total.variacaoClientes)} sub={`${anoBase}: ${inteiro(total.base.clientes.total)}`} />
        <KpiCard label={`Ticket médio ${ano}`} value={dinheiro(total.projetado.ticket.total, 2)} delta={deltaDe(total.variacaoTicket)} sub={<>{anoBase}: {dinheiro(total.base.ticket.total, 2)}</>} />
        <KpiCard
          label="Margem bruta"
          value={dinheiro(total.margemBruta)}
          sub={total.margemBruta === null ? "Defina o CMV de todos os meses com base" : `CMV de ${((total.cmvPercentual ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das vendas`}
        />
      </div>
      <p className="plan-sub">Totais de {periodo || "—"}: só entram os meses com base real em {anoBase}.{semBase.length > 0 ? ` Sem projeção: ${semBase.map((m) => `${NOMES_DOS_MESES_CURTOS[m.mes - 1]} (${MOTIVO_SEM_BASE[m.motivoSemBase ?? "SEM_DADO"]})`).join(", ")}.` : ""}</p>

      <div className="plan-quadro">
        <Table aria-label={`Projeção de ${ano} mês a mês`}>
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Mês</Table.Th>
              <Table.Th align="right">Clientes</Table.Th>
              <Table.Th align="right">Vendas almoço</Table.Th>
              <Table.Th align="right">Vendas jantar</Table.Th>
              <Table.Th align="right">Vendas {ano}</Table.Th>
              <Table.Th align="right">Vendas {anoBase}</Table.Th>
              <Table.Th align="right">Variação</Table.Th>
              <Table.Th align="right">Ticket médio</Table.Th>
              <Table.Th align="right">CMV</Table.Th>
              <Table.Th align="right">Margem bruta</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {meses.map((m) => {
              const nome = NOMES_DOS_MESES_CURTOS[m.mes - 1];
              if (!m.projetado || !m.base) {
                return (
                  <Table.Row key={m.mes} className="plan-linha-sem-base">
                    <Table.Th scope="row">{nome}</Table.Th>
                    <Table.Td colSpan={9}>Sem projeção: {MOTIVO_SEM_BASE[m.motivoSemBase ?? "SEM_DADO"]}</Table.Td>
                  </Table.Row>
                );
              }
              const variacao = m.base.vendas.total > 0 ? m.projetado.vendas.total / m.base.vendas.total - 1 : null;
              return (
                <Table.Row key={m.mes}>
                  <Table.Th scope="row">{nome}</Table.Th>
                  <Table.Td align="right">{inteiro(m.projetado.clientes.total)}</Table.Td>
                  <Table.Td align="right">{dinheiro(m.projetado.vendas.almoco)}</Table.Td>
                  <Table.Td align="right">{dinheiro(m.projetado.vendas.jantar)}</Table.Td>
                  <Table.Td align="right" className="plan-col-destaque">{dinheiro(m.projetado.vendas.total)}</Table.Td>
                  <Table.Td align="right">{dinheiro(m.base.vendas.total)}</Table.Td>
                  <Table.Td align="right">{textoDaVariacao(variacao)}</Table.Td>
                  <Table.Td align="right">{dinheiro(m.projetado.ticket.total, 2)}</Table.Td>
                  <Table.Td align="right">{m.cmvPercentual === null ? "—" : `${(m.cmvPercentual * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</Table.Td>
                  <Table.Td align="right">{dinheiro(m.margemBruta)}</Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>
    </>
  );
}
