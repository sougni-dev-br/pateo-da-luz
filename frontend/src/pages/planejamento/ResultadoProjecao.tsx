import type { ReactNode } from "react";
import type { PlanejamentoProjecao } from "../../api/client";
import { Table } from "../../design-system";
import { Quadro } from "./Quadro";
import { Reais } from "./Reais";
import { leituraDaVariacao, MOTIVO_SEM_BASE, NOMES_DOS_MESES_CURTOS, descricaoDoPeriodo, textoDaVariacao } from "./formato";

// Resultado do cenário: totais do ano (só dos meses que têm base) e o mês a mês com vendas por turno,
// CMV e margem bruta. Mês sem base aparece com o motivo, nunca zerado.

const inteiro = (n: number) => Math.round(n).toLocaleString("pt-BR");
const dinheiro = (n: number | null, casas = 0): ReactNode => (n === null ? "—" : <Reais valor={n} casas={casas} moeda={false} />);

const classeDaVariacao = (v: number | null) => {
  const leitura = leituraDaVariacao(v);
  return leitura === "Aumento" ? "plan-var-sobe" : leitura === "Redução" ? "plan-var-desce" : undefined;
};

function Indicador({ rotulo, valor, variacao, nota }: { rotulo: string; valor: ReactNode; variacao?: number | null; nota?: ReactNode }) {
  return (
    <div className="plan-indicador">
      <dt>{rotulo}</dt>
      <dd>
        <span className="plan-indicador-valor">{valor}</span>
        {variacao !== undefined && <span className={`plan-indicador-var ${classeDaVariacao(variacao) ?? ""}`}>{textoDaVariacao(variacao)}</span>}
        {nota && <span className="plan-indicador-nota">{nota}</span>}
      </dd>
    </div>
  );
}

export function ResultadoProjecao({ projecao, ano, anoBase }: { projecao: PlanejamentoProjecao; ano: number; anoBase: number }) {
  const { total, meses } = projecao;
  const periodo = descricaoDoPeriodo(total.meses);
  const semBase = meses.filter((m) => m.motivoSemBase);

  if (total.meses.length === 0) return null;

  return (
    <>
      <dl className="plan-indicadores-linha" aria-label={`Totais de ${periodo || "—"} contra ${anoBase}`}>
        <Indicador rotulo={`Clientes ${ano}`} valor={inteiro(total.projetado.clientes.total)} variacao={total.variacaoClientes} />
        <Indicador rotulo="Ticket médio" valor={<Reais valor={total.projetado.ticket.total} casas={2} />} variacao={total.variacaoTicket} />
        <Indicador
          rotulo="Margem bruta"
          valor={total.margemBruta === null ? "—" : <Reais valor={total.margemBruta} />}
          nota={total.margemBruta === null ? "defina o CMV de todos os meses" : `CMV de ${((total.cmvPercentual ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
        />
      </dl>
      <p className="plan-sub">Valores em R$. Totais de {periodo || "—"}: só entram os meses com base real em {anoBase}; as vendas do ano estão no veredito.{semBase.length > 0 ? ` Sem projeção: ${semBase.map((m) => `${NOMES_DOS_MESES_CURTOS[m.mes - 1]} (${MOTIVO_SEM_BASE[m.motivoSemBase ?? "SEM_DADO"] ?? "sem base"})`).join(", ")}.` : ""}</p>

      <Quadro rotulo={`Projeção de ${ano} mês a mês`} className="plan-quadro-cabe-no-celular">
        <Table aria-label={`Projeção de ${ano} mês a mês`}>
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Mês</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo">Clientes</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo plan-so-1180">Vendas almoço</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo plan-so-1180">Vendas jantar</Table.Th>
              <Table.Th scope="col" align="right">Vendas {ano}</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo">Vendas {anoBase}</Table.Th>
              <Table.Th scope="col" align="right">Variação</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo plan-so-1180">Ticket médio</Table.Th>
              <Table.Th scope="col" align="right" className="plan-so-largo plan-so-1180">CMV</Table.Th>
              <Table.Th scope="col" align="right">Margem bruta</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {meses.map((m) => {
              const nome = NOMES_DOS_MESES_CURTOS[m.mes - 1];
              if (!m.projetado || !m.base) {
                return (
                  <Table.Row key={m.mes} className="plan-linha-sem-base">
                    <Table.Th scope="row">{nome}</Table.Th>
                    <Table.Td colSpan={9}>Sem projeção: {MOTIVO_SEM_BASE[m.motivoSemBase ?? "SEM_DADO"] ?? "sem base"}</Table.Td>
                  </Table.Row>
                );
              }
              const variacao = m.base.vendas.total > 0 ? m.projetado.vendas.total / m.base.vendas.total - 1 : null;
              return (
                <Table.Row key={m.mes}>
                  <Table.Th scope="row">{nome}</Table.Th>
                  <Table.Td align="right" className="plan-so-largo">{inteiro(m.projetado.clientes.total)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo plan-so-1180">{dinheiro(m.projetado.vendas.almoco)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo plan-so-1180">{dinheiro(m.projetado.vendas.jantar)}</Table.Td>
                  <Table.Td align="right" className="plan-col-destaque">{dinheiro(m.projetado.vendas.total)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo">{dinheiro(m.base.vendas.total)}</Table.Td>
                  <Table.Td align="right" className={classeDaVariacao(variacao)}>{textoDaVariacao(variacao)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo plan-so-1180">{dinheiro(m.projetado.ticket.total, 2)}</Table.Td>
                  <Table.Td align="right" className="plan-so-largo plan-so-1180">{m.cmvPercentual === null ? "—" : `${(m.cmvPercentual * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</Table.Td>
                  <Table.Td align="right">{dinheiro(m.margemBruta)}</Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
          <tfoot>
            <Table.Row className="plan-linha-total">
              <Table.Th scope="row">Total</Table.Th>
              <Table.Td align="right" className="plan-so-largo">{inteiro(total.projetado.clientes.total)}</Table.Td>
              <Table.Td align="right" className="plan-so-largo plan-so-1180">{dinheiro(total.projetado.vendas.almoco)}</Table.Td>
              <Table.Td align="right" className="plan-so-largo plan-so-1180">{dinheiro(total.projetado.vendas.jantar)}</Table.Td>
              <Table.Td align="right" className="plan-col-destaque">{dinheiro(total.projetado.vendas.total)}</Table.Td>
              <Table.Td align="right" className="plan-so-largo">{dinheiro(total.base.vendas.total)}</Table.Td>
              <Table.Td align="right" className={classeDaVariacao(total.variacaoVendas)}>{textoDaVariacao(total.variacaoVendas)}</Table.Td>
              <Table.Td align="right" className="plan-so-largo plan-so-1180">{dinheiro(total.projetado.ticket.total, 2)}</Table.Td>
              <Table.Td align="right" className="plan-so-largo plan-so-1180">{total.cmvPercentual === null ? "—" : `${(total.cmvPercentual * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</Table.Td>
              <Table.Td align="right">{dinheiro(total.margemBruta)}</Table.Td>
            </Table.Row>
          </tfoot>
        </Table>
      </Quadro>
    </>
  );
}
