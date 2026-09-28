import { Plus, ReceiptText, Trash2 } from "lucide-react";
import { Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { TipComputation, TipComputedParticipant, TipValeType } from "../../api/client";
import { Button, FormField, Money, StatusBadge, Table } from "../../design-system";
import "./gorjeta.css";
import {
  type LocalRow, type RowPatch, VALE_LABELS, fmtDate, inputStyle, money, mutedStyle, numInputStyle, ordenar, panelStyle, pts,
} from "./gorjetaUtils";

type Props = {
  comp: TipComputation;
  rows: LocalRow[];
  readonly: boolean;
  onRow: RowPatch;
  onRemove: (p: TipComputedParticipant) => void;
  onAddVale: (participantId: string, vale: { type: TipValeType; amount: number; date?: string; notes?: string }) => Promise<void>;
  onRemoveVale: (valeId: string) => void;
};

const num: CSSProperties = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
// O nome fica visível ao rolar a tabela para o lado.
const colunaNome: CSSProperties = { position: "sticky", left: 0, zIndex: 1, background: "var(--surface, #fff)", boxShadow: "1px 0 0 var(--border)" };
const grupoTh: CSSProperties = { borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, letterSpacing: ".04em" };
const grupoTd: CSSProperties = { background: "var(--paper-soft, #f2f4f7)", padding: "8px 12px" };
const totalTd: CSSProperties = { background: "var(--paper-soft, #f2f4f7)", fontWeight: 700, borderTop: "2px solid var(--line-strong, #c8d0da)" };

const somaPontos = (l: TipComputedParticipant[]) => l.reduce((a, p) => a + (p.kind === "PONTOS" ? p.points : 0), 0);
const somaGorjeta = (l: TipComputedParticipant[]) => l.reduce((a, p) => a + p.rateioAmount, 0);

const VALE_TYPES = Object.keys(VALE_LABELS) as TipValeType[];

function Ocorrencia({ value, escala, manual, disabled, label, onChange }: {
  value: string; escala: number; manual: boolean; disabled: boolean; label: string; onChange: (v: string) => void;
}) {
  return (
    <input
      style={{ ...numInputStyle, width: 40, textAlign: "center", fontWeight: manual ? 700 : 400 }}
      type="number" min="0" step="1" value={value} disabled={disabled} aria-label={label}
      placeholder={escala ? String(escala) : ""}
      title={manual ? "Digitado — apague para voltar a usar a Escala" : "Vazio = usa a Escala"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function AbaApuracao({ comp, rows, readonly, onRow, onRemove, onAddVale, onRemoveVale }: Props) {
  const [valesDe, setValesDe] = useState<string | null>(null);
  const [novoVale, setNovoVale] = useState<{ type: TipValeType; amount: string; date: string; notes: string }>({ type: "ADIANTAMENTO", amount: "", date: "", notes: "" });

  const rowPorFuncionario = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const participantes = useMemo(() => ordenar(comp.participants), [comp]);
  const rescisoes = participantes.filter((p) => p.tipoCalculo === "RESCISAO" || p.tipoCalculo === "RESCISAO_QUITADA");
  const aberto = comp.participants.find((p) => p.participantId === valesDe) ?? null;
  const painelVales = useRef<HTMLDivElement>(null);
  const valorVale = useRef<HTMLInputElement>(null);
  // O painel abre abaixo da tabela: rola até ele e já deixa o cursor no valor.
  useEffect(() => {
    if (!valesDe) return;
    painelVales.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    valorVale.current?.focus({ preventScroll: true });
  }, [valesDe]);

  async function lancarVale() {
    if (!aberto?.participantId) return;
    const amount = Number(novoVale.amount.replace(",", "."));
    if (!amount || amount <= 0) return;
    await onAddVale(aberto.participantId, { type: novoVale.type, amount, date: novoVale.date || undefined, notes: novoVale.notes || undefined });
    setNovoVale({ type: "ADIANTAMENTO", amount: "", date: "", notes: "" });
  }

  const grupos = [
    { chave: "mes", titulo: "No mês", nota: null as string | null, lista: participantes.filter((p) => p.tipoCalculo === "MES") },
    { chave: "resc", titulo: "Desligados no período", nota: "Valor do ponto próprio: serviço até a saída, menos a retenção, ÷ 100. Detalhes em \"Rescisões do período\", abaixo.",
      lista: participantes.filter((p) => p.tipoCalculo === "RESCISAO" || p.tipoCalculo === "RESCISAO_QUITADA") },
    { chave: "fora", titulo: "Fora do período", nota: "Saíram antes do início do período: não recebem nesta competência.",
      lista: participantes.filter((p) => p.tipoCalculo === "FORA_DO_PERIODO") },
  ];
  const totalVales = participantes.reduce((a, p) => a + p.creditos - p.descontos, 0);

  function linha(p: TipComputedParticipant) {
    const r = rowPorFuncionario.get(p.employeeId);
    if (!r) return null;
    const fora = p.tipoCalculo === "FORA_DO_PERIODO";
    const set = (patch: Partial<LocalRow>) => onRow(p.employeeId, patch);
    const aberto = valesDe === p.participantId;
    const saldoVales = p.creditos - p.descontos;
    return (
      <Table.Row key={p.employeeId} style={fora ? { opacity: 0.55 } : undefined}>
        <Table.Td style={colunaNome}>
          <div style={{ fontWeight: 500 }}>{p.employeeName}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2, alignItems: "center" }}>
            {p.functionName && <span style={mutedStyle}>{p.functionName}</span>}
            {p.semRegistro && <StatusBadge tone="warning">Sem registro</StatusBadge>}
            {p.reserva && <StatusBadge tone="info">Reserva</StatusBadge>}
            {p.terminationDate && p.tipoCalculo !== "MES" && <StatusBadge tone="neutral">Saída {fmtDate(p.terminationDate)}</StatusBadge>}
          </div>
        </Table.Td>
        <Table.Td align="right" style={num}>
          {p.kind === "FIXO"
            ? <input style={{ ...numInputStyle, width: 90 }} type="number" step="0.01" value={r.fixedAmount} disabled={readonly}
                aria-label="Cota fixa" title="Cota fixa em R$" onChange={(e) => set({ fixedAmount: e.target.value })} />
            : pts(p.basePoints)}
        </Table.Td>
        <Table.Td align="center"><Ocorrencia label="Faltas" value={r.faltas} escala={p.faltasOrigem === "ESCALA" ? p.faltas : 0} manual={r.faltas !== ""} disabled={readonly} onChange={(v) => set({ faltas: v })} /></Table.Td>
        <Table.Td align="center"><Ocorrencia label="Atestados" value={r.atestados} escala={p.atestadosOrigem === "ESCALA" ? p.atestados : 0} manual={r.atestados !== ""} disabled={readonly} onChange={(v) => set({ atestados: v })} /></Table.Td>
        <Table.Td align="center"><Ocorrencia label="Férias" value={r.ferias} escala={p.feriasOrigem === "ESCALA" ? p.ferias : 0} manual={r.ferias !== ""} disabled={readonly} onChange={(v) => set({ ferias: v })} /></Table.Td>
        <Table.Td align="center"><Ocorrencia label="Outros dias" value={r.outrosDias} escala={0} manual={r.outrosDias !== ""} disabled={readonly} onChange={(v) => set({ outrosDias: v })} /></Table.Td>
        <Table.Td align="center" title={`Presença ${(p.fatorPresenca * 100).toFixed(0)}% · ${p.diasElegiveis} dias corridos no vínculo`}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, ...num }}>
            <strong style={{ color: p.diasComputados < p.diasPrevistos ? "var(--warning)" : undefined }}>{p.diasComputados}</strong>
            <span style={{ color: "var(--muted)" }}>/</span>
            <input style={{ ...numInputStyle, width: 38, textAlign: "center", fontWeight: r.diasPrevistosOverride ? 700 : 400 }}
              type="number" min="0" step="1" value={r.diasPrevistosOverride} disabled={readonly}
              aria-label="Dias previstos" placeholder={String(p.diasPrevistos)}
              title="Dias previstos. Preencha só para corrigir o cálculo."
              onChange={(e) => set({ diasPrevistosOverride: e.target.value })} />
          </span>
        </Table.Td>
        <Table.Td align="center">
          {p.kind === "PONTOS"
            ? <input style={{ ...numInputStyle, width: 52, textAlign: "center", fontWeight: p.pointsAdjustment ? 700 : 400, color: p.pointsAdjustment < 0 ? "var(--danger)" : p.pointsAdjustment > 0 ? "var(--success)" : undefined }}
                type="number" step="0.5" value={r.pointsAdjustment} disabled={readonly || fora}
                aria-label="Ajuste de pontos" placeholder="0" title="Acréscimo (+) ou desconto (−) do mês, sem mudar a base"
                onChange={(e) => set({ pointsAdjustment: e.target.value })} />
            : "—"}
        </Table.Td>
        <Table.Td align="right" style={{ ...num, fontWeight: 700 }}
          title={p.kind === "PONTOS" ? `${pts(p.basePoints)} × ${p.diasComputados}/${p.diasPrevistos} = ${pts(p.pontosApurados)}${p.pointsAdjustment ? ` ${p.pointsAdjustment > 0 ? "+" : "−"} ${pts(Math.abs(p.pointsAdjustment))}` : ""}` : undefined}>
          {p.kind === "PONTOS" ? pts(p.points) : "—"}
          {p.kind === "PONTOS" && p.pontosApurados !== p.basePoints && (
            <div style={{ ...mutedStyle, fontSize: 11, fontWeight: 400 }}>de {pts(p.basePoints)}</div>
          )}
        </Table.Td>
        <Table.Td align="right" style={num}>
          {p.rescisaoPendente
            ? <StatusBadge tone="warning">pendente</StatusBadge>
            : <>
                <Money value={p.rateioAmount} />
                {p.tipoCalculo === "RESCISAO" && <div style={{ ...mutedStyle, fontSize: 11 }}>ponto {money(p.valorPonto)}</div>}
                {p.tipoCalculo === "RESCISAO_QUITADA" && <div style={{ ...mutedStyle, fontSize: 11 }}>quitada</div>}
              </>}
        </Table.Td>
        <Table.Td align="right" style={{ ...num, fontWeight: 700 }}>
          <Money value={p.netCommission} />
          {saldoVales !== 0 && (
            <div style={{ fontSize: 11, fontWeight: 400, color: saldoVales < 0 ? "var(--danger)" : "var(--success)" }}>vales {money(saldoVales)}</div>
          )}
        </Table.Td>
        <Table.Td style={{ whiteSpace: "nowrap" }}>
          <button type="button" onClick={() => setValesDe(aberto ? null : p.participantId)} disabled={!p.participantId}
            aria-expanded={aberto} aria-label={`Vales e créditos de ${p.employeeName}`} title="Vales e créditos"
            style={{ border: "none", borderRadius: 6, background: aberto ? "var(--paper-soft)" : "transparent", cursor: "pointer", color: p.vales.length ? "var(--ink)" : "var(--muted)", padding: 4, position: "relative" }}>
            <ReceiptText size={15} />
            {p.vales.length > 0 && (
              <span style={{ position: "absolute", top: -2, right: -2, fontSize: 10, lineHeight: "14px", minWidth: 14, borderRadius: 7, background: "var(--gold)", color: "#fff", textAlign: "center" }}>{p.vales.length}</span>
            )}
          </button>
          {!readonly && (
            <button type="button" onClick={() => onRemove(p)} aria-label={`Remover ${p.employeeName}`} title="Tirar deste período"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}>
              <Trash2 size={15} />
            </button>
          )}
        </Table.Td>
      </Table.Row>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Table className="tabela-rateio">
        <Table.Head>
          <Table.Row>
            <Table.Th rowSpan={2} minWidth={190} style={colunaNome}>Funcionário</Table.Th>
            <Table.Th rowSpan={2} align="right">Base</Table.Th>
            <Table.Th colSpan={4} align="center" style={grupoTh}>Ocorrências (dias)</Table.Th>
            <Table.Th rowSpan={2} align="center" title="Dias trabalhados / previstos no vínculo (26 no mês cheio)">Dias</Table.Th>
            <Table.Th colSpan={2} align="center" style={grupoTh}>Pontos</Table.Th>
            <Table.Th colSpan={2} align="center" style={grupoTh}>Valores</Table.Th>
            <Table.Th rowSpan={2}> </Table.Th>
          </Table.Row>
          <Table.Row>
            <Table.Th align="center">Falta</Table.Th>
            <Table.Th align="center">Atest.</Table.Th>
            <Table.Th align="center">Férias</Table.Th>
            <Table.Th align="center">Outros</Table.Th>
            <Table.Th align="center">Ajuste ±</Table.Th>
            <Table.Th align="right">Finais</Table.Th>
            <Table.Th align="right">Gorjeta</Table.Th>
            <Table.Th align="right">Líquido</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {grupos.map((g) => g.lista.length > 0 && (
            <Fragment key={g.chave}>
              <Table.Row>
                <Table.Td colSpan={11} style={grupoTd}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", position: "sticky", left: 12, width: "fit-content" }}>
                    <strong>{g.titulo}</strong>
                    <span style={{ color: "var(--muted)" }}>{g.lista.length} {g.lista.length === 1 ? "pessoa" : "pessoas"}</span>
                    <span style={num}>· {pts(somaPontos(g.lista))} pts · <strong>{money(somaGorjeta(g.lista))}</strong></span>
                  </div>
                  {g.nota && <div style={{ ...mutedStyle, marginTop: 2 }}>{g.nota}</div>}
                </Table.Td>
              </Table.Row>
              {g.lista.map(linha)}
            </Fragment>
          ))}
          <Table.Row>
            <Table.Td style={{ ...colunaNome, ...totalTd }}>Total distribuído</Table.Td>
            <Table.Td colSpan={6} style={totalTd}> </Table.Td>
            <Table.Td align="right" style={{ ...totalTd, ...num }}>{pts(somaPontos(participantes))}</Table.Td>
            <Table.Td align="right" style={{ ...totalTd, ...num }}>{money(somaGorjeta(participantes))}</Table.Td>
            <Table.Td align="right" style={{ ...totalTd, ...num }}>
              {money(participantes.reduce((a, p) => a + p.netCommission, 0))}
              {totalVales !== 0 && <div style={{ ...mutedStyle, fontSize: 11, fontWeight: 400 }}>vales {money(totalVales)}</div>}
            </Table.Td>
            <Table.Td style={totalTd}> </Table.Td>
          </Table.Row>
        </Table.Body>
      </Table>
      <span style={mutedStyle}>
        Ocorrências em cinza vêm da Escala; digite só para corrigir (em negrito = digitado). Pontos finais = base × trabalhados ÷ previstos + ajuste.
        O total distribuído é o mesmo do resumo acima.
      </span>

      {aberto && (
        <div ref={painelVales} style={panelStyle}>
          <strong>Vales e créditos — {aberto.employeeName}</strong>
          {aberto.vales.length === 0 && <span style={mutedStyle}>Nada lançado.</span>}
          {aberto.vales.map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ minWidth: 150 }}>{VALE_LABELS[v.type]}</span>
              <span style={{ minWidth: 110, color: v.type === "CREDITO" ? "var(--success, #15803d)" : undefined }}>
                {v.type === "CREDITO" ? "+ " : "− "}{money(v.amount)}
              </span>
              <span style={{ ...mutedStyle, minWidth: 60 }}>{fmtDate(v.date)}</span>
              <span style={mutedStyle}>{v.notes}</span>
              {!readonly && (
                <button type="button" onClick={() => onRemoveVale(v.id)} aria-label="Remover lançamento"
                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {!readonly && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <FormField label="Tipo">
                <select style={{ ...inputStyle, width: 170 }} value={novoVale.type} onChange={(e) => setNovoVale({ ...novoVale, type: e.target.value as TipValeType })}>
                  {VALE_TYPES.map((t) => <option key={t} value={t}>{VALE_LABELS[t]}</option>)}
                </select>
              </FormField>
              <FormField label="Valor R$">
                <input ref={valorVale} style={{ ...inputStyle, width: 110 }} type="number" step="0.01" min="0" value={novoVale.amount} onChange={(e) => setNovoVale({ ...novoVale, amount: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") void lancarVale(); }} />
              </FormField>
              <FormField label="Data">
                <input style={{ ...inputStyle, width: 150 }} type="date" value={novoVale.date} onChange={(e) => setNovoVale({ ...novoVale, date: e.target.value })} />
              </FormField>
              <FormField label="Descrição">
                <input style={{ ...inputStyle, width: 200 }} value={novoVale.notes} onChange={(e) => setNovoVale({ ...novoVale, notes: e.target.value })} />
              </FormField>
              <Button variant="secondary" leadingIcon={<Plus size={14} />} disabled={!novoVale.amount} onClick={() => void lancarVale()}>Lançar</Button>
            </div>
          )}
        </div>
      )}

      {rescisoes.length > 0 && (
        <div style={panelStyle}>
          <strong>Rescisões do período</strong>
          <span style={mutedStyle}>
            O valor do ponto de quem saiu usa o serviço arrecadado até a data da saída (puxado do faturamento). Se a gorjeta já foi paga
            na rescisão, informe o valor quitado: ele fica congelado e não muda com o serviço do mês.
          </span>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={180}>Funcionário</Table.Th>
                <Table.Th>Saída</Table.Th>
                <Table.Th>Serviço até a saída</Table.Th>
                <Table.Th>Valor do ponto</Table.Th>
                <Table.Th>Pontos</Table.Th>
                <Table.Th>Gorjeta calculada</Table.Th>
                <Table.Th>Valor quitado</Table.Th>
                <Table.Th>Situação</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {rescisoes.map((p) => {
                const r = rowPorFuncionario.get(p.employeeId);
                if (!r) return null;
                const quitada = p.tipoCalculo === "RESCISAO_QUITADA";
                return (
                  <Table.Row key={p.employeeId}>
                    <Table.Td style={{ fontWeight: 500 }}>{p.employeeName}</Table.Td>
                    <Table.Td>{fmtDate(p.terminationDate)}</Table.Td>
                    <Table.Td>
                      <input style={{ ...numInputStyle, width: 110 }} type="number" step="0.01" min="0" value={r.rescisaoServicoBruto}
                        disabled={readonly || quitada} aria-label="Serviço bruto até a saída"
                        placeholder={p.rescisaoServicoOrigem === "FATURAMENTO" && p.rescisaoServicoBruto != null ? p.rescisaoServicoBruto.toFixed(2) : ""}
                        title="Vazio = soma do faturamento do início do período até a saída"
                        onChange={(e) => onRow(p.employeeId, { rescisaoServicoBruto: e.target.value })} />
                    </Table.Td>
                    <Table.Td>{quitada || p.rescisaoPendente ? "—" : money(p.valorPonto)}</Table.Td>
                    <Table.Td>{pts(p.points)}</Table.Td>
                    <Table.Td>{quitada ? "—" : p.rescisaoPendente ? "—" : money(p.rateioAmount)}</Table.Td>
                    <Table.Td>
                      <input style={{ ...numInputStyle, width: 100 }} type="number" step="0.01" min="0" value={r.rescisaoValorFixo}
                        disabled={readonly} aria-label="Valor quitado na rescisão"
                        onChange={(e) => onRow(p.employeeId, { rescisaoValorFixo: e.target.value })} />
                    </Table.Td>
                    <Table.Td>
                      {quitada ? <StatusBadge tone="success">Quitada</StatusBadge>
                        : p.rescisaoPendente ? <StatusBadge tone="warning">Falta o serviço</StatusBadge>
                        : <StatusBadge tone="info">Calculada</StatusBadge>}
                    </Table.Td>
                  </Table.Row>
                );
              })}
              <Table.Row>
                <Table.Td style={totalTd}>Total das rescisões</Table.Td>
                <Table.Td colSpan={4} style={totalTd}> </Table.Td>
                <Table.Td align="right" style={{ ...totalTd, ...num }} colSpan={2}>{money(rescisoes.reduce((a, p) => a + p.rateioAmount, 0))}</Table.Td>
                <Table.Td style={totalTd}>{rescisoes.some((p) => p.rescisaoPendente) ? <StatusBadge tone="warning">com pendência</StatusBadge> : " "}</Table.Td>
              </Table.Row>
            </Table.Body>
          </Table>
        </div>
      )}
    </div>
  );
}
