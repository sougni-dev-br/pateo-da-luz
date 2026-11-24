import type { PlanejamentoComparativo, PlanejamentoTurnos } from "../../api/client";
import type { ReactNode } from "react";
import { Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, textoDaVariacao } from "./formato";
import { diaDeHoje, ladoParcial } from "./tipos";
import { useOculto } from "./useOculto";

// Quadro mês a mês: para cada turno, o ano-base, o ano comparado e a variação. A última coluna é o acumulado
// dos meses comparáveis (encerrados e com dado nos dois anos), o mesmo da aba "Painel executivo".

export type GrandezaDoQuadro = "vendas" | "clientes" | "ticket";
type Turno = keyof PlanejamentoTurnos;

const TURNOS: { chave: Turno; rotulo: string }[] = [
  { chave: "almoco", rotulo: "Almoço" },
  { chave: "jantar", rotulo: "Jantar" },
  { chave: "total", rotulo: "Total" }
];

const UNIDADE: Record<GrandezaDoQuadro, string> = { vendas: "R$ mil", clientes: "pessoas", ticket: "R$" };

/** Célula enxuta: vendas em milhares com uma casa ("128,5"), ticket sem o R$ (a unidade vai no cabeçalho). */
function celula(grandeza: GrandezaDoQuadro, valor: number | null, oculto: boolean): ReactNode {
  if (valor === null) return "—";
  if (grandeza === "clientes") return valor.toLocaleString("pt-BR");
  if (oculto) return "••••";
  if (grandeza === "vendas") return (valor / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const classeDaVariacao = (v: number | null) => (v === null || Math.round(v * 1000) === 0 ? undefined : v > 0 ? "plan-var-sobe" : "plan-var-desce");

export function TabelaMensal({ dados, grandeza }: { dados: PlanejamentoComparativo; grandeza: GrandezaDoQuadro }) {
  const { meses, acumulado, anoBase, anoComparado } = dados;
  const hidden = useOculto();
  const dia = diaDeHoje(dados.hoje);
  const rotuloParcial = (m: (typeof meses)[number]): string | null => {
    if (m.emAndamento) return dia ? `até dia ${dia}` : "em andamento";
    if (ladoParcial(m.base) || ladoParcial(m.comparado)) return "< 90% dos dias";
    return null;
  };

  return (
    <Table aria-label={`Comparativo mês a mês de ${anoComparado} contra ${anoBase}`}>
      <Table.Head>
        <Table.Row>
          <Table.Th scope="col" className="plan-col-rotulo">Turno <span className="plan-unidade-cabecalho">{UNIDADE[grandeza]}</span></Table.Th>
          {meses.map((m) => {
            const parcial = rotuloParcial(m);
            return (
              <Table.Th key={m.mes} scope="col" align="right" className={parcial ? "plan-col-parcial" : undefined}>
                {NOMES_DOS_MESES_CURTOS[m.mes - 1]}
                {parcial && <span className="plan-parcial">parcial<span className="plan-parcial-detalhe">{parcial}</span></span>}
              </Table.Th>
            );
          })}
          <Table.Th scope="col" align="right" className="plan-col-acumulado">Acumulado</Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {TURNOS.flatMap(({ chave, rotulo }) => [
          <Table.Row key={`${chave}-base`} className={chave === "total" ? "plan-linha-total" : undefined}>
            <Table.Th scope="row" className="plan-col-rotulo">{rotulo} <span className="plan-ano-claro">{anoBase}</span></Table.Th>
            {meses.map((m) => <Table.Td key={m.mes} align="right" className="plan-celula-base">{celula(grandeza, m.base[grandeza][chave], hidden)}</Table.Td>)}
            <Table.Td align="right" className="plan-col-acumulado plan-celula-base">{celula(grandeza, acumulado.base[grandeza][chave], hidden)}</Table.Td>
          </Table.Row>,
          <Table.Row key={`${chave}-comp`} className={chave === "total" ? "plan-linha-total" : undefined}>
            <Table.Th scope="row" className="plan-col-rotulo">{rotulo} <span className="plan-ano-escuro">{anoComparado}</span></Table.Th>
            {meses.map((m) => (
              <Table.Td key={m.mes} align="right" className={m.emAndamento ? "plan-col-parcial-celula" : undefined}>
                {m.emAndamento && m.comparado[grandeza][chave] === null ? <span className="plan-sem-venda">sem venda lançada</span> : celula(grandeza, m.comparado[grandeza][chave], hidden)}
              </Table.Td>
            ))}
            <Table.Td align="right" className="plan-col-acumulado">{celula(grandeza, acumulado.comparado[grandeza][chave], hidden)}</Table.Td>
          </Table.Row>,
          <Table.Row key={`${chave}-var`} className="plan-linha-variacao">
            <Table.Th scope="row" className="plan-col-rotulo"><span className="plan-recuo">variação<span className="plan-sr"> do {rotulo.toLowerCase()}</span></span></Table.Th>
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
