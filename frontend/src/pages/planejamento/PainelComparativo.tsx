import type { ReactNode } from "react";
import type { PlanejamentoComparativo, PlanejamentoTurnos } from "../../api/client";
import { KpiCard, Money, StatusBadge, Table } from "../../design-system";
import type { KpiDelta, StatusTone } from "../../design-system";
import { descricaoDoPeriodo, leituraDaVariacao, textoDaVariacao, type Leitura } from "./formato";

// Painel executivo: os mesmos nove indicadores da aba da planilha (vendas, clientes e ticket médio,
// no total e por turno), comparando só os meses encerrados e com dado nos dois anos.

type Grandeza = "vendas" | "clientes" | "ticket";
type Turno = keyof PlanejamentoTurnos;

const TURNOS: { chave: Turno; rotulo: string }[] = [
  { chave: "total", rotulo: "total" },
  { chave: "almoco", rotulo: "almoço" },
  { chave: "jantar", rotulo: "jantar" }
];
const GRANDEZAS: { chave: Grandeza; rotulo: string }[] = [
  { chave: "vendas", rotulo: "Vendas" },
  { chave: "clientes", rotulo: "Clientes" },
  { chave: "ticket", rotulo: "Ticket médio" }
];

const TOM_DA_LEITURA: Record<Leitura, StatusTone> = { Aumento: "success", Redução: "danger", Estável: "neutral" };

export function valorFormatado(grandeza: Grandeza, valor: number | null): ReactNode {
  if (valor === null) return "—";
  if (grandeza === "clientes") return valor.toLocaleString("pt-BR");
  return <Money value={valor} decimals={grandeza === "vendas" ? 0 : 2} />;
}

function deltaDe(variacao: number | null): KpiDelta | null {
  const leitura = leituraDaVariacao(variacao);
  if (!leitura) return null;
  return { text: textoDaVariacao(variacao), direction: leitura === "Aumento" ? "up" : leitura === "Redução" ? "down" : "flat" };
}

export function PainelComparativo({ dados }: { dados: PlanejamentoComparativo }) {
  const { acumulado, anoBase, anoComparado } = dados;
  const periodo = descricaoDoPeriodo(acumulado.mesesComparados);
  const vs = `${anoComparado} contra ${anoBase}`;

  return (
    <section className="plan-secao" aria-labelledby="plan-painel">
      <h2 id="plan-painel" className="plan-titulo">Painel comparativo</h2>
      <p className="plan-sub">{vs}, {periodo}. Vendas de mesas sem serviço; clientes e ticket médio contados pelas pessoas atendidas.</p>

      <div className="plan-kpis">
        {GRANDEZAS.map(({ chave, rotulo }) => {
          const variacao = acumulado.variacao[chave].total;
          const tom = leituraDaVariacao(variacao);
          return (
            <KpiCard
              key={chave}
              label={rotulo}
              value={valorFormatado(chave, acumulado.comparado[chave].total)}
              tone={tom === "Aumento" ? "success" : tom === "Redução" ? "danger" : "neutral"}
              delta={deltaDe(variacao)}
              sub={<>{anoBase}: {valorFormatado(chave, acumulado.base[chave].total)}</>}
            />
          );
        })}
      </div>

      <Table>
        <Table.Head>
          <Table.Row>
            <Table.Th>Indicador</Table.Th>
            <Table.Th align="right">{anoBase}</Table.Th>
            <Table.Th align="right">{anoComparado}</Table.Th>
            <Table.Th align="right">Variação</Table.Th>
            <Table.Th>Leitura</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {GRANDEZAS.flatMap(({ chave, rotulo }) =>
            TURNOS.map(({ chave: turno, rotulo: turnoRotulo }) => {
              const variacao = acumulado.variacao[chave][turno];
              const leitura = leituraDaVariacao(variacao);
              return (
                <Table.Row key={`${chave}-${turno}`}>
                  <Table.Td>{rotulo} {turnoRotulo}</Table.Td>
                  <Table.Td align="right">{valorFormatado(chave, acumulado.base[chave][turno])}</Table.Td>
                  <Table.Td align="right">{valorFormatado(chave, acumulado.comparado[chave][turno])}</Table.Td>
                  <Table.Td align="right" className={leitura === "Aumento" ? "plan-var-sobe" : leitura === "Redução" ? "plan-var-desce" : undefined}>
                    {textoDaVariacao(variacao)}
                  </Table.Td>
                  <Table.Td>{leitura ? <StatusBadge tone={TOM_DA_LEITURA[leitura]}>{leitura}</StatusBadge> : "—"}</Table.Td>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>
    </section>
  );
}
