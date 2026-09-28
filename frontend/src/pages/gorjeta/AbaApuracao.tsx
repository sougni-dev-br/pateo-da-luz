import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { TipComputation, TipComputedParticipant, TipValeType } from "../../api/client";
import { Button, FormField, Money, StatusBadge, Table } from "../../design-system";
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

const VALE_TYPES = Object.keys(VALE_LABELS) as TipValeType[];

function Ocorrencia({ value, escala, manual, disabled, label, onChange }: {
  value: string; escala: number; manual: boolean; disabled: boolean; label: string; onChange: (v: string) => void;
}) {
  return (
    <input
      style={{ ...numInputStyle, width: 48, fontWeight: manual ? 600 : 400 }}
      type="number" min="0" step="1" value={value} disabled={disabled} aria-label={label}
      placeholder={escala ? String(escala) : "0"}
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

  async function lancarVale() {
    if (!aberto?.participantId) return;
    const amount = Number(novoVale.amount.replace(",", "."));
    if (!amount || amount <= 0) return;
    await onAddVale(aberto.participantId, { type: novoVale.type, amount, date: novoVale.date || undefined, notes: novoVale.notes || undefined });
    setNovoVale({ type: "ADIANTAMENTO", amount: "", date: "", notes: "" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.Th minWidth={200}>Funcionário</Table.Th>
            <Table.Th>Base</Table.Th>
            <Table.Th>Faltas</Table.Th>
            <Table.Th>Atest.</Table.Th>
            <Table.Th>Férias</Table.Th>
            <Table.Th>Outros</Table.Th>
            <Table.Th>Previstos</Table.Th>
            <Table.Th>Dias</Table.Th>
            <Table.Th>Apurados</Table.Th>
            <Table.Th>Ajuste ±</Table.Th>
            <Table.Th>Pontos</Table.Th>
            <Table.Th>Gorjeta</Table.Th>
            <Table.Th>Vales</Table.Th>
            <Table.Th>Líquido</Table.Th>
            <Table.Th> </Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {participantes.map((p) => {
            const r = rowPorFuncionario.get(p.employeeId);
            if (!r) return null;
            const fora = p.tipoCalculo === "FORA_DO_PERIODO";
            const set = (patch: Partial<LocalRow>) => onRow(p.employeeId, patch);
            return (
              <Table.Row key={p.employeeId} style={fora ? { opacity: 0.55 } : undefined}>
                <Table.Td>
                  <div style={{ fontWeight: 500 }}>{p.employeeName}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                    {p.functionName && <span style={mutedStyle}>{p.functionName}</span>}
                    {p.semRegistro && <StatusBadge tone="warning">Sem registro</StatusBadge>}
                    {p.reserva && <StatusBadge tone="info">Reserva</StatusBadge>}
                    {p.terminationDate && p.tipoCalculo !== "MES" && <StatusBadge tone="neutral">Saída {fmtDate(p.terminationDate)}</StatusBadge>}
                  </div>
                </Table.Td>
                <Table.Td>
                  {p.kind === "FIXO"
                    ? <input style={{ ...numInputStyle, width: 90 }} type="number" step="0.01" value={r.fixedAmount} disabled={readonly}
                        aria-label="Cota fixa" title="Cota fixa em R$" onChange={(e) => set({ fixedAmount: e.target.value })} />
                    : pts(p.basePoints)}
                </Table.Td>
                <Table.Td><Ocorrencia label="Faltas" value={r.faltas} escala={p.faltasOrigem === "ESCALA" ? p.faltas : 0} manual={r.faltas !== ""} disabled={readonly} onChange={(v) => set({ faltas: v })} /></Table.Td>
                <Table.Td><Ocorrencia label="Atestados" value={r.atestados} escala={p.atestadosOrigem === "ESCALA" ? p.atestados : 0} manual={r.atestados !== ""} disabled={readonly} onChange={(v) => set({ atestados: v })} /></Table.Td>
                <Table.Td><Ocorrencia label="Férias" value={r.ferias} escala={p.feriasOrigem === "ESCALA" ? p.ferias : 0} manual={r.ferias !== ""} disabled={readonly} onChange={(v) => set({ ferias: v })} /></Table.Td>
                <Table.Td><Ocorrencia label="Outros dias" value={r.outrosDias} escala={0} manual={r.outrosDias !== ""} disabled={readonly} onChange={(v) => set({ outrosDias: v })} /></Table.Td>
                <Table.Td>
                  <input style={{ ...numInputStyle, width: 52 }} type="number" min="0" step="1" value={r.diasPrevistosOverride} disabled={readonly}
                    aria-label="Dias previstos" placeholder={String(p.diasPrevistos)}
                    title={`Calculado: ${p.diasElegiveis} dias no vínculo. Preencha só para corrigir.`}
                    onChange={(e) => set({ diasPrevistosOverride: e.target.value })} />
                </Table.Td>
                <Table.Td title={`Fator de presença ${(p.fatorPresenca * 100).toFixed(0)}%`}>{p.diasComputados}/{p.diasPrevistos}</Table.Td>
                <Table.Td>{p.kind === "PONTOS" ? pts(p.pontosApurados) : "—"}</Table.Td>
                <Table.Td>
                  {p.kind === "PONTOS"
                    ? <input style={{ ...numInputStyle, width: 60 }} type="number" step="0.5" value={r.pointsAdjustment} disabled={readonly || fora}
                        aria-label="Ajuste de pontos" placeholder="0" title="Acréscimo (+) ou desconto (−) do mês, sem mudar a base"
                        onChange={(e) => set({ pointsAdjustment: e.target.value })} />
                    : "—"}
                </Table.Td>
                <Table.Td style={{ fontWeight: 600 }}>{p.kind === "PONTOS" ? pts(p.points) : "—"}</Table.Td>
                <Table.Td title={p.tipoCalculo === "MES" ? undefined : `Valor do ponto da rescisão: ${money(p.valorPonto)}`}>
                  {p.rescisaoPendente ? <span style={{ color: "var(--warning, #b45309)" }}>pendente</span> : <Money value={p.rateioAmount} />}
                </Table.Td>
                <Table.Td>
                  <button type="button" onClick={() => setValesDe(valesDe === p.participantId ? null : p.participantId)} disabled={!p.participantId}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, background: "transparent", color: "inherit", padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
                    {p.descontos || p.creditos ? money(p.creditos - p.descontos) : "—"} ▾
                  </button>
                </Table.Td>
                <Table.Td style={{ fontWeight: 600 }}><Money value={p.netCommission} /></Table.Td>
                <Table.Td>
                  {!readonly && (
                    <button type="button" onClick={() => onRemove(p)} aria-label={`Remover ${p.employeeName}`}
                      style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </Table.Td>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
      <span style={mutedStyle}>
        Ocorrências vazias usam a Escala (o número cinza). Digite só para corrigir. Pontos = base × dias ÷ previstos + ajuste.
      </span>

      {aberto && (
        <div style={panelStyle}>
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
                <input style={{ ...inputStyle, width: 110 }} type="number" step="0.01" min="0" value={novoVale.amount} onChange={(e) => setNovoVale({ ...novoVale, amount: e.target.value })} />
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
                    <Table.Td>{quitada ? "—" : money(p.valorPonto)}</Table.Td>
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
            </Table.Body>
          </Table>
        </div>
      )}
    </div>
  );
}
