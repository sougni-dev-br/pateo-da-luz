import type { ReactNode } from "react";
import type { PlanejamentoCaixa, PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { Alert, KpiCard, Money, Table } from "../../design-system";
import { descricaoDoPeriodo, NOMES_DOS_MESES_CURTOS } from "./formato";

// Regime de caixa do cenário: quando o dinheiro entra e sai, mês a mês, e o saldo acumulado. No modo "lado a lado" cada
// mês mostra o lucro em competência e o resultado de caixa juntos, com a diferença entre os dois.

const dinheiro = (n: number | null, casas = 0): ReactNode => (n === null ? "—" : <Money value={n} decimals={casas} />);
const cor = (n: number | null) => (n === null || n === 0 ? undefined : n > 0 ? "plan-var-sobe" : "plan-var-desce");

export type ModoDoCaixa = "caixa" | "lado";

type Props = { projecao: PlanejamentoProjecao; resultado: PlanejamentoResultado; caixa: PlanejamentoCaixa; modo: ModoDoCaixa };

export function ResultadoCaixa({ projecao, resultado, caixa, modo }: Props) {
  const { total } = caixa;
  const semCalculo = projecao.meses.filter((m, i) => m.projetado && caixa.meses[i] === null).map((m) => NOMES_DOS_MESES_CURTOS[m.mes - 1]);
  const periodo = descricaoDoPeriodo(caixa.mesesCalculados);
  const ultimoMes = caixa.mesesCalculados[caixa.mesesCalculados.length - 1];
  // O lucro do ano só é comparável ao resultado de caixa quando os dois cobrem os mesmos meses.
  const mesmosMeses = caixa.mesesCalculados.length === projecao.total.meses.length;

  return (
    <>
      <Alert tone="info">Mix, prazos e taxas de partida são suposições: confira com a maquininha e o financeiro. As vendas entram sem o serviço, que abate da folha e é tratado como entrando e saindo no mesmo mês. Taxa de maquininha informada aqui não deve estar também em Tarifas bancárias.</Alert>
      {semCalculo.length > 0 && (
        <Alert tone="warning">{`O caixa não foi calculado em ${semCalculo.join(", ")}: falta a base de um mês anterior ou o CMV das compras que vencem nele.`}</Alert>
      )}

      <div className="plan-kpis plan-kpis-4">
        <KpiCard label={`Resultado de caixa (${periodo || "—"})`} value={dinheiro(total.resultado)} tone={total.resultado === null ? "neutral" : total.resultado >= 0 ? "success" : "danger"} sub={total.resultado === null ? "Algum mês ficou sem cálculo: sem total" : mesmosMeses && resultado.total.lucro !== null ? <>Lucro em competência: {dinheiro(resultado.total.lucro)}</> : "Entradas − saídas"} />
        <KpiCard label={ultimoMes ? `Saldo no fim de ${NOMES_DOS_MESES_CURTOS[ultimoMes - 1]}` : "Saldo no fim do período"} value={dinheiro(total.saldoFinal)} tone={total.saldoFinal === null ? "neutral" : total.saldoFinal >= 0 ? "success" : "danger"} sub={total.saldoFinal === null ? "Indisponível sem todos os meses calculados" : "Caixa inicial + resultado acumulado"} />
        <KpiCard label="Menor saldo" value={dinheiro(total.menorSaldo?.valor ?? null)} tone={total.menorSaldo && total.menorSaldo.valor < 0 ? "danger" : "neutral"} sub={total.menorSaldo ? `Em ${NOMES_DOS_MESES_CURTOS[total.menorSaldo.mes - 1]}` : undefined} />
        <KpiCard label="Capital de giro necessário" value={dinheiro(total.necessidadeDeCapital)} tone={total.necessidadeDeCapital && total.necessidadeDeCapital > 0 ? "warning" : "neutral"} sub={`Falta no pior momento de ${periodo || "—"} (0 = o caixa não fica negativo)`} />
      </div>

      <div className="plan-quadro">
        <Table aria-label={modo === "lado" ? "Competência e caixa lado a lado" : "Regime de caixa mês a mês"}>
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col">Mês</Table.Th>
              {modo === "lado" && <Table.Th align="right">Lucro (competência)</Table.Th>}
              <Table.Th align="right">Entradas</Table.Th>
              {modo === "caixa" && <Table.Th align="right">Compras pagas</Table.Th>}
              {modo === "caixa" && <Table.Th align="right">Gastos pagos</Table.Th>}
              {modo === "lado" && <Table.Th align="right">Saídas</Table.Th>}
              <Table.Th align="right">Resultado de caixa</Table.Th>
              {modo === "lado" && <Table.Th align="right" title="Resultado de caixa − lucro: positivo = entrou mais do que se reconheceu no mês">Diferença</Table.Th>}
              <Table.Th align="right">Saldo</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {caixa.meses.map((c, i) => {
              const nome = NOMES_DOS_MESES_CURTOS[i];
              const colunas = modo === "lado" ? 6 : 5;
              if (!c) {
                return (
                  <Table.Row key={nome} className="plan-linha-sem-base">
                    <Table.Th scope="row">{nome}</Table.Th>
                    <Table.Td colSpan={colunas}>Não calculado</Table.Td>
                  </Table.Row>
                );
              }
              return (
                <Table.Row key={nome}>
                  <Table.Th scope="row">{nome}</Table.Th>
                  {modo === "lado" && <Table.Td align="right" className={cor(resultado.meses[i]?.lucro ?? null)}>{dinheiro(resultado.meses[i]?.lucro ?? null)}</Table.Td>}
                  <Table.Td align="right">{dinheiro(c.entradas)}</Table.Td>
                  {modo === "caixa" && <Table.Td align="right">{dinheiro(c.saidasCompras)}</Table.Td>}
                  {modo === "caixa" && <Table.Td align="right">{dinheiro(c.saidasGastos)}</Table.Td>}
                  {modo === "lado" && <Table.Td align="right">{dinheiro(c.saidas)}</Table.Td>}
                  <Table.Td align="right" className={`plan-col-destaque ${cor(c.resultado) ?? ""}`}>{dinheiro(c.resultado)}</Table.Td>
                  {modo === "lado" && <Table.Td align="right" className={cor(c.diferencaParaCompetencia)}>{dinheiro(c.diferencaParaCompetencia)}</Table.Td>}
                  <Table.Td align="right" className={cor(c.saldo)}>{dinheiro(c.saldo)}</Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>
    </>
  );
}
