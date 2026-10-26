import { Card, EmptyState, Money, PanelEyebrow, StatusBadge, Table } from "../design-system";
import { formatDate, formatNumber, formatPercent } from "../utils/format";
import { MoneyOrDash } from "./revenueBits";
import type { RevenueAnalytics } from "./revenueAnalytics";
import { hasAnyValue, pickBestAndWorstDay } from "./revenueView";

export function RevenueDaily({ analytics }: { analytics: RevenueAnalytics }) {
  const { dailyRows, weekdayRows } = analytics;
  const showShifts = hasAnyValue(dailyRows.flatMap((row) => [row.salesFirstShift, row.salesSecondShift]));
  const showService = hasAnyValue(dailyRows.map((row) => row.serviceAmount));
  const showWeekdayService = hasAnyValue(weekdayRows.map((row) => row.serviceAmount));
  const marks = pickBestAndWorstDay(dailyRows);

  return (
    <div className="revenue-tabpanel">
      <Card>
        <PanelEyebrow>Dia a dia</PanelEyebrow>
        <h2 className="revenue-card-title">{dailyRows.length} {dailyRows.length === 1 ? "dia" : "dias"} com faturamento</h2>
        {dailyRows.length === 0 ? (
          <EmptyState title="Nenhum faturamento no período" description="Ajuste os filtros ou lance o faturamento do dia." />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Dia</Table.Th>
                <Table.Th>Dia da semana</Table.Th>
                {showShifts && <Table.Th align="right">1º turno</Table.Th>}
                {showShifts && <Table.Th align="right">2º turno</Table.Th>}
                {showService && <Table.Th align="right">Serviço</Table.Th>}
                <Table.Th align="right">Bruto</Table.Th>
                <Table.Th align="right">TCs</Table.Th>
                <Table.Th align="right">Líquido</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {dailyRows.map((row) => (
                <Table.Row key={row.date}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {formatDate(row.date)}
                    {row.date === marks.best && <StatusBadge tone="success" className="revenue-day-badge">Melhor dia</StatusBadge>}
                    {row.date === marks.worst && <StatusBadge tone="warning" className="revenue-day-badge">Menor dia</StatusBadge>}
                  </Table.Td>
                  <Table.Td>{row.weekdayName}</Table.Td>
                  {showShifts && <Table.Td align="right"><MoneyOrDash value={row.salesFirstShift} /></Table.Td>}
                  {showShifts && <Table.Td align="right"><MoneyOrDash value={row.salesSecondShift} /></Table.Td>}
                  {showService && <Table.Td align="right"><MoneyOrDash value={row.serviceAmount} /></Table.Td>}
                  <Table.Td align="right"><MoneyOrDash value={row.grossAmount} /></Table.Td>
                  <Table.Td align="right">{formatNumber(row.tickets)}</Table.Td>
                  <Table.Td align="right"><strong><MoneyOrDash value={row.netAmount} /></strong></Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Card>

      {weekdayRows.length > 0 && (
        <Card>
          <PanelEyebrow>Padrão da semana</PanelEyebrow>
          <h2 className="revenue-card-title">Por dia da semana</h2>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Dia da semana</Table.Th>
                <Table.Th align="right">Bruto</Table.Th>
                <Table.Th align="right">Líquido</Table.Th>
                <Table.Th align="right">TCs</Table.Th>
                {showWeekdayService && <Table.Th align="right">Serviço %</Table.Th>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {weekdayRows.map((row) => (
                <Table.Row key={row.weekdayName}>
                  <Table.Td>{row.weekdayName}</Table.Td>
                  <Table.Td align="right"><Money value={row.grossAmount} /></Table.Td>
                  <Table.Td align="right"><strong><Money value={row.netAmount} /></strong></Table.Td>
                  <Table.Td align="right">{formatNumber(row.tickets)}</Table.Td>
                  {showWeekdayService && (
                    <Table.Td align="right">
                      {row.grossAmount > 0 ? formatPercent((row.serviceAmount / row.grossAmount) * 100) : "—"}
                    </Table.Td>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      )}
    </div>
  );
}
