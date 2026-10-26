import { Card, EmptyState, KpiCard, Money, PanelEyebrow, SummaryCard, Table, useFormatCurrency, type KpiDelta } from "../design-system";
import type { RevenueSummary } from "../api/client";
import { formatNumber, formatPercent } from "../utils/format";
import { CoberturaPorCanal } from "./CoberturaPorCanal";
import { displayChannel, MoneyOrDash } from "./revenueBits";
import type { RevenueAnalytics } from "./revenueAnalytics";
import { deltaPercent } from "./revenueGroups";
import { deltaDirection, formatDeltaText, hasAnyValue } from "./revenueView";
import { RevenueDailyChart } from "./RevenueDailyChart";

export type PreviousPeriod = { label: string; summary: RevenueSummary["summary"]; inProgress: boolean };

type Props = {
  summary: RevenueSummary | null;
  analytics: RevenueAnalytics;
  previous: PreviousPeriod | null;
  year: number;
  month: number;
  showPlatforms: boolean;
};

const percent = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

/** Variação contra o mês anterior. Mês em andamento contra mês fechado fica neutro: a queda é esperada. */
function buildDelta(current: number, prior: number | undefined, previous: PreviousPeriod | null): KpiDelta | null {
  if (!previous) return null;
  const delta = deltaPercent(current, prior ?? null);
  if (delta === null) return null;
  return {
    text: `${formatDeltaText(delta)} vs. mês anterior`,
    direction: previous.inProgress ? "flat" : deltaDirection(delta)
  };
}

export function RevenueOverview({ summary, analytics, previous, year, month, showPlatforms }: Props) {
  const fmt = useFormatCurrency();
  const data = summary?.summary;
  const net = data?.netAmount ?? 0;
  const gross = data?.grossAmount ?? 0;
  const service = data?.serviceAmount ?? 0;
  const daysWithSales = analytics.dailyRows.length;
  const hasShiftSales = hasAnyValue([data?.salesFirstShift, data?.salesSecondShift]);
  const platformTotal = analytics.platformRows.reduce((sum, row) => sum + row.gross, 0);
  const platformTickets = analytics.platformRows.reduce((sum, row) => sum + row.tickets, 0);

  return (
    <div className="revenue-tabpanel">
      <div className="revenue-kpis">
        <KpiCard
          label="Faturamento líquido"
          moneyValue={net}
          sub={`Bruto ${fmt(gross)} · serviço ${fmt(service)}`}
          delta={buildDelta(net, previous?.summary.netAmount, previous)}
          sparkline={analytics.series.length >= 2 ? analytics.series.map((point) => point.total) : undefined}
        />
        <KpiCard
          label="Ticket médio"
          moneyValue={data?.ticketAverageGeneral ?? 0}
          sub="Líquido por pessoa"
          delta={buildDelta(data?.ticketAverageGeneral ?? 0, previous?.summary.ticketAverageGeneral, previous)}
        />
        <KpiCard
          label="Pessoas atendidas"
          value={formatNumber(data?.tickets ?? 0)}
          sub="TCs do período"
          delta={buildDelta(data?.tickets ?? 0, previous?.summary.tickets, previous)}
        />
        <KpiCard
          label="Dias com movimento"
          value={formatNumber(daysWithSales)}
          sub={daysWithSales > 0 ? `Média de ${fmt(net / daysWithSales)} por dia` : "Nenhum dia lançado"}
        />
        {hasShiftSales && (
          <>
            <KpiCard label="1º turno" moneyValue={data?.salesFirstShift ?? 0} sub={`${formatPercent(percent(data?.salesFirstShift ?? 0, gross))} das vendas`} />
            <KpiCard label="2º turno" moneyValue={data?.salesSecondShift ?? 0} sub={`${formatPercent(percent(data?.salesSecondShift ?? 0, gross))} das vendas`} />
          </>
        )}
      </div>

      {previous && (
        <p className="revenue-note">
          Variação contra {previous.label}
          {previous.inProgress ? ": este mês ainda está em andamento, então a comparação é com um mês completo." : "."}
        </p>
      )}

      <Card>
        <PanelEyebrow>Evolução</PanelEyebrow>
        <h2 className="revenue-card-title">Líquido por dia</h2>
        {analytics.series.length >= 2 ? (
          <RevenueDailyChart series={analytics.series} />
        ) : (
          <EmptyState title="Poucos dias para um gráfico" description="O gráfico aparece a partir de dois dias com faturamento no período." />
        )}
      </Card>

      <Card>
        <PanelEyebrow>Origem da receita</PanelEyebrow>
        <h2 className="revenue-card-title">Por canal</h2>
        {analytics.channelRows.length === 0 ? (
          <EmptyState title="Nenhum canal com movimento" description="Lance o faturamento do dia no Caixa, importe um relatório ou lance um evento." />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Canal</Table.Th>
                <Table.Th align="right">Líquido</Table.Th>
                <Table.Th align="right">% do total</Table.Th>
                <Table.Th align="right">Bruto</Table.Th>
                <Table.Th align="right">Serviço</Table.Th>
                <Table.Th align="right">TCs</Table.Th>
                <Table.Th align="right">TM</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {analytics.channelRows.map((row) => (
                <Table.Row key={row.channel}>
                  <Table.Td>{displayChannel(row.channel)}</Table.Td>
                  <Table.Td align="right"><strong><Money value={row.net} /></strong></Table.Td>
                  <Table.Td align="right">{formatPercent(percent(row.net, analytics.channelNetTotal))}</Table.Td>
                  <Table.Td align="right"><MoneyOrDash value={row.gross} /></Table.Td>
                  <Table.Td align="right"><MoneyOrDash value={row.service} /></Table.Td>
                  <Table.Td align="right">{formatNumber(row.tickets)}</Table.Td>
                  <Table.Td align="right"><MoneyOrDash value={row.average} /></Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
        {analytics.idleChannels.length > 0 && analytics.channelRows.length > 0 && (
          <p className="revenue-note">Sem movimento no período: {analytics.idleChannels.map(displayChannel).join(", ")}.</p>
        )}
      </Card>

      {showPlatforms && (
        <Card>
          <PanelEyebrow>Delivery</PanelEyebrow>
          <h2 className="revenue-card-title">Por plataforma</h2>
          <div className="revenue-platforms">
            {analytics.platformRows.map((row) => (
              <SummaryCard
                key={row.sourcePlatform}
                label={row.sourcePlatform}
                moneyValue={row.gross}
                detail={`TCs ${formatNumber(row.tickets)} · TM ${fmt(row.average)}`}
              />
            ))}
            <SummaryCard label="Total delivery" moneyValue={platformTotal} detail={`TCs ${formatNumber(platformTickets)}`} />
          </div>
        </Card>
      )}

      <CoberturaPorCanal year={year} month={month} />
    </div>
  );
}
