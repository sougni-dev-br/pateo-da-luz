import { AlertTriangle, CalendarRange, Percent, Settings, TrendingUp, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getExtraPainel, type ExtraHabitualidade, type ExtraMotivo, type ExtraPainel } from "../../../api/client";
import { Alert, Button, EmptyState, Money, PanelEyebrow, StatusBadge, SummaryCard, Table } from "../../../design-system";
import { Quebra } from "./ExtrasAnalise";
import { MOTIVO_ROTULO, brl, diariasTexto } from "./extrasRotulos";
import { GraficoMensal, rotuloMes } from "./GraficoMensal";

type Props = {
  ate: string; // AAAA-MM, o mês escolhido no topo da página
  habitualidade: ExtraHabitualidade | null;
  podeAjustarCriterios: boolean;
  onAjustarCriterios: () => void;
};

const PERIODOS = [3, 6, 12];
// Abaixo de 1% (extras sobre o faturamento) uma casa decimal viraria "0%".
const pct = (parte: number, todo: number) => {
  if (todo <= 0) return "—";
  const v = (parte / todo) * 100;
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v > 0 && v < 1 ? 2 : 1 })}%`;
};

export function ExtrasPainel({ ate, habitualidade, podeAjustarCriterios, onAjustarCriterios }: Props) {
  const [meses, setMeses] = useState(6);
  const [painel, setPainel] = useState<ExtraPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carga = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++carga.current;
    setErro(null);
    try {
      const p = await getExtraPainel(ate, meses);
      if (minha === carga.current) setPainel(p);
    } catch (e) {
      if (minha === carga.current) setErro(e instanceof Error ? e.message : "Não foi possível carregar o painel.");
    }
  }, [ate, meses]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Só mostra se for o painel pedido (mês e período): troca rápida não exibe dado velho.
  const dados = painel && painel.ate === ate && painel.meses.length === meses ? painel : null;
  const total = dados?.meses.reduce((s, m) => s + m.total, 0) ?? 0;
  // Mês sem folha (ou sem faturamento) lançado ainda daria 100% (ou nada): a
  // proporção do período só usa os meses que têm a base lançada.
  const comFolha = dados?.meses.filter((m) => (m.folha ?? 0) > 0) ?? [];
  const comFaturamento = dados?.meses.filter((m) => (m.faturamento ?? 0) > 0) ?? [];
  const extrasComFolha = comFolha.reduce((s, m) => s + m.total, 0);
  const folha = comFolha.reduce((s, m) => s + (m.folha ?? 0), 0);
  const extrasComFaturamento = comFaturamento.reduce((s, m) => s + m.total, 0);
  const faturamento = comFaturamento.reduce((s, m) => s + (m.faturamento ?? 0), 0);
  const mesesComGasto = dados?.meses.filter((m) => m.total > 0).length ?? 0;
  const emRisco = habitualidade?.pessoas.filter((p) => p.emRisco) ?? [];
  const lim = habitualidade?.limites;

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Painel por período</PanelEyebrow>
            <h2>Gasto com extras mês a mês</h2>
          </div>
          <div className="extras-chips" role="group" aria-label="Período">
            {PERIODOS.map((n) => (
              <button key={n} type="button" className="extras-chip" aria-pressed={meses === n} onClick={() => setMeses(n)}>
                {n} meses
              </button>
            ))}
          </div>
        </div>

        {erro && <Alert tone="error">{erro} <button type="button" className="extras-link-botao" onClick={() => void carregar()}>Tentar de novo</button></Alert>}
        {!dados && !erro && <p className="extras-sub">Carregando…</p>}

        {dados && (total === 0 ? (
          <EmptyState title="Nenhuma diária realizada no período" description="O painel aparece quando houver diárias realizadas nos meses escolhidos." />
        ) : (
          <>
            <div className="extras-resumo">
              <SummaryCard compact label={`Total em ${meses} meses`} moneyValue={total} icon={<Wallet size={16} />} detail={`${rotuloMes(dados.meses[0].mes)} a ${rotuloMes(dados.meses[dados.meses.length - 1].mes)}`} />
              <SummaryCard compact label="Média por mês" moneyValue={total / meses} icon={<TrendingUp size={16} />} detail={`${mesesComGasto} de ${meses} meses com extra`} />
              {dados.verFolha && (
                <SummaryCard compact label="Peso no custo de pessoal" value={folha > 0 ? pct(extrasComFolha, extrasComFolha + folha) : "—"} icon={<Percent size={16} />}
                  detail={folha > 0 ? `Folha ${brl(folha)} · ${comFolha.length} de ${meses} meses com folha lançada` : "Nenhuma folha lançada no período"} />
              )}
              {dados.verFaturamento && (
                <SummaryCard compact label="Sobre o faturamento" value={faturamento > 0 ? pct(extrasComFaturamento, faturamento) : "—"} icon={<CalendarRange size={16} />}
                  detail={faturamento > 0 ? `Faturamento bruto ${brl(faturamento)} · ${comFaturamento.length} de ${meses} meses` : "Nenhum faturamento lançado no período"} />
              )}
            </div>

            <GraficoMensal meses={dados.meses} />

            <Table className="extras-tabela">
              <Table.Head>
                <Table.Row>
                  <Table.Th>Mês</Table.Th>
                  <Table.Th className="extras-ocultar-celular" style={{ textAlign: "right" }}>Diárias</Table.Th>
                  <Table.Th className="extras-ocultar-celular" style={{ textAlign: "right" }}>Casa</Table.Th>
                  <Table.Th className="extras-ocultar-celular" style={{ textAlign: "right" }}>Fora</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Total</Table.Th>
                  {dados.verFolha && <Table.Th style={{ textAlign: "right" }} title="Extras ÷ (extras + folha do mês)">% pessoal</Table.Th>}
                  {dados.verFaturamento && <Table.Th style={{ textAlign: "right" }} title="Extras ÷ faturamento bruto do mês">% fatur.</Table.Th>}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {[...dados.meses].reverse().map((m) => (
                  <Table.Row key={m.mes}>
                    <Table.Td>{rotuloMes(m.mes)}</Table.Td>
                    <Table.Td className="extras-ocultar-celular extras-num" style={{ textAlign: "right" }}>{m.diarias ? diariasTexto(m.diarias) : "—"}</Table.Td>
                    <Table.Td className="extras-ocultar-celular extras-num" style={{ textAlign: "right" }}><Money value={m.casa} /></Table.Td>
                    <Table.Td className="extras-ocultar-celular extras-num" style={{ textAlign: "right" }}><Money value={m.fora} /></Table.Td>
                    <Table.Td className="extras-num" style={{ textAlign: "right" }}>
                      <strong><Money value={m.total} /></strong>
                      {m.diferencaPaga !== 0 && <div className="extras-sub">inclui {brl(m.diferencaPaga)} de diferença paga</div>}
                    </Table.Td>
                    {dados.verFolha && (
                      <Table.Td className="extras-num" style={{ textAlign: "right" }} title={(m.folha ?? 0) > 0 ? undefined : "Folha do mês ainda não lançada"}>
                        {(m.folha ?? 0) > 0 ? pct(m.total, m.total + (m.folha ?? 0)) : "—"}
                      </Table.Td>
                    )}
                    {dados.verFaturamento && <Table.Td className="extras-num" style={{ textAlign: "right" }}>{pct(m.total, m.faturamento ?? 0)}</Table.Td>}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>

            <div className="extras-quebras">
              <Quebra titulo="Por setor no período" grupos={dados.porSetor} />
              {dados.porEvento.length > 0 && <Quebra titulo="Por evento no período" grupos={dados.porEvento} />}
              <Quebra titulo="Por motivo no período" grupos={dados.porMotivo} rotulo={(c) => MOTIVO_ROTULO[c as ExtraMotivo] ?? c} />
              <Quebra titulo="Quem mais trabalhou" grupos={dados.porPessoa.map((p) => ({ chave: p.origem === "FORA" ? `${p.nome} (de fora)` : p.nome, total: p.total, diarias: p.diarias }))} />
            </div>
          </>
        ))}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Risco de vínculo empregatício</PanelEyebrow>
            <h2>Frequência das pessoas de fora</h2>
          </div>
          {podeAjustarCriterios && <Button variant="secondary" size="sm" leadingIcon={<Settings size={14} />} onClick={onAjustarCriterios}>Ajustar critérios</Button>}
        </div>
        {lim && (
          <p className="extras-sub" style={{ marginTop: 0 }}>
            Acende o aviso quem, contando as diárias realizadas e previstas, tem {lim.porSemana}+ dias na mesma semana, {lim.em30Dias}+ dias em 30 dias
            ou {lim.semanasSeguidas}+ semanas seguidas com diária. É só um alerta: diária frequente e regular pode caracterizar vínculo.
          </p>
        )}
        {!habitualidade ? (
          <p className="extras-sub">Carregando…</p>
        ) : habitualidade.pessoas.length === 0 ? (
          <EmptyState title="Nenhuma pessoa de fora nos últimos 90 dias" description="Quando houver diárias de pessoas de fora, a frequência de cada uma aparece aqui." />
        ) : (
          <>
            {emRisco.length > 0 && (
              <Alert tone="warning" icon={<AlertTriangle size={16} />} className="extras-aviso">
                {emRisco.length === 1 ? "1 pessoa de fora está" : `${emRisco.length} pessoas de fora estão`} com frequência alta. Avalie espaçar as diárias ou registrar.
              </Alert>
            )}
            <Table className="extras-tabela">
              <Table.Head>
                <Table.Row>
                  <Table.Th>Pessoa</Table.Th>
                  <Table.Th style={{ textAlign: "right" }} title="Dias com diária nos últimos 30 dias">30 dias</Table.Th>
                  <Table.Th className="extras-ocultar-celular" style={{ textAlign: "right" }} title="Maior número de dias numa mesma semana (seg–dom), últimas 8 semanas">Maior semana</Table.Th>
                  <Table.Th className="extras-ocultar-celular" style={{ textAlign: "right" }} title="Semanas seguidas com pelo menos uma diária">Semanas seguidas</Table.Th>
                  <Table.Th>Situação</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {habitualidade.pessoas.map((p) => (
                  <Table.Row key={p.id}>
                    <Table.Td>
                      <strong>{p.nome}</strong>
                      {p.apelido && <div className="extras-sub">{p.apelido}</div>}
                    </Table.Td>
                    <Table.Td className="extras-num" style={{ textAlign: "right" }}>{p.diasUltimos30}</Table.Td>
                    <Table.Td className="extras-ocultar-celular extras-num" style={{ textAlign: "right" }}>{p.maiorSemana}</Table.Td>
                    <Table.Td className="extras-ocultar-celular extras-num" style={{ textAlign: "right" }}>{p.semanasSeguidas}</Table.Td>
                    <Table.Td>
                      {p.emRisco
                        ? <><StatusBadge tone="warning">Frequência alta</StatusBadge><div className="extras-sub">{p.motivos.join(" · ")}</div></>
                        : <StatusBadge tone="neutral">Dentro do limite</StatusBadge>}
                    </Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </>
        )}
      </section>
    </div>
  );
}
