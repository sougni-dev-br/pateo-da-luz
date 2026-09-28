import { Download, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type TipComputation, type TipEvolucao, type TipFuncaoHistorico, type TipMudanca, type TipMudancaTipo, type TipReservaMovimento,
  addTipReserveAdjustment, deleteTipReserveAdjustment, distributeTipReserve, getTipChanges, getTipEvolution, getTipFunctionHistory, getTipReserve,
} from "../../api/client";
import { Button, Money, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import "./gorjeta.css";
import { MONTHS, inputStyle, money, mutedStyle, numInputStyle, panelStyle, pts } from "./gorjetaUtils";
import { TIPO_MUDANCA, fmtDia } from "./HistoricoLinhaDoTempo";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Visao = "mudancas" | "evolucao" | "reserva" | "funcoes";

type Props = {
  comp: TipComputation | null;
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  onChanged: () => void;
};

const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoAno = () => `${new Date().getFullYear()}-01-01`;
const mesAtual = () => new Date().toISOString().slice(0, 7);
const mesesAtras = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 7); };

// CSV com ponto e vírgula e vírgula decimal: abre direto no Excel em português.
function baixarCsv(nome: string, linhas: Array<Array<string | number | null>>) {
  const celula = (v: string | number | null) => {
    if (v == null) return "";
    const t = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const csv = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function AbaRelatorios({ comp, canEdit, onNotice, onChanged }: Props) {
  const [visao, setVisao] = useState<Visao>("mudancas");
  const erro = (e: unknown) => onNotice("error", (e as Error).message);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="barra-lista">
        <div className="barra-lista-segmento" role="group" aria-label="Relatório" style={{ marginLeft: 0 }}>
          {([["mudancas", "Mudanças de função e pontos"], ["evolucao", "Evolução mês a mês"], ["reserva", "Fundo de reserva"], ["funcoes", "Tabela de funções"]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={visao === v} onClick={() => setVisao(v)}>{l}</button>
          ))}
        </div>
      </div>
      {visao === "mudancas" && <RelatorioMudancas onErro={erro} />}
      {visao === "evolucao" && <RelatorioEvolucao onErro={erro} />}
      {visao === "reserva" && <FundoReserva comp={comp} canEdit={canEdit} onNotice={onNotice} onChanged={onChanged} />}
      {visao === "funcoes" && <HistoricoFuncoes onErro={erro} />}
    </div>
  );
}

// ─── Mudanças de função e pontos ────────────────────────────────────────────
const COLUNAS_MUD: ColunaOpcional[] = [
  { chave: "tipo", rotulo: "Tipo" }, { chave: "funcao", rotulo: "Função" }, { chave: "antes", rotulo: "Pontos antes" },
  { chave: "depois", rotulo: "Pontos depois" }, { chave: "dif", rotulo: "Diferença" }, { chave: "motivo", rotulo: "Motivo" },
];
const EXT_MUD: Extratores<TipMudanca> = {
  data: (m) => m.validFrom, nome: (m) => m.employeeName, tipo: (m) => TIPO_MUDANCA[m.tipo].rotulo,
  funcao: (m) => m.funcaoDepois, antes: (m) => m.baseAntes, depois: (m) => m.baseDepois, dif: (m) => m.diferenca, motivo: (m) => m.motivo,
};
const TEXTO_MUD = new Set(["nome", "tipo", "funcao", "motivo"]);

function RelatorioMudancas({ onErro }: { onErro: (e: unknown) => void }) {
  const [de, setDe] = useState(inicioDoAno());
  const [ate, setAte] = useState(hoje());
  const [filtro, setFiltro] = useState<"todas" | TipMudancaTipo>("todas");
  const [incluirInicial, setIncluirInicial] = useState(false);
  const [dados, setDados] = useState<TipMudanca[]>([]);
  const ord = useOrdenacao("rel-mudancas");
  const col = useColunas("rel-mudancas");
  const v = col.visivel;
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO_MUD.has(c) ? "asc" : "desc") });

  useEffect(() => {
    getTipChanges(de || undefined, ate || undefined).then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const visiveis = dados.filter((m) => (incluirInicial || m.tipo !== "INICIAL") && (filtro === "todas" || m.tipo === filtro));
  const linhas = aplicarOrdem(visiveis, ord.ordem, EXT_MUD);
  const conta = (t: TipMudancaTipo) => dados.filter((m) => m.tipo === t).length;

  function exportar() {
    baixarCsv(`gorjeta-mudancas-${de}-a-${ate}.csv`, [
      ["Vigência", "Funcionário", "Tipo", "Função antes", "Função depois", "Pontos antes", "Pontos depois", "Diferença", "Motivo"],
      ...linhas.map((m) => [fmtDia(m.validFrom), m.employeeName, TIPO_MUDANCA[m.tipo].rotulo, m.funcaoAntes, m.funcaoDepois, m.baseAntes, m.baseDepois, m.diferenca, m.motivo]),
    ]);
  }

  return (
    <div style={panelStyle}>
      <div className="barra-lista">
        <label className="barra-lista-campo">De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <label className="barra-lista-campo">até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <label className="barra-lista-campo">
          Tipo
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
            <option value="todas">Todas</option>
            {(["PROMOCAO", "REDUCAO", "TROCA_DE_FUNCAO", "ENTRADA", "SAIDA"] as const).map((t) => <option key={t} value={t}>{TIPO_MUDANCA[t].rotulo}</option>)}
          </select>
        </label>
        <label className="barra-lista-campo">
          <input type="checkbox" checked={incluirInicial} onChange={(e) => setIncluirInicial(e.target.checked)} /> Mostrar situação inicial
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <SeletorColunas colunas={COLUNAS_MUD} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={exportar} disabled={linhas.length === 0}>Excel (CSV)</Button>
        </div>
      </div>
      <div className="grupo-cabecalho" style={{ position: "static" }}>
        <span className="grupo-chip" style={{ color: "var(--success)" }}>{conta("PROMOCAO")} promoções</span>
        <span className="grupo-chip" style={{ color: "var(--danger)" }}>{conta("REDUCAO")} reduções</span>
        <span className="grupo-chip">{conta("TROCA_DE_FUNCAO")} trocas de função</span>
        <span className="grupo-chip">{conta("ENTRADA")} entradas · {conta("SAIDA")} saídas</span>
      </div>
      {linhas.length === 0 ? <span style={mutedStyle}>Nenhuma mudança no período escolhido.</span> : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
              <ThOrdenavel {...th("data")}>Vigência</ThOrdenavel>
              {v("tipo") && <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>}
              {v("funcao") && <ThOrdenavel {...th("funcao")}>Função</ThOrdenavel>}
              {v("antes") && <ThOrdenavel {...th("antes")}>Pontos antes</ThOrdenavel>}
              {v("depois") && <ThOrdenavel {...th("depois")}>Pontos depois</ThOrdenavel>}
              {v("dif") && <ThOrdenavel {...th("dif")}>Diferença</ThOrdenavel>}
              {v("motivo") && <ThOrdenavel {...th("motivo")}>Motivo</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((m) => (
              <Table.Row key={m.id}>
                <Table.Td style={{ fontWeight: 500 }}>{m.employeeName}</Table.Td>
                <Table.Td>{fmtDia(m.validFrom)}</Table.Td>
                {v("tipo") && <Table.Td><StatusBadge tone={TIPO_MUDANCA[m.tipo].tom}>{TIPO_MUDANCA[m.tipo].rotulo}</StatusBadge></Table.Td>}
                {v("funcao") && (
                  <Table.Td>
                    {m.funcaoAntes && m.funcaoAntes !== m.funcaoDepois && <span style={mutedStyle}>{m.funcaoAntes} → </span>}
                    {m.funcaoDepois ?? "—"}
                  </Table.Td>
                )}
                {v("antes") && <Table.Td>{pts(m.baseAntes)}</Table.Td>}
                {v("depois") && <Table.Td style={{ fontWeight: 700 }}>{pts(m.baseDepois)}</Table.Td>}
                {v("dif") && (
                  <Table.Td style={{ fontWeight: 700, color: (m.diferenca ?? 0) > 0 ? "var(--success)" : (m.diferenca ?? 0) < 0 ? "var(--danger)" : undefined }}>
                    {m.diferenca ? `${m.diferenca > 0 ? "+" : "−"}${pts(Math.abs(m.diferenca))}` : "—"}
                  </Table.Td>
                )}
                {v("motivo") && <Table.Td style={{ ...mutedStyle, textAlign: "left" }}>{m.motivo ?? "—"}</Table.Td>}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

// ─── Evolução mês a mês ─────────────────────────────────────────────────────
type Medida = "pontos" | "gorjeta" | "funcao";

function RelatorioEvolucao({ onErro }: { onErro: (e: unknown) => void }) {
  const [de, setDe] = useState(mesesAtras(11));
  const [ate, setAte] = useState(mesAtual());
  const [medida, setMedida] = useState<Medida>("pontos");
  const [dados, setDados] = useState<TipEvolucao | null>(null);

  useEffect(() => {
    getTipEvolution(de, ate).then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const chaves = useMemo(() => (dados?.competencias ?? []).map((c) => `${c.ano}-${String(c.mes).padStart(2, "0")}`), [dados]);

  // Pontos: finais do mês fechado, ou base enquanto está em apuração.
  const valor = (c: TipEvolucao["linhas"][number]["meses"][string]) => {
    if (!c) return null;
    if (medida === "gorjeta") return c.gorjeta;
    if (medida === "pontos") return c.pontos ?? c.base;
    return null;
  };

  function exportar() {
    if (!dados) return;
    baixarCsv(`gorjeta-evolucao-${medida}-${de}-a-${ate}.csv`, [
      ["Funcionário", ...chaves.map((k) => `${MONTHS[Number(k.slice(5)) - 1].slice(0, 3)}/${k.slice(0, 4)}`)],
      ...dados.linhas.map((l) => [l.employeeName, ...chaves.map((k) => (medida === "funcao" ? l.meses[k]?.funcao ?? null : valor(l.meses[k])))]),
    ]);
  }

  return (
    <div style={panelStyle}>
      <div className="barra-lista">
        <label className="barra-lista-campo">De <input type="month" value={de} onChange={(e) => setDe(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <label className="barra-lista-campo">até <input type="month" value={ate} onChange={(e) => setAte(e.target.value)} style={{ ...inputStyle, width: "auto" }} /></label>
        <div className="barra-lista-segmento" role="group" aria-label="Medida">
          {([["pontos", "Pontos"], ["gorjeta", "Gorjeta R$"], ["funcao", "Função"]] as const).map(([m, l]) => (
            <button key={m} type="button" aria-pressed={medida === m} onClick={() => setMedida(m)}>{l}</button>
          ))}
        </div>
        <Button variant="secondary" leadingIcon={<Download size={14} />} onClick={exportar} disabled={!dados?.linhas.length}>Excel (CSV)</Button>
      </div>
      <span style={mutedStyle}>
        Retrato de cada competência. Verde = subiu em relação ao mês anterior; vermelho = caiu. Mês em apuração mostra os pontos-base (itálico) e ainda não tem valor.
      </span>
      {!dados || dados.linhas.length === 0 ? <span style={mutedStyle}>Nenhuma competência no intervalo.</span> : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <Table.Th minWidth={200}>Funcionário</Table.Th>
              {dados.competencias.map((c) => (
                <Table.Th key={`${c.ano}-${c.mes}`} title={c.status === "OPEN" ? "Em apuração" : `Ponto: ${money(c.pointValue)}`}>
                  {MONTHS[c.mes - 1].slice(0, 3)}/{String(c.ano).slice(2)}{c.status === "OPEN" ? " •" : ""}
                </Table.Th>
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {dados.linhas.map((l) => (
              <Table.Row key={l.employeeId}>
                <Table.Td style={{ fontWeight: 500 }}>{l.employeeName}</Table.Td>
                {chaves.map((k, i) => {
                  const c = l.meses[k];
                  if (medida === "funcao") {
                    const antes = i > 0 ? l.meses[chaves[i - 1]]?.funcao : undefined;
                    return <Table.Td key={k} style={{ fontSize: 12, fontWeight: antes && c?.funcao && antes !== c.funcao ? 700 : 400 }}>{c?.funcao ?? "—"}</Table.Td>;
                  }
                  const atual = valor(c);
                  const anterior = i > 0 ? valor(l.meses[chaves[i - 1]]) : null;
                  const cor = atual != null && anterior != null && atual !== anterior ? (atual > anterior ? "var(--success)" : "var(--danger)") : undefined;
                  const emApuracao = c && c.pontos == null && medida === "pontos";
                  return (
                    <Table.Td key={k} style={{ color: cor, fontWeight: cor ? 700 : 400, fontStyle: emApuracao ? "italic" : undefined, fontVariantNumeric: "tabular-nums" }}>
                      {atual == null ? "—" : medida === "gorjeta" ? money(atual) : pts(atual)}
                    </Table.Td>
                  );
                })}
              </Table.Row>
            ))}
            {medida === "gorjeta" && (
              <Table.Row>
                <Table.Td style={{ fontWeight: 700, background: "var(--paper-soft)" }}>Total</Table.Td>
                {chaves.map((k) => (
                  <Table.Td key={k} style={{ fontWeight: 700, background: "var(--paper-soft)" }}>
                    {money(dados.linhas.reduce((a, l) => a + (l.meses[k]?.gorjeta ?? 0), 0))}
                  </Table.Td>
                ))}
              </Table.Row>
            )}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

// ─── Fundo de reserva ───────────────────────────────────────────────────────
const TIPO_MOV: Record<TipReservaMovimento["type"], string> = {
  FECHAMENTO_RESERVA: "Reserva do mês", FECHAMENTO_SALDO: "Saldo do mês", DISTRIBUICAO: "Distribuição", AJUSTE: "Ajuste",
};

function FundoReserva({ comp, canEdit, onNotice, onChanged }: Props) {
  const [dados, setDados] = useState<{ saldo: number; movimentos: TipReservaMovimento[] } | null>(null);
  const [ajuste, setAjuste] = useState({ valor: "", descricao: "", data: hoje() });
  const [itens, setItens] = useState<Array<{ employeeId: string; valor: string; descricao: string }>>([{ employeeId: "", valor: "", descricao: "" }]);
  const erro = (e: unknown) => onNotice("error", (e as Error).message);

  const carregar = () => getTipReserve().then(setDados).catch(erro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, []);

  const podeDistribuir = canEdit && comp?.periodId != null && comp.status === "OPEN";
  const totalDistribuir = itens.reduce((a, i) => a + (Number(i.valor.replace(",", ".")) || 0), 0);
  const pessoas = (comp?.participants ?? []).filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO")
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"));

  async function lancarAjuste() {
    const valor = Number(ajuste.valor.replace(",", "."));
    if (!valor) return onNotice("warning", "Informe o valor do ajuste (negativo para retirar).");
    try {
      await addTipReserveAdjustment({ amount: valor, notes: ajuste.descricao, date: ajuste.data });
      setAjuste({ valor: "", descricao: "", data: hoje() });
      await carregar();
      onNotice("success", "Ajuste lançado no fundo.");
    } catch (e) { erro(e); }
  }

  async function apagarAjuste(id: string) {
    if (!window.confirm("Apagar este ajuste do fundo?")) return;
    try { await deleteTipReserveAdjustment(id); await carregar(); } catch (e) { erro(e); }
  }

  async function distribuir() {
    if (!comp?.periodId) return;
    const validos = itens.filter((i) => i.employeeId && Number(i.valor.replace(",", ".")) > 0);
    if (validos.length === 0) return onNotice("warning", "Escolha ao menos um funcionário e um valor.");
    if (!window.confirm(`Distribuir ${money(totalDistribuir)} do fundo como crédito na gorjeta de ${MONTHS[comp.month - 1]}/${comp.year}?`)) return;
    try {
      await distributeTipReserve(comp.periodId, validos.map((i) => ({ employeeId: i.employeeId, amount: Number(i.valor.replace(",", ".")), notes: i.descricao || undefined })));
      setItens([{ employeeId: "", valor: "", descricao: "" }]);
      await carregar();
      onChanged();
      onNotice("success", "Reserva distribuída: os créditos aparecem nos vales de cada pessoa na Apuração.");
    } catch (e) { erro(e); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...panelStyle, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 24 }}>
        <div>
          <div style={mutedStyle}>Saldo do fundo de reserva</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: (dados?.saldo ?? 0) < 0 ? "var(--danger)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
            {money(dados?.saldo ?? 0)}
          </div>
        </div>
        {comp?.periodId && (
          <div style={mutedStyle}>
            {MONTHS[comp.month - 1]}/{comp.year}: reserva de {pts(comp.reservaPontos)} pts = <strong>{money(comp.reservaTotal)}</strong>
            {comp.saldo > 0 && <> + saldo de <strong>{money(comp.saldo)}</strong></>}
            {comp.status === "CLOSED" ? " (já no fundo)" : " — entra no fundo ao fechar"}
          </div>
        )}
      </div>

      {canEdit && (
        <div style={panelStyle}>
          <strong>Lançar ajuste <span style={{ ...mutedStyle, fontWeight: 400 }}>— saldo inicial, correção ou retirada (valor negativo)</span></strong>
          <div className="barra-lista">
            <input type="date" value={ajuste.data} onChange={(e) => setAjuste({ ...ajuste, data: e.target.value })} style={{ ...inputStyle, width: "auto" }} aria-label="Data do ajuste" />
            <input type="number" step="0.01" value={ajuste.valor} placeholder="Valor R$" onChange={(e) => setAjuste({ ...ajuste, valor: e.target.value })} style={{ ...numInputStyle, width: 130 }} aria-label="Valor do ajuste" />
            <input value={ajuste.descricao} placeholder="Descrição (ex.: saldo guardado até set/2026)" onChange={(e) => setAjuste({ ...ajuste, descricao: e.target.value })}
              style={{ ...inputStyle, flex: "1 1 260px", width: "auto" }} aria-label="Descrição do ajuste" />
            <Button onClick={() => void lancarAjuste()} leadingIcon={<Plus size={14} />} disabled={!ajuste.valor || !ajuste.descricao.trim()}>Lançar</Button>
          </div>
        </div>
      )}

      <div style={panelStyle}>
        <strong>Distribuir a reserva <span style={{ ...mutedStyle, fontWeight: 400 }}>— vira crédito na gorjeta de {comp ? `${MONTHS[comp.month - 1]}/${comp.year}` : "um período aberto"}</span></strong>
        {!podeDistribuir ? (
          <span style={mutedStyle}>Abra (ou reabra) a competência na Apuração para distribuir; o período fechado não recebe créditos.</span>
        ) : (
          <>
            {itens.map((it, idx) => (
              <div key={idx} className="barra-lista">
                <select value={it.employeeId} onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, employeeId: e.target.value } : x)))}
                  style={{ ...inputStyle, width: 260 }} aria-label="Funcionário">
                  <option value="">Funcionário…</option>
                  {pessoas.map((p) => <option key={p.employeeId} value={p.employeeId}>{p.employeeName}</option>)}
                </select>
                <input type="number" step="0.01" min="0" value={it.valor} placeholder="Valor R$"
                  onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, valor: e.target.value } : x)))} style={{ ...numInputStyle, width: 120 }} aria-label="Valor" />
                <input value={it.descricao} placeholder="Descrição (opcional)"
                  onChange={(e) => setItens(itens.map((x, j) => (j === idx ? { ...x, descricao: e.target.value } : x)))} style={{ ...inputStyle, flex: "1 1 200px", width: "auto" }} aria-label="Descrição" />
                {itens.length > 1 && (
                  <button type="button" onClick={() => setItens(itens.filter((_, j) => j !== idx))} aria-label="Remover linha"
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
            <div className="barra-lista">
              <Button variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => setItens([...itens, { employeeId: "", valor: "", descricao: "" }])}>Mais uma pessoa</Button>
              <span style={{ marginLeft: "auto" }}>Total: <strong>{money(totalDistribuir)}</strong> de {money(dados?.saldo ?? 0)}</span>
              <Button onClick={() => void distribuir()} disabled={totalDistribuir <= 0 || totalDistribuir > (dados?.saldo ?? 0) + 0.005}>Distribuir</Button>
            </div>
          </>
        )}
      </div>

      <div style={panelStyle}>
        <strong>Extrato</strong>
        {!dados || dados.movimentos.length === 0 ? <span style={mutedStyle}>Sem lançamentos ainda. A reserva entra no fundo ao fechar cada período.</span> : (
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <Table.Th>Data</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Competência</Table.Th>
                <Table.Th>Funcionário</Table.Th>
                <Table.Th>Descrição</Table.Th>
                <Table.Th>Valor</Table.Th>
                <Table.Th>Saldo</Table.Th>
                <Table.Th aria-label="Ações"> </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {dados.movimentos.map((m) => (
                <Table.Row key={m.id}>
                  <Table.Td>{fmtDia(m.date)}</Table.Td>
                  <Table.Td><StatusBadge tone={m.amount < 0 ? "warning" : "success"}>{TIPO_MOV[m.type]}</StatusBadge></Table.Td>
                  <Table.Td>{m.competencia ?? "—"}</Table.Td>
                  <Table.Td>{m.employeeName ?? "—"}</Table.Td>
                  <Table.Td style={{ ...mutedStyle, textAlign: "left" }}>{m.notes ?? "—"}</Table.Td>
                  <Table.Td style={{ fontWeight: 700, color: m.amount < 0 ? "var(--danger)" : "var(--success)" }}><Money value={m.amount} /></Table.Td>
                  <Table.Td><Money value={m.saldo} /></Table.Td>
                  <Table.Td>
                    {m.removivel && canEdit && (
                      <button type="button" onClick={() => void apagarAjuste(m.id)} aria-label="Apagar ajuste"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Trash2 size={14} /></button>
                    )}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
    </div>
  );
}

// ─── Alterações na tabela de funções ────────────────────────────────────────
function HistoricoFuncoes({ onErro }: { onErro: (e: unknown) => void }) {
  const [dados, setDados] = useState<TipFuncaoHistorico[]>([]);
  useEffect(() => {
    getTipFunctionHistory().then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={panelStyle}>
      <span style={mutedStyle}>Cada vez que os pontos, o nome ou a faixa de uma função mudam. Quem estava na função ganha a linha correspondente no próprio histórico.</span>
      {dados.length === 0 ? <span style={mutedStyle}>Nenhuma alteração registrada na tabela de funções.</span> : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <Table.Th>Função</Table.Th>
              <Table.Th>Data</Table.Th>
              <Table.Th>Pontos antes</Table.Th>
              <Table.Th>Pontos depois</Table.Th>
              <Table.Th>Faixa</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {dados.map((h) => (
              <Table.Row key={h.id}>
                <Table.Td style={{ fontWeight: 500 }}>{h.name}</Table.Td>
                <Table.Td>{new Date(h.createdAt).toLocaleDateString("pt-BR")}</Table.Td>
                <Table.Td>{h.pointsBefore == null ? "nova" : pts(h.pointsBefore)}</Table.Td>
                <Table.Td style={{ fontWeight: 700, color: h.pointsBefore != null && h.pointsAfter !== h.pointsBefore ? (h.pointsAfter > h.pointsBefore ? "var(--success)" : "var(--danger)") : undefined }}>
                  {pts(h.pointsAfter)}
                </Table.Td>
                <Table.Td>{h.minPoints != null || h.maxPoints != null ? `${pts(h.minPoints)} a ${pts(h.maxPoints)}` : "—"}</Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
