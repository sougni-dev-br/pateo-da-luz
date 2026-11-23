import type { PlanejamentoComparativo, PlanejamentoTurnos } from "../../api/client";
import { Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, textoDaVariacao } from "./formato";
import { valorFormatado } from "./PainelComparativo";

// Quadro mês a mês: para cada turno, o ano-base, o ano comparado e a variação. A última coluna é o acumulado
// dos meses comparáveis (encerrados e com dado nos dois anos), o mesmo da aba "Painel executivo".

export type GrandezaDoQuadro = "vendas" | "clientes" | "ticket";
type Turno = keyof PlanejamentoTurnos;

const TURNOS: { chave: Turno; rotulo: string }[] = [
  { chave: "almoco", rotulo: "Almoço" },
  { chave: "jantar", rotulo: "Jantar" },
  { chave: "total", rotulo: "Total" }
];

const classeDaVariacao = (v: number | null) => (v === null || Math.round(v * 1000) === 0 ? undefined : v > 0 ? "plan-var-sobe" : "plan-var-desce");

export function TabelaMensal({ dados, grandeza }: { dados: PlanejamentoComparativo; grandeza: GrandezaDoQuadro }) {
  const { meses, acumulado, anoBase, anoComparado } = dados;

  return (
    <Table aria-label={`Comparativo mês a mês de ${anoComparado} contra ${anoBase}`}>
      <Table.Head>
        <Table.Row>
          <Table.Th scope="col" className="plan-col-rotulo">Turno</Table.Th>
          {meses.map((m) => (
            <Table.Th key={m.mes} align="right" title={m.emAndamento ? "Mês em andamento: fica fora do acumulado" : undefined}>
              {NOMES_DOS_MESES_CURTOS[m.mes - 1]}
              {m.emAndamento && <span className="plan-andamento"> ◐</span>}
            </Table.Th>
          ))}
          <Table.Th align="right">Acumulado</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {TURNOS.flatMap(({ chave, rotulo }) => [
          <Table.Row key={`${chave}-base`} className={chave === "total" ? "plan-linha-total" : undefined}>
            <Table.Th scope="row" className="plan-col-rotulo">{rotulo} · {anoBase}</Table.Th>
            {meses.map((m) => <Table.Td key={m.mes} align="right">{valorFormatado(grandeza, m.base[grandeza][chave])}</Table.Td>)}
            <Table.Td align="right" className="plan-col-acumulado">{valorFormatado(grandeza, acumulado.base[grandeza][chave])}</Table.Td>
          </Table.Row>,
          <Table.Row key={`${chave}-comp`} className={chave === "total" ? "plan-linha-total" : undefined}>
            <Table.Th scope="row" className="plan-col-rotulo">{rotulo} · {anoComparado}</Table.Th>
            {meses.map((m) => <Table.Td key={m.mes} align="right">{valorFormatado(grandeza, m.comparado[grandeza][chave])}</Table.Td>)}
            <Table.Td align="right" className="plan-col-acumulado">{valorFormatado(grandeza, acumulado.comparado[grandeza][chave])}</Table.Td>
          </Table.Row>,
          <Table.Row key={`${chave}-var`} className="plan-linha-variacao">
            <Table.Th scope="row" className="plan-col-rotulo">Variação {rotulo.toLowerCase()}</Table.Th>
            {meses.map((m) => (
              <Table.Td key={m.mes} align="right" className={classeDaVariacao(m.variacao[grandeza][chave])}>{textoDaVariacao(m.variacao[grandeza][chave])}</Table.Td>
            ))}
            <Table.Td align="right" className={`plan-col-acumulado ${classeDaVariacao(acumulado.variacao[grandeza][chave]) ?? ""}`}>
              {textoDaVariacao(acumulado.variacao[grandeza][chave])}
            </Table.Td>
          </Table.Row>
        ])}
      </Table.Body>
    </Table>
  );
}
