import type { ReactNode } from "react";
import type { PlanejamentoCaixa, PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { Alert, Table } from "../../design-system";
import { Reais } from "./Reais";
import { descricaoDoPeriodo, NOMES_DOS_MESES_CURTOS } from "./formato";
import { Quadro } from "./Quadro";
import { useAteLargura } from "./useEstreito";

// Regime de caixa do cenário: quando o dinheiro entra e sai, mês a mês, e o saldo acumulado. No modo "lado a lado" cada
// mês mostra o lucro em competência e o resultado de caixa juntos, com a diferença entre os dois. Os totais do ano
// estão no veredito, no topo da tela. Abaixo de 1180px (tablet, notebook pequeno) a coluna "Caixa − competência" sai do
// lado a lado, para o saldo do fim do mês caber sem rolar; a diferença do ano continua no veredito.

const LARGURA_SEM_A_DIFERENCA = 1180;

const dinheiro = (n: number | null, casas = 0): ReactNode => (n === null ? "—" : <Reais valor={n} casas={casas} moeda={false} />);
const cor = (n: number | null) => (n === null || n === 0 ? undefined : n > 0 ? "plan-var-sobe" : "plan-var-desce");
const juntar = (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(" ") || undefined;

export type ModoDoCaixa = "caixa" | "lado";

type Props = { projecao: PlanejamentoProjecao; resultado: PlanejamentoResultado; caixa: PlanejamentoCaixa; modo: ModoDoCaixa };

export function ResultadoCaixa({ projecao, resultado, caixa, modo }: Props) {
  const { total } = caixa;
  const semCalculo = projecao.meses.filter((m, i) => m.projetado && caixa.meses[i] === null).map((m) => NOMES_DOS_MESES_CURTOS[m.mes - 1]);
  const periodo = descricaoDoPeriodo(caixa.mesesCalculados);
  // O lucro do ano só é comparável ao resultado de caixa quando os dois cobrem os mesmos meses.
  const mesmosMeses = caixa.mesesCalculados.length === projecao.total.meses.length;
  const lado = modo === "lado";
  const semDiferenca = useAteLargura(LARGURA_SEM_A_DIFERENCA);
  const comDiferenca = lado && !semDiferenca;
  const colunas = lado ? (comDiferenca ? 6 : 5) : 5;
  const totalCompras = caixa.meses.reduce((s, m) => s + (m?.saidasCompras ?? 0), 0);
  const totalGastos = caixa.meses.reduce((s, m) => s + (m?.saidasGastos ?? 0), 0);

  return (
    <>
      {semCalculo.length > 0 && (
        <Alert tone="warning">{`O caixa não foi calculado em ${semCalculo.join(", ")}: falta a base de um mês anterior ou o CMV das compras que vencem nele.`}</Alert>
      )}

      <Quadro rotulo={lado ? "Competência e caixa lado a lado, mês a mês" : "Regime de caixa mês a mês"} className={`plan-quadro-medio${semDiferenca ? " plan-quadro-justo" : ""}${lado ? "" : " plan-quadro-cabe-no-celular"}`}>
        <Table aria-label={lado ? "Competência e caixa lado a lado" : "Regime de caixa mês a mês"}>
          <Table.Head>
            {lado && (
              <Table.Row className="plan-linha-grupo">
                <Table.Th scope="col"><span className="plan-sr">Mês</span></Table.Th>
                <Table.Th scope="colgroup" colSpan={1} align="right" className="plan-grupo-competencia">Competência</Table.Th>
                <Table.Th scope="colgroup" colSpan={3} align="right" className="plan-grupo-caixa">Caixa</Table.Th>
                <Table.Th scope="colgroup" colSpan={comDiferenca ? 2 : 1} align="right" className="plan-grupo-resto"><span className="plan-sr">Comparação e saldo</span></Table.Th>
              </Table.Row>
            )}
            <Table.Row>
              <Table.Th scope="col">Mês</Table.Th>
              {lado && <Table.Th scope="col" align="right" className="plan-col-competencia">Lucro</Table.Th>}
              <Table.Th scope="col" align="right" className={juntar(lado ? "plan-col-caixa" : "plan-so-largo")}>Entradas</Table.Th>
              {!lado && <Table.Th scope="col" align="right" className="plan-so-largo">Compras pagas</Table.Th>}
              {!lado && <Table.Th scope="col" align="right" className="plan-so-largo">Gastos pagos</Table.Th>}
              {lado && <Table.Th scope="col" align="right" className="plan-col-caixa">Saídas</Table.Th>}
              <Table.Th scope="col" align="right" className={juntar(lado && "plan-col-caixa")}>Resultado</Table.Th>
              {comDiferenca && <Table.Th scope="col" align="right" title="Resultado de caixa − lucro: positivo = entrou mais do que se reconheceu no mês">Caixa − competência</Table.Th>}
              <Table.Th scope="col" align="right" className="plan-col-saldo-cabecalho">Saldo no fim do mês</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {caixa.meses.map((c, i) => {
              const nome = NOMES_DOS_MESES_CURTOS[i];
              if (!c) {
                return (
                  <Table.Row key={nome} className="plan-linha-sem-base">
                    <Table.Th scope="row">{nome}</Table.Th>
                    <Table.Td colSpan={colunas}>Não calculado</Table.Td>
                  </Table.Row>
                );
              }
              const lucro = resultado.meses[i]?.lucro ?? null;
              return (
                <Table.Row key={nome}>
                  <Table.Th scope="row">{nome}</Table.Th>
                  {lado && <Table.Td align="right" className={juntar("plan-col-competencia", cor(lucro))}>{dinheiro(lucro)}</Table.Td>}
                  <Table.Td align="right" className={juntar(lado ? "plan-col-caixa" : "plan-so-largo")}>{dinheiro(c.entradas)}</Table.Td>
                  {!lado && <Table.Td align="right" className="plan-so-largo">{dinheiro(c.saidasCompras)}</Table.Td>}
                  {!lado && <Table.Td align="right" className="plan-so-largo">{dinheiro(c.saidasGastos)}</Table.Td>}
                  {lado && <Table.Td align="right" className="plan-col-caixa">{dinheiro(c.saidas)}</Table.Td>}
                  <Table.Td align="right" className={juntar("plan-col-destaque", lado && "plan-col-caixa", cor(c.resultado))}>{dinheiro(c.resultado)}</Table.Td>
                  {comDiferenca && <Table.Td align="right" className={cor(c.diferencaParaCompetencia)}>{dinheiro(c.diferencaParaCompetencia)}</Table.Td>}
                  <Table.Td align="right" className={juntar("plan-col-saldo", cor(c.saldo))}>{dinheiro(c.saldo)}</Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
          <tfoot>
            <Table.Row className="plan-linha-total">
              <Table.Th scope="row">Total{periodo ? <span className="plan-total-periodo plan-so-largo">{periodo}</span> : null}</Table.Th>
              {lado && <Table.Td align="right" className={juntar("plan-col-competencia", cor(mesmosMeses ? resultado.total.lucro : null))}>{dinheiro(mesmosMeses ? resultado.total.lucro : null)}</Table.Td>}
              <Table.Td align="right" className={juntar(lado ? "plan-col-caixa" : "plan-so-largo")}>{dinheiro(total.entradas)}</Table.Td>
              {!lado && <Table.Td align="right" className="plan-so-largo">{dinheiro(total.entradas === null ? null : totalCompras)}</Table.Td>}
              {!lado && <Table.Td align="right" className="plan-so-largo">{dinheiro(total.entradas === null ? null : totalGastos)}</Table.Td>}
              {lado && <Table.Td align="right" className="plan-col-caixa">{dinheiro(total.saidas)}</Table.Td>}
              <Table.Td align="right" className={juntar("plan-col-destaque", lado && "plan-col-caixa", cor(total.resultado))}>{dinheiro(total.resultado)}</Table.Td>
              {comDiferenca && <Table.Td align="right">{dinheiro(mesmosMeses && total.resultado !== null && resultado.total.lucro !== null ? total.resultado - resultado.total.lucro : null)}</Table.Td>}
              <Table.Td align="right" className={juntar("plan-col-saldo", cor(total.saldoFinal))}>{dinheiro(total.saldoFinal)}</Table.Td>
            </Table.Row>
          </tfoot>
        </Table>
      </Quadro>
      <p className="plan-sub">Valores em R$. Mix, prazos e taxas de partida são suposições: confira com a maquininha e o financeiro. As vendas entram sem o serviço, que abate da folha e entra e sai no mesmo mês. Taxa de maquininha informada aqui não deve estar também em Tarifas bancárias.</p>
    </>
  );
}
