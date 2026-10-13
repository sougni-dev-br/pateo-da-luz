import type { AnaliseCancelamentos } from "../../api/client";
import { Alert, KpiCard, Money, PanelEyebrow, Percent, Table } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Barra } from "./Barra";
import { pontos } from "./periodo";

const rotuloHora = (hora: string) => (hora === "—" ? "Sem hora" : `${hora}h`);
const direita = { textAlign: "right" } as const;

export function CancelamentosPanel({ dados }: { dados: AnaliseCancelamentos }) {
  const { resumo, cobertura, periodo } = dados;

  if (cobertura.vendasComDetalhe === 0) {
    return (
      <Alert tone="info">
        Ainda não há venda detalhada neste período. O agente do PDV precisa estar atualizado e o período precisa ser
        reimportado para o histórico aparecer aqui.
      </Alert>
    );
  }

  const detalheParcial = cobertura.primeiroDia !== null && cobertura.primeiroDia > periodo.inicio;
  const nenhumMotivo = resumo.canceladas > 0 && resumo.semMotivo === resumo.canceladas;
  const maiorPessoa = Math.max(0, ...dados.porPessoa.map((p) => p.valor));
  const maiorHora = Math.max(0, ...dados.porHora.map((h) => h.canceladas));

  return (
    <div className="analise-stack">
      {detalheParcial && (
        <Alert tone="info">
          O detalhe das vendas começa em {formatDate(cobertura.primeiroDia)}. Antes dessa data o período não entra nas contas abaixo.
        </Alert>
      )}
      {nenhumMotivo && (
        <Alert tone="warning">
          Nenhum dos {resumo.canceladas} cancelamentos tem motivo registrado no PDV. Peça à equipe para informar o motivo ao
          cancelar: sem ele a análise mostra quem e quanto, mas não por quê.
        </Alert>
      )}

      <div className="analise-kpis">
        <KpiCard
          label="Taxa de cancelamento"
          value={<Percent value={pontos(resumo.taxaCancelamento)} />}
          sub={`${resumo.canceladas} de ${resumo.vendas} vendas`}
          tone={resumo.taxaCancelamento > 0.05 ? "warning" : "neutral"}
        />
        <KpiCard label="Valor cancelado" moneyValue={resumo.valorCancelado} sub="soma das vendas canceladas" tone="danger" />
        <KpiCard label="Vendas recebidas" moneyValue={resumo.valorFaturado} sub="total do PDV, com serviço" />
        <KpiCard label="Sem motivo informado" value={`${resumo.semMotivo} de ${resumo.canceladas}`} sub="cancelamentos" />
      </div>

      <section>
        <PanelEyebrow>Quem cancelou</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Funcionário</th>
              <th style={direita}>Cancelamentos</th>
              <th style={direita}>Valor</th>
              <th>Participação</th>
            </tr>
          </thead>
          <tbody>
            {dados.porPessoa.map((p) => (
              <tr key={p.pessoa}>
                <td>{p.pessoa}</td>
                <td style={direita}>{p.canceladas}</td>
                <td style={direita}><Money value={p.valor} /></td>
                <td className="analise-celula-barra">
                  <Barra razao={maiorPessoa > 0 ? p.valor / maiorPessoa : 0} tom="perigo" />
                  <Percent value={pontos(p.participacao)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <PanelEyebrow>Por turno</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Turno</th>
              <th style={direita}>Vendas</th>
              <th style={direita}>Canceladas</th>
              <th style={direita}>Taxa</th>
              <th style={direita}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {dados.porTurno.map((t) => (
              <tr key={t.turno}>
                <td>{t.turno}</td>
                <td style={direita}>{t.vendas}</td>
                <td style={direita}>{t.canceladas}</td>
                <td style={direita}><Percent value={pontos(t.taxa)} /></td>
                <td style={direita}><Money value={t.valor} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <PanelEyebrow>Por hora do dia</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Hora</th>
              <th style={direita}>Vendas</th>
              <th style={direita}>Canceladas</th>
              <th style={direita}>Taxa</th>
              <th>Cancelamentos</th>
            </tr>
          </thead>
          <tbody>
            {dados.porHora.map((h) => (
              <tr key={h.hora}>
                <td>{rotuloHora(h.hora)}</td>
                <td style={direita}>{h.vendas}</td>
                <td style={direita}>{h.canceladas}</td>
                <td style={direita}><Percent value={pontos(h.taxa)} /></td>
                <td className="analise-celula-barra">
                  <Barra razao={maiorHora > 0 ? h.canceladas / maiorHora : 0} tom="perigo" />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section>
        <PanelEyebrow>Maiores cancelamentos</PanelEyebrow>
        <Table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Hora</th>
              <th>Turno</th>
              <th>Quem cancelou</th>
              <th style={direita}>Pessoas</th>
              <th style={direita}>Valor</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {dados.maiores.map((m) => (
              <tr key={m.saleId}>
                <td>{formatDate(m.data)}</td>
                <td>{m.hora ?? "—"}</td>
                <td>{m.turno}</td>
                <td>{m.pessoa}</td>
                <td style={direita}>{m.pessoas}</td>
                <td style={direita}><Money value={m.valor} /></td>
                <td>{m.motivo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
