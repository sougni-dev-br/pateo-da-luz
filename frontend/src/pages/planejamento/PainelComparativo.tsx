import type { ReactNode } from "react";
import type { PlanejamentoComparativo, PlanejamentoTurnos } from "../../api/client";
import { Table } from "../../design-system";
import { descricaoDoPeriodo, leituraDaVariacao, NOMES_DOS_MESES, textoDaMagnitude, textoDaVariacao } from "./formato";
import { Quadro } from "./Quadro";
import { Reais } from "./Reais";
import { RitmoDoAno } from "./RitmoDoAno";

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

export function valorFormatado(grandeza: Grandeza, valor: number | null, moeda = true): ReactNode {
  if (valor === null) return "—";
  if (grandeza === "clientes") return valor.toLocaleString("pt-BR");
  return <Reais valor={valor} casas={grandeza === "vendas" ? 0 : 2} moeda={moeda} />;
}

const classeDe = (v: number | null) => {
  const leitura = leituraDaVariacao(v);
  return leitura === "Aumento" ? "plan-var-sobe" : leitura === "Redução" ? "plan-var-desce" : undefined;
};

function fraseDoVeredito(variacao: number | null, anoBase: number, anoComparado: number): string {
  const leitura = leituraDaVariacao(variacao);
  if (!leitura) return `Sem comparação de vendas entre ${anoComparado} e ${anoBase}`;
  if (leitura === "Estável") return `${anoComparado} vende o mesmo que ${anoBase}`;
  return `${anoComparado} vende ${textoDaMagnitude(variacao ?? 0)} ${leitura === "Aumento" ? "a mais" : "a menos"} que ${anoBase}`;
}

/** Vendas = clientes × ticket: diz qual dos dois mais explica a variação das vendas. */
function oQueMaisPesou(clientes: number | null, ticket: number | null): string | null {
  if (clientes === null || ticket === null) return null;
  const motor = Math.abs(clientes) >= Math.abs(ticket) ? "o número de clientes" : "o ticket médio";
  const outro = motor === "o número de clientes" ? `o ticket médio ${ticket >= 0 ? "subiu" : "caiu"} ${textoDaMagnitude(ticket)}` : `os clientes ${clientes >= 0 ? "subiram" : "caíram"} ${textoDaMagnitude(clientes)}`;
  return `O que mais pesou foi ${motor}; ${outro}.`;
}

/** O melhor e o pior mês comparável: diz onde a variação do acumulado nasceu. */
function Extremos({ dados }: { dados: PlanejamentoComparativo }) {
  const meses = dados.meses.filter((m) => m.comparavel && m.variacao.vendas.total !== null);
  if (meses.length < 2) return null;
  const ordenados = [...meses].sort((a, b) => (a.variacao.vendas.total ?? 0) - (b.variacao.vendas.total ?? 0));
  const pior = ordenados[0];
  const melhor = ordenados[ordenados.length - 1];
  const linha = (rotulo: string, m: typeof pior) => (
    <div className="plan-extremo">
      <dt>{rotulo}</dt>
      <dd><span className="plan-extremo-mes">{NOMES_DOS_MESES[m.mes - 1]}</span> <span className={classeDe(m.variacao.vendas.total)}>{textoDaVariacao(m.variacao.vendas.total)}</span></dd>
    </div>
  );
  return (
    <dl className="plan-extremos" aria-label="Meses extremos nas vendas">
      {linha("Melhor mês nas vendas", melhor)}
      {linha("Pior mês nas vendas", pior)}
    </dl>
  );
}

function VereditoComparativo({ dados }: { dados: PlanejamentoComparativo }) {
  const { acumulado, anoBase, anoComparado } = dados;
  const v = acumulado.variacao;
  const leitura = leituraDaVariacao(v.vendas.total);
  const tom = leitura === "Aumento" ? "positivo" : leitura === "Redução" ? "negativo" : "neutro";
  const explicacao = oQueMaisPesou(v.clientes.total, v.ticket.total);
  return (
    <div className={`plan-veredito plan-veredito-${tom} plan-veredito-compacto`}>
      <p className="plan-eyebrow">Veredito · {descricaoDoPeriodo(acumulado.mesesComparados)}</p>
      <h2 id="plan-painel" className="plan-veredito-titulo">{fraseDoVeredito(v.vendas.total, anoBase, anoComparado)}</h2>
      {explicacao && <p className="plan-veredito-detalhe">{explicacao}</p>}
      <dl className="plan-turnos">
        {(["almoco", "jantar"] as const).map((turno) => (
          <div key={turno} className="plan-turno">
            <dt>Vendas do {turno === "almoco" ? "almoço" : "jantar"}</dt>
            <dd className={classeDe(v.vendas[turno])}>{textoDaVariacao(v.vendas[turno])}</dd>
          </div>
        ))}
        <div className="plan-turno">
          <dt>Clientes</dt>
          <dd className={classeDe(v.clientes.total)}>{textoDaVariacao(v.clientes.total)}</dd>
        </div>
        <div className="plan-turno">
          <dt>Ticket médio</dt>
          <dd className={classeDe(v.ticket.total)}>{textoDaVariacao(v.ticket.total)}</dd>
        </div>
      </dl>
      <RitmoDoAno dados={dados} />
      <Extremos dados={dados} />
    </div>
  );
}

export function PainelComparativo({ dados }: { dados: PlanejamentoComparativo }) {
  const { acumulado, anoBase, anoComparado } = dados;
  const periodo = descricaoDoPeriodo(acumulado.mesesComparados);
  const vs = `${anoComparado} contra ${anoBase}`;

  return (
    <section className="plan-secao plan-comparativo-topo" aria-labelledby="plan-painel">
      <VereditoComparativo dados={dados} />

      <div className="plan-indicadores">
        <p className="plan-indicadores-titulo">Os nove indicadores · {periodo}</p>
        <Quadro rotulo={`Indicadores de ${vs}`} className="plan-quadro-indicadores">
          <Table aria-label={`Indicadores de ${vs}`}>
            <Table.Head>
              <Table.Row>
                <Table.Th scope="col">Indicador</Table.Th>
                <Table.Th scope="col" align="right" className="plan-so-largo">{anoBase}</Table.Th>
                <Table.Th scope="col" align="right">{anoComparado}</Table.Th>
                <Table.Th scope="col" align="right">Variação</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {GRANDEZAS.flatMap(({ chave, rotulo }) =>
                TURNOS.map(({ chave: turno, rotulo: turnoRotulo }) => {
                  const variacao = acumulado.variacao[chave][turno];
                  return (
                    <Table.Row key={`${chave}-${turno}`} className={turno === "jantar" ? "plan-linha-fim-de-grupo" : turno === "total" ? "plan-linha-cabeca" : undefined}>
                      <Table.Th scope="row">{turno === "total" ? rotulo : <span className="plan-recuo">{turnoRotulo}</span>}</Table.Th>
                      <Table.Td align="right" className="plan-so-largo">{valorFormatado(chave, acumulado.base[chave][turno])}</Table.Td>
                      <Table.Td align="right">{valorFormatado(chave, acumulado.comparado[chave][turno])}</Table.Td>
                      <Table.Td align="right" className={classeDe(variacao)}>{textoDaVariacao(variacao)}</Table.Td>
                    </Table.Row>
                  );
                })
              )}
            </Table.Body>
          </Table>
        </Quadro>
        <p className="plan-sub"><span className="plan-so-estreito">No celular, só {anoComparado} e a variação; {anoBase} está no gráfico abaixo. </span>Vendas de mesas sem serviço; clientes e ticket médio contados pelas pessoas atendidas. Só entram os meses encerrados, completos e com dado nos dois anos.</p>
      </div>
    </section>
  );
}
