import { ReceiptText, Settings2, Trash2 } from "lucide-react";
import { Fragment, type CSSProperties, useMemo, useState } from "react";
import type { TipComputation, TipComputedParticipant } from "../../api/client";
import { Money, StatusBadge, Table } from "../../design-system";
import "./gorjeta.css";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { RegrasPessoa, temRegraPropria } from "./RegrasPessoa";
import { ReciboRescisao, SeloRecibo } from "./ReciboRescisao";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";
import {
  type LocalRow, type RowPatch, fmtDate, money, mutedStyle, numInputStyle, ordenar, panelStyle, pts,
} from "./gorjetaUtils";

type Props = {
  /** Abre a aba Vales (filtrada na pessoa). */
  onVerVales: (participantId: string | null) => void;
  /** Leitura do termo de rescisão (TRCT) da contabilidade. */
  recibo: { antesDeGravar: () => Promise<void>; onAplicado: (c: TipComputation) => void; onErro: (m: string) => void };
  comp: TipComputation;
  rows: LocalRow[];
  readonly: boolean;
  onRow: RowPatch;
  onRemove: (p: TipComputedParticipant) => void;
};

const num: CSSProperties = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
// Separa visualmente presença | pontos | valores sem precisar de uma segunda linha de cabeçalho.
const inicioBloco: CSSProperties = { borderLeft: "1px solid var(--line)" };
const grupoTd: CSSProperties = { background: "var(--paper-soft, #f2f4f7)", padding: "6px 10px", textAlign: "left" };
const totalTd: CSSProperties = { background: "var(--paper-soft, #f2f4f7)", fontWeight: 700, borderTop: "2px solid var(--line-strong, #c8d0da)" };

const somaPontos = (l: TipComputedParticipant[]) => l.reduce((a, p) => a + (p.kind === "PONTOS" ? p.points : 0), 0);
const somaGorjeta = (l: TipComputedParticipant[]) => l.reduce((a, p) => a + p.rateioAmount, 0);


const SITUACAO: Record<string, number> = { MES: 0, RESCISAO: 1, RESCISAO_QUITADA: 1, FORA_DO_PERIODO: 2 };

// O que cada coluna ordena. Vale sempre o número efetivo (o da Escala ou o digitado).
const EXTRATORES: Extratores<TipComputedParticipant> = {
  nome: (p) => p.employeeName,
  funcao: (p) => p.functionName,
  empresa: (p) => (p.semRegistro ? "Sem registro" : p.companyName),
  situacao: (p) => SITUACAO[p.tipoCalculo],
  base: (p) => (p.kind === "PONTOS" ? p.basePoints : null),
  faltas: (p) => p.faltas,
  atestados: (p) => p.atestados,
  ferias: (p) => p.ferias,
  outros: (p) => p.outrosDias,
  dias: (p) => p.diasComputados,
  ajuste: (p) => p.pointsAdjustment,
  pontos: (p) => (p.kind === "PONTOS" ? p.points : null),
  gorjeta: (p) => p.rateioAmount,
  vales: (p) => p.creditos - p.descontos,
  liquido: (p) => p.netCommission,
};

const OPCOES_ORDEM: Array<[string, string]> = [
  ["nome", "Nome"], ["funcao", "Função"], ["empresa", "Empresa"], ["situacao", "Situação"], ["base", "Pontos-base"],
  ["faltas", "Faltas"], ["atestados", "Atestados"], ["ferias", "Férias"], ["outros", "Outros dias"], ["dias", "Dias trabalhados"],
  ["ajuste", "Ajuste"], ["pontos", "Pontos finais"], ["gorjeta", "Gorjeta"], ["vales", "Vales"], ["liquido", "Líquido"],
];
const TEXTO = new Set(["nome", "funcao", "empresa", "situacao"]);

const COLUNAS: ColunaOpcional[] = [
  { chave: "base", rotulo: "Base" }, { chave: "faltas", rotulo: "Faltas" }, { chave: "atestados", rotulo: "Atestados" },
  { chave: "ferias", rotulo: "Férias" }, { chave: "outros", rotulo: "Outros dias" }, { chave: "dias", rotulo: "Dias" },
  { chave: "ajuste", rotulo: "Ajuste" }, { chave: "pontos", rotulo: "Pontos" }, { chave: "gorjeta", rotulo: "Gorjeta" },
  { chave: "liquido", rotulo: "Gorjeta líquida" },
];
// Colunas antes de "Pontos": na linha de total elas viram um espaço em branco só.
const ANTES_DOS_PONTOS = ["base", "faltas", "atestados", "ferias", "outros", "dias", "ajuste"];

function Ocorrencia({ value, escala, manual, disabled, label, onChange, desconta = true }: {
  value: string; escala: number; manual: boolean; disabled: boolean; label: string; onChange: (v: string) => void; desconta?: boolean;
}) {
  return (
    <input
      style={{ ...numInputStyle, width: 40, textAlign: "center", fontWeight: manual ? 700 : 400,
        textDecoration: desconta ? undefined : "line-through", color: desconta ? undefined : "var(--muted)" }}
      type="number" min="0" max="31" step="1" value={value} disabled={disabled} aria-label={label}
      placeholder={escala ? String(escala) : ""}
      title={(manual ? "Digitado — apague para voltar a usar a Escala" : "Vazio = usa a Escala") + (desconta ? "" : ". Não desconta para esta pessoa.")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const SITUACAO_CONTA: Record<"PENDING" | "PAID" | "OVERDUE", { rotulo: string; tom: "success" | "warning" | "neutral" }> = {
  PAID: { rotulo: "paga", tom: "success" }, PENDING: { rotulo: "a vencer", tom: "neutral" }, OVERDUE: { rotulo: "sem baixa", tom: "warning" },
};

// A rescisão que a Folha lançou em Contas a Pagar para quem saiu no período.
function RescisaoLancada({ r }: { r: TipComputedParticipant["rescisaoContasPagar"] }) {
  if (!r) return <StatusBadge tone="warning" title="Lance em Folha → Rescisão">não lançada</StatusBadge>;
  const s = SITUACAO_CONTA[r.status];
  return (
    <div>
      {r.valor != null && <div style={{ fontWeight: 600 }}>{money(r.valor)}</div>}
      <div style={mutedStyle}>
        vence {fmtDate(r.vencimento)}{r.parcelas > 1 ? ` · ${r.parcelas} parcelas` : ""}
      </div>
      <StatusBadge tone={s.tom} title={r.status === "OVERDUE" ? "Vencida sem baixa em Contas a Pagar" : undefined}>{s.rotulo}</StatusBadge>
    </div>
  );
}

export function AbaApuracao({ comp, rows, readonly, onRow, onRemove, onVerVales, recibo }: Props) {
  const [regrasDe, setRegrasDe] = useState<string | null>(null);

  const rowPorFuncionario = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const participantes = useMemo(() => ordenar(comp.participants), [comp]);
  const { ordem, alternar, definir } = useOrdenacao("apuracao");
  // No celular começa com o essencial (nome, pontos, gorjeta); o resto se liga em "Colunas".
  const colunas = useColunas("apuracao", ["faltas", "atestados", "ferias", "outros", "dias", "ajuste", "base"]);
  const v = colunas.visivel;
  const visiveis = COLUNAS.filter((c) => v(c.chave)).length;
  const brancoTotal = ANTES_DOS_PONTOS.filter(v).length;
  const [agrupar, setAgruparState] = useState(() => {
    try { return window.localStorage.getItem("gorjeta-agrupar") !== "nao"; } catch { return true; }
  });
  function setAgrupar(v: boolean) {
    setAgruparState(v);
    try { window.localStorage.setItem("gorjeta-agrupar", v ? "sim" : "nao"); } catch { /* só não lembra */ }
  }
  const ordenados = useMemo(() => aplicarOrdem(participantes, ordem, EXTRATORES), [participantes, ordem]);
  // Texto começa do A; número começa do maior, que é o que se costuma conferir.
  const ordenarPor = (coluna: string) => alternar(coluna, TEXTO.has(coluna) ? "asc" : "desc");
  const th = (coluna: string) => ({ coluna, ordem, onOrdenar: () => ordenarPor(coluna) });
  const rescisoes = participantes.filter((p) => p.tipoCalculo === "RESCISAO" || p.tipoCalculo === "RESCISAO_QUITADA");
  // Agrupado: a ordem vale dentro de cada grupo. Sem agrupar: uma lista só, como no Excel.
  const grupos = agrupar ? [
    { chave: "mes", titulo: "No mês", nota: null as string | null, lista: ordenados.filter((p) => p.tipoCalculo === "MES") },
    { chave: "resc", titulo: "Desligados no período", nota: "Valor do ponto próprio (serviço até a saída, menos a retenção, ÷ 100). O valor e os pontos das rescisões saem antes de dividir o restante entre quem fica.",
      lista: ordenados.filter((p) => p.tipoCalculo === "RESCISAO" || p.tipoCalculo === "RESCISAO_QUITADA") },
    { chave: "fora", titulo: "Fora do período", nota: "Saíram antes do início do período: não recebem nesta competência.",
      lista: ordenados.filter((p) => p.tipoCalculo === "FORA_DO_PERIODO") },
  ] : [{ chave: "todos", titulo: "Todos", nota: null as string | null, lista: ordenados }];
  const totalVales = participantes.reduce((a, p) => a + p.creditos - p.descontos, 0);

  function linha(p: TipComputedParticipant) {
    const r = rowPorFuncionario.get(p.employeeId);
    if (!r) return null;
    const fora = p.tipoCalculo === "FORA_DO_PERIODO";
    const set = (patch: Partial<LocalRow>) => onRow(p.employeeId, patch);
    const saldoVales = p.creditos - p.descontos;
    return (
      <Table.Row key={p.employeeId} style={fora ? { opacity: 0.55 } : undefined}>
        <Table.Td>
          <div style={{ fontWeight: 500 }}>{p.employeeName}</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2, alignItems: "center" }}>
            {p.functionName && <span style={mutedStyle}>{p.functionName}</span>}
            {p.semRegistro && <StatusBadge tone="warning">Sem registro</StatusBadge>}
            {p.terminationDate && p.tipoCalculo !== "MES" && <StatusBadge tone="neutral">Saída {fmtDate(p.terminationDate)}</StatusBadge>}
          </div>
        </Table.Td>
{v("base") && (
        <Table.Td align="center" style={num}>
          {p.kind === "FIXO"
            ? <input style={{ ...numInputStyle, width: 90 }} type="number" step="0.01" inputMode="decimal" value={r.fixedAmount} disabled={readonly}
                aria-label="Cota fixa" title="Cota fixa em R$" onChange={(e) => set({ fixedAmount: e.target.value })} />
            : pts(p.basePoints)}
        </Table.Td>
)}
{v("faltas") && (
        <Table.Td align="center" style={inicioBloco}><Ocorrencia label="Faltas" desconta={p.regrasEfetivas.descontaFalta} value={r.faltas} escala={p.faltasOrigem === "ESCALA" ? p.faltas : 0} manual={r.faltas !== ""} disabled={readonly} onChange={(v) => set({ faltas: v })} /></Table.Td>
)}
{v("atestados") && (
        <Table.Td align="center"><Ocorrencia label="Atestados" desconta={p.regrasEfetivas.descontaAtestado} value={r.atestados} escala={p.atestadosOrigem === "ESCALA" ? p.atestados : 0} manual={r.atestados !== ""} disabled={readonly} onChange={(v) => set({ atestados: v })} /></Table.Td>
)}
{v("ferias") && (
        <Table.Td align="center"><Ocorrencia label="Férias" desconta={p.regrasEfetivas.descontaFerias} value={r.ferias} escala={p.feriasOrigem === "ESCALA" ? p.ferias : 0} manual={r.ferias !== ""} disabled={readonly} onChange={(v) => set({ ferias: v })} /></Table.Td>
)}
{v("outros") && (
        <Table.Td align="center"><Ocorrencia label="Outros dias" desconta={p.regrasEfetivas.descontaOutros} value={r.outrosDias} escala={0} manual={r.outrosDias !== ""} disabled={readonly} onChange={(v) => set({ outrosDias: v })} /></Table.Td>
)}
{v("dias") && (
        <Table.Td align="center" title={`Presença ${(p.fatorPresenca * 100).toFixed(0)}% · ${p.diasElegiveis} dias corridos no vínculo${p.diasReferencia !== p.diasPrevistos ? ` · proporcional: ${p.diasComputados} de ${p.diasReferencia} dias do período` : ""}`}>
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
)}
{v("ajuste") && (
        <Table.Td align="center" style={inicioBloco}>
          {p.kind === "PONTOS"
            ? <input style={{ ...numInputStyle, width: 52, textAlign: "center", fontWeight: p.pointsAdjustment ? 700 : 400, color: p.pointsAdjustment < 0 ? "var(--danger)" : p.pointsAdjustment > 0 ? "var(--success)" : undefined }}
                type="number" step="0.5" value={r.pointsAdjustment} disabled={readonly || fora}
                aria-label="Ajuste de pontos" placeholder="0" title="Acréscimo (+) ou desconto (−) do mês, sem mudar a base"
                onChange={(e) => set({ pointsAdjustment: e.target.value })} />
            : "—"}
        </Table.Td>
)}
{v("pontos") && (
        <Table.Td align="center" style={{ ...num, fontWeight: 700 }}
          title={p.kind === "PONTOS" ? `${pts(p.basePoints)} × ${p.diasComputados}/${p.diasPrevistos} = ${pts(p.pontosApurados)}${p.pointsAdjustment ? ` ${p.pointsAdjustment > 0 ? "+" : "−"} ${pts(Math.abs(p.pointsAdjustment))}` : ""}` : undefined}>
          {p.kind === "PONTOS" ? pts(p.points) : "—"}
          {p.kind === "PONTOS" && p.pontosApurados !== p.basePoints && (
            <div style={{ ...mutedStyle, fontSize: 11, fontWeight: 400 }}>de {pts(p.basePoints)}</div>
          )}
        </Table.Td>
)}
{v("gorjeta") && (
        <Table.Td align="center" style={{ ...num, ...inicioBloco }}>
          {p.rescisaoPendente
            ? <StatusBadge tone="warning">pendente</StatusBadge>
            : <>
                <Money value={p.rateioAmount} />
                {p.tipoCalculo === "RESCISAO" && <div style={{ ...mutedStyle, fontSize: 11 }}>ponto {money(p.valorPonto)}</div>}
                {p.tipoCalculo === "RESCISAO_QUITADA" && <div style={{ ...mutedStyle, fontSize: 11 }}>quitada</div>}
              </>}
        </Table.Td>
)}
{v("liquido") && (
        <Table.Td align="center" style={{ ...num, fontWeight: 700 }}>
          <Money value={p.netCommission} />
          {saldoVales !== 0 && (
            <div style={{ fontSize: 11, fontWeight: 400, color: saldoVales < 0 ? "var(--danger)" : "var(--success)" }}>vales {money(saldoVales)}</div>
          )}
        </Table.Td>
)}
        <Table.Td style={{ whiteSpace: "nowrap", position: "relative" }}>
          <button type="button" onClick={() => setRegrasDe(regrasDe === p.employeeId ? null : p.employeeId)}
            aria-expanded={regrasDe === p.employeeId} aria-label={`Regras de presença de ${p.employeeName}`}
            title={temRegraPropria(p.regras) ? "Regras próprias desta pessoa" : "Regras de presença (seguindo o período)"}
            style={{ border: "none", borderRadius: 6, padding: 4, cursor: "pointer", position: "relative",
              background: regrasDe === p.employeeId ? "var(--paper-soft)" : "transparent",
              color: temRegraPropria(p.regras) ? "var(--gold)" : "var(--muted)" }}>
            <Settings2 size={15} />
          </button>
          {regrasDe === p.employeeId && (
            <RegrasPessoa comp={comp} p={p} regras={r.regras} disabled={readonly}
              onChange={(regras) => set({ regras })} onFechar={() => setRegrasDe(null)} />
          )}
          <button type="button" onClick={() => onVerVales(p.participantId)} disabled={!p.participantId}
            aria-label={`Vales de ${p.employeeName}`} title="Ver e lançar vales na aba Vales"
            style={{ border: "none", borderRadius: 6, background: "transparent", cursor: "pointer", color: p.vales.length ? "var(--ink)" : "var(--muted)", padding: 4, position: "relative" }}>
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

  // Cabeçalho das colunas: vem logo abaixo da faixa de cada grupo (grupo em cima, colunas embaixo).
  const cabecalho = (chave: string) => (
    <Table.Row key={`colunas-${chave}`} className="linha-colunas">
            <ThOrdenavel {...th("nome")} align="left" minWidth={190}>Funcionário</ThOrdenavel>
{v("base") && (
            <ThOrdenavel {...th("base")} align="center" title="Pontos da função + ponto extra do cadastro">Base</ThOrdenavel>
)}
{v("faltas") && (
            <ThOrdenavel {...th("faltas")} align="center" style={inicioBloco} title="Faltas injustificadas no período">Faltas</ThOrdenavel>
)}
{v("atestados") && (
            <ThOrdenavel {...th("atestados")} align="center" title="Atestados / afastamentos">Atest.</ThOrdenavel>
)}
{v("ferias") && (
            <ThOrdenavel {...th("ferias")} align="center">Férias</ThOrdenavel>
)}
{v("outros") && (
            <ThOrdenavel {...th("outros")} align="center">Outros</ThOrdenavel>
)}
{v("dias") && (
            <ThOrdenavel {...th("dias")} align="center" title="Dias trabalhados / previstos (26 no mês cheio)">Dias</ThOrdenavel>
)}
{v("ajuste") && (
            <ThOrdenavel {...th("ajuste")} align="center" style={inicioBloco} title="Acréscimo ou desconto de pontos no mês">Ajuste</ThOrdenavel>
)}
{v("pontos") && (
            <ThOrdenavel {...th("pontos")} align="center" title="Pontos finais: base × dias ÷ previstos + ajuste">Pontos</ThOrdenavel>
)}
{v("gorjeta") && (
            <ThOrdenavel {...th("gorjeta")} align="center" style={inicioBloco}>Gorjeta</ThOrdenavel>
)}
{v("liquido") && (
            <ThOrdenavel {...th("liquido")} align="center" title="Gorjeta − vales + créditos">Gorjeta líquida</ThOrdenavel>
)}
            <Table.Th aria-label="Ações"> </Table.Th>
    </Table.Row>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="barra-lista">
        <label className="barra-lista-campo">
          <span>Ordenar por</span>
          <select value={ordem?.coluna ?? ""}
            onChange={(e) => definir(e.target.value ? { coluna: e.target.value, direcao: TEXTO.has(e.target.value) ? "asc" : "desc" } : null)}>
            <option value="">Nome (padrão)</option>
            {OPCOES_ORDEM.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {ordem && (
          <>
            <button type="button" className="barra-lista-botao" onClick={() => definir({ coluna: ordem.coluna, direcao: ordem.direcao === "asc" ? "desc" : "asc" })}
              title="Inverter a ordem" aria-label={ordem.direcao === "asc" ? "Crescente — inverter" : "Decrescente — inverter"}>
              {ordem.direcao === "asc" ? "↑ A→Z / menor" : "↓ Z→A / maior"}
            </button>
            <button type="button" className="barra-lista-link" onClick={() => definir(null)}>limpar</button>
          </>
        )}
        <SeletorColunas colunas={COLUNAS} ocultas={colunas.ocultas} alternar={colunas.alternar} mostrarTodas={colunas.mostrarTodas} />
        <div className="barra-lista-segmento" role="group" aria-label="Visualização">
          <button type="button" aria-pressed={agrupar} onClick={() => setAgrupar(true)}>Por situação</button>
          <button type="button" aria-pressed={!agrupar} onClick={() => setAgrupar(false)}>Lista única</button>
        </div>
      </div>

      <Table className="tabela-gorjeta">
        <Table.Body>
          {grupos.map((g) => g.lista.length > 0 && (
            <Fragment key={g.chave}>
              <Table.Row>
                <Table.Td colSpan={visiveis + 2} style={grupoTd}>
                  <div className="grupo-cabecalho">
                    <strong>{g.titulo}</strong>
                    <span className="grupo-chip">{g.lista.length} {g.lista.length === 1 ? "pessoa" : "pessoas"}</span>
                    <span className="grupo-chip">{pts(somaPontos(g.lista))} pts</span>
                    <span className="grupo-chip grupo-chip-valor">{money(somaGorjeta(g.lista))}</span>
                  </div>
                  {g.nota && <div className="grupo-nota">{g.nota}</div>}
                </Table.Td>
              </Table.Row>
              {cabecalho(g.chave)}
              {g.lista.map(linha)}
            </Fragment>
          ))}
          <Table.Row>
            <Table.Td style={totalTd}>Total distribuído</Table.Td>
            {brancoTotal > 0 && <Table.Td colSpan={brancoTotal} style={totalTd}> </Table.Td>}
{v("pontos") && (
            <Table.Td align="center" style={{ ...totalTd, ...num }}>{pts(somaPontos(participantes))}</Table.Td>
)}
{v("gorjeta") && (
            <Table.Td align="center" style={{ ...totalTd, ...num }}>{money(somaGorjeta(participantes))}</Table.Td>
)}
{v("liquido") && (
            <Table.Td align="center" style={{ ...totalTd, ...num }}>
              {money(participantes.reduce((a, p) => a + p.netCommission, 0))}
              {totalVales !== 0 && <div style={{ ...mutedStyle, fontSize: 11, fontWeight: 400 }}>vales {money(totalVales)}</div>}
            </Table.Td>
)}
            <Table.Td style={totalTd}> </Table.Td>
          </Table.Row>
        </Table.Body>
      </Table>
      <span style={mutedStyle}>
        Ocorrências em cinza vêm da Escala; digite só para corrigir (em negrito = digitado). Pontos finais = base × trabalhados ÷ previstos + ajuste.
        O total distribuído é o mesmo do resumo acima.
      </span>

      {rescisoes.length > 0 && (
        <div style={panelStyle} id="rescisoes-do-periodo" tabIndex={-1}>
          <strong>Rescisões do período</strong>
          <span style={mutedStyle}>
            Informe a <strong>gorjeta paga</strong> de cada saída (digitada ou lida do termo) ou, sem ela, o serviço até a saída.
            A gorjeta paga vira pontos pelo valor do ponto do mês: o que sobrar do direito fica livre para distribuir; o que passar vira extra automático.
            CLT já recebeu na rescisão. Sem registro com a rescisão lançada em Contas a Pagar também já recebeu e sai da lista do mês;
            sem ela, recebe na lista, com o salário.
          </span>
          <ReciboRescisao year={comp.year} month={comp.month} readonly={readonly}
            antesDeGravar={recibo.antesDeGravar} onAplicado={recibo.onAplicado} onErro={recibo.onErro} />
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={180}>Funcionário</Table.Th>
                <Table.Th>Saída</Table.Th>
                <Table.Th title="Rescisão lançada pela Folha em Contas a Pagar">Contas a Pagar</Table.Th>
                <Table.Th title="Gorjeta já paga na rescisão: digite ou leia o termo">Gorjeta paga</Table.Th>
                <Table.Th>Pontos</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th title="Alternativa: sem a gorjeta paga, calcula pelo serviço arrecadado até a saída">Ou: serviço até a saída</Table.Th>
                <Table.Th>Valor do ponto</Table.Th>
                <Table.Th>Gorjeta calculada</Table.Th>
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
                    <Table.Td><RescisaoLancada r={p.rescisaoContasPagar} /></Table.Td>
                    <Table.Td>
                      <input style={{ ...numInputStyle, width: 100, fontWeight: 600 }} type="number" step="0.01" inputMode="decimal" min="0" value={r.rescisaoValorFixo}
                        disabled={readonly} aria-label={`Gorjeta paga na rescisão de ${p.employeeName}`} placeholder="R$ pago"
                        onChange={(e) => onRow(p.employeeId, { rescisaoValorFixo: e.target.value })} />
                    </Table.Td>
                    <Table.Td>
                      <div style={{ fontWeight: 600 }}>{pts(p.points)}</div>
                      {quitada && p.pontosDireito !== p.points && <div style={mutedStyle}>direito {pts(p.pontosDireito)}</div>}
                      {quitada && p.pontosDevolvidos > 0 && <div className="nota-pontos nota-volta" title="Ficam livres para o responsável distribuir no mês; o que sobrar vai ao fundo de reserva">{pts(p.pontosDevolvidos)} pts livres para distribuir</div>}
                      {quitada && p.extraRescisao > 0 && (
                        <div className="nota-pontos nota-extra" title={p.justificativaExtra ?? undefined}>+{pts(p.extraRescisao)} extra automático</div>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {p.semRegistro && p.pagoNaRescisao && <div style={{ marginBottom: 4 }}><StatusBadge tone="success" title="A rescisão lançada em Contas a Pagar já pagou salário e gorjeta até a saída">Paga na rescisão · fora da lista</StatusBadge></div>}
                      {quitada ? (p.rescisaoRecibo
                        ? <SeloRecibo pago pagamento={p.rescisaoRecibo.pagamento} arquivo={p.rescisaoRecibo.arquivo} />
                        : p.semRegistro ? (p.pagoNaRescisao ? <StatusBadge tone="neutral">Valor digitado</StatusBadge>
                          : <StatusBadge tone="info" title="Sem registro e sem rescisão lançada: o valor vai para a lista de pagamento com o salário">Valor manual · na lista</StatusBadge>)
                          : <StatusBadge tone="success">Paga · digitada</StatusBadge>)
                        : p.rescisaoPendente ? <StatusBadge tone="warning">Falta o valor</StatusBadge>
                        : <StatusBadge tone="info">Calculada</StatusBadge>}
                    </Table.Td>
                    <Table.Td>
                      <input style={{ ...numInputStyle, width: 110 }} type="number" step="0.01" inputMode="decimal" min="0" value={r.rescisaoServicoBruto}
                        disabled={readonly || quitada} aria-label={`Serviço bruto até a saída de ${p.employeeName}`}
                        placeholder={p.rescisaoServicoOrigem === "FATURAMENTO" && p.rescisaoServicoBruto != null ? p.rescisaoServicoBruto.toFixed(2) : ""}
                        title="Vazio = soma do faturamento do início do período até a saída"
                        onChange={(e) => onRow(p.employeeId, { rescisaoServicoBruto: e.target.value })} />
                    </Table.Td>
                    <Table.Td>{quitada || p.rescisaoPendente ? "—" : money(p.valorPonto)}</Table.Td>
                    <Table.Td>{quitada || p.rescisaoPendente ? "—" : money(p.rateioAmount)}</Table.Td>
                  </Table.Row>
                );
              })}
              <Table.Row>
                <Table.Td style={totalTd}>Total das rescisões</Table.Td>
                <Table.Td colSpan={2} style={totalTd}> </Table.Td>
                <Table.Td align="center" style={{ ...totalTd, ...num }}>{money(rescisoes.reduce((a, p) => a + p.rateioAmount, 0))}</Table.Td>
                <Table.Td align="center" style={{ ...totalTd, ...num }}>{pts(rescisoes.reduce((a, p) => a + p.points, 0))}</Table.Td>
                <Table.Td style={totalTd}>{rescisoes.some((p) => p.rescisaoPendente) ? <StatusBadge tone="warning">com pendência</StatusBadge> : " "}</Table.Td>
                <Table.Td colSpan={3} style={totalTd}> </Table.Td>
              </Table.Row>
            </Table.Body>
          </Table>
        </div>
      )}
    </div>
  );
}
