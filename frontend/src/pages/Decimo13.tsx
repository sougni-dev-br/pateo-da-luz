import { Banknote, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Decimo13Linha, Decimo13LinhaClt, gerarDecimoTerceiro, getDecimoTerceiro } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Alert, Button, EmptyState, Money, PanelEyebrow, StatusBadge, SummaryCard, Table } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { descreverParcela, parcelaClt, parcelaDaLinha, resumirClt, resumirParcela, type Parcela13 } from "./decimo13/parcelas";

const fmtData = (iso: string) => iso.split("-").reverse().join("/");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** 13º salário: uma parcela por vez (cada uma é paga numa data), em três passos — conferir, lançar, pagar. */
export function Decimo13() {
  const { user } = useSession();
  const canEdit = hasPermission(user, "payroll", "edit");
  const podeVer = hasPermission(user, "employees", "view");
  const { notice, setNotice } = useNotice();

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [parcela, setParcela] = useState<Parcela13>(1);
  const [linhas, setLinhas] = useState<Decimo13Linha[] | null>(null);
  const [clt, setClt] = useState<Decimo13LinhaClt[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      const r = await getDecimoTerceiro(year);
      setLinhas(r.linhas);
      setClt(r.clt ?? []);
    } catch (e) {
      setLinhas(null);
      setClt([]);
      setErro(e instanceof Error ? e.message : "Não foi possível calcular o 13º.");
    }
  }
  useEffect(() => {
    setLinhas(null);
    setConfirmando(false);
    if (podeVer) void carregar();
  }, [year, podeVer]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lancar() {
    setBusy(true);
    try {
      const r = await gerarDecimoTerceiro(year, parcela);
      setNotice({ tone: "success", message: `${r.criadas} título(s) da ${parcela}ª parcela lançado(s) no Contas a Pagar. A baixa é feita lá.` });
      setConfirmando(false);
      await carregar();
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não foi possível lançar o 13º." });
    } finally {
      setBusy(false);
    }
  }

  if (!podeVer) {
    return <Alert tone="warning">O 13º é calculado sobre o salário: é preciso permissão de ver Funcionários.</Alert>;
  }

  const itens = (linhas ?? []).map((l) => ({ l, p: parcelaDaLinha(l, parcela) }));
  const r = resumirParcela(itens.map((i) => i.p));
  const itensClt = clt.map((l) => ({ l, p: parcelaClt(l, parcela) }));
  const rc = resumirClt(itensClt.map((i) => i.p));
  const vencimento = itens.find((i) => i.p.vencimento)?.p.vencimento ?? null;
  const passoAtual = r.aLancar > 0 ? 2 : r.pessoas > 0 ? 3 : 1;

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Folha › 13º salário</PanelEyebrow>
            <h2>13º salário {year}</h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="secondary" aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}><ChevronLeft size={16} /></Button>
            <strong>{year}</strong>
            <Button variant="secondary" aria-label="Próximo ano" onClick={() => setYear((y) => y + 1)}><ChevronRight size={16} /></Button>
          </div>
        </div>

        <div role="tablist" aria-label="Parcela" style={{ display: "flex", gap: 6, margin: "0 0 8px" }}>
          {([1, 2] as const).map((n) => (
            <Button key={n} role="tab" aria-selected={parcela === n} variant={parcela === n ? undefined : "secondary"}
              onClick={() => { setParcela(n); setConfirmando(false); }}>{n}ª parcela</Button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px" }}>{descreverParcela(parcela, vencimento ? fmtData(vencimento) : null)}</p>

        {erro && <Alert tone="error">{erro}</Alert>}
        {!linhas && !erro && <EmptyState title="Calculando o 13º…" />}

        {linhas && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, margin: "0 0 14px" }}>
              {[
                { n: 1, t: "Conferir", d: `${r.pessoas} calculada(s) aqui${r.semCalculo > 0 ? ` · ${r.semCalculo} sem cálculo` : ""}${rc.pessoas > 0 ? ` · ${rc.pessoas - rc.aguardando} de ${rc.pessoas} CLT no extrato` : ""}` },
                { n: 2, t: "Lançar no Contas a Pagar", d: r.aLancar > 0 ? `Falta lançar ${r.aLancar} (${brl(r.totalALancar)})` : r.pessoas > 0 ? "Tudo lançado" : "—" },
                { n: 3, t: "Pagar e imprimir", d: "A baixa é feita no Contas a Pagar" },
              ].map((s) => (
                <div key={s.n} style={{ border: s.n === passoAtual ? "1.5px solid var(--border-accent, var(--border-strong))" : "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                  <strong>{s.n} · {s.t}</strong>
                  <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{s.d}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))", gap: 10, margin: "0 0 14px" }}>
              <SummaryCard compact label="Falta lançar" moneyValue={r.totalALancar} tone={r.aLancar > 0 ? "warning" : undefined} detail={`${r.aLancar} pessoa(s)`} />
              <SummaryCard compact label="Já lançado" moneyValue={r.totalLancado + rc.total} detail={`${r.lancadas + rc.pessoas - rc.aguardando} pessoa(s)`} />
              <SummaryCard compact label={`Total da ${parcela}ª parcela`} moneyValue={r.totalALancar + r.totalLancado + rc.total} detail={`${r.pessoas + rc.pessoas - rc.aguardando} pessoa(s)`} />
            </div>

            {canEdit && r.aLancar > 0 && !confirmando && (
              <div style={{ margin: "0 0 12px" }}>
                <Button leadingIcon={<Banknote size={14} />} onClick={() => setConfirmando(true)}>Lançar {parcela}ª parcela ({r.aLancar})</Button>
              </div>
            )}
            {confirmando && (
              <Alert tone="warning">
                <div>Vai lançar {r.aLancar} título(s) da {parcela}ª parcela, {brl(r.totalALancar)} no total, com vencimento em {vencimento ? fmtData(vencimento) : "—"}. Quem já foi lançado não muda.</div>
                <div className="form-actions">
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmando(false)}>Cancelar</Button>
                  <Button disabled={busy} onClick={() => void lancar()}>{busy ? "Lançando…" : "Confirmar lançamento"}</Button>
                </div>
              </Alert>
            )}

            {linhas.length === 0 && clt.length === 0 ? (
              <EmptyState title="Ninguém com 13º a calcular neste ano." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <Table>
                  <Table.Head>
                    <Table.Row>
                      <Table.Th minWidth={160}>Funcionário</Table.Th>
                      <Table.Th>Avos</Table.Th>
                      <Table.Th align="right">Salário</Table.Th>
                      <Table.Th align="right">Média variáveis</Table.Th>
                      <Table.Th align="right">{parcela}ª parcela</Table.Th>
                      <Table.Th>Situação</Table.Th>
                    </Table.Row>
                  </Table.Head>
                  <Table.Body>
                    {clt.length > 0 && <Table.Row><Table.Td colSpan={6} style={{ fontWeight: 600, background: "var(--surface-1, transparent)" }}>Sem registro · calculado aqui <span style={{ fontWeight: 400, color: "var(--muted)" }}>· {itens.length}</span></Table.Td></Table.Row>}
                    {itens.map(({ l, p }) => (
                      <Table.Row key={l.employeeId}>
                        <Table.Td>
                          <strong>{l.nome}</strong>
                          {l.setor ? <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{l.setor}</div> : null}
                          {l.preRegistro && l.semRegistroAte && l.registroEm ? (
                            <div style={{ fontSize: "0.78em", color: "var(--muted)" }}>
                              só o período sem registro (até {fmtData(l.semRegistroAte)}); registrado em {fmtData(l.registroEm)}, o resto vem da contabilidade
                            </div>
                          ) : null}
                        </Table.Td>
                        {l.calculo ? (
                          <>
                            <Table.Td title={l.calculo.memoria}>{l.calculo.avos}/12 <span style={{ fontSize: "0.78em", color: "var(--muted)" }}>desde {fmtData(l.calculo.desde)}</span></Table.Td>
                            <Table.Td align="right"><Money value={l.calculo.salario} /></Table.Td>
                            <Table.Td align="right"><Money value={l.calculo.mediaVariaveis} /></Table.Td>
                            <Table.Td align="right" style={{ fontWeight: 500 }}><Money value={p.valor} /></Table.Td>
                            <Table.Td><StatusBadge tone={p.situacao === "LANCADA" ? "success" : "warning"}>{p.situacao === "LANCADA" ? "Lançada" : "Falta lançar"}</StatusBadge></Table.Td>
                          </>
                        ) : (
                          <Table.Td colSpan={5} style={{ color: "var(--muted)" }}>{l.motivoSemCalculo}</Table.Td>
                        )}
                      </Table.Row>
                    ))}
                    {clt.length > 0 && (
                      <Table.Row><Table.Td colSpan={6} style={{ fontWeight: 600, background: "var(--surface-1, transparent)" }}>
                        CLT · valor do extrato da contabilidade <span style={{ fontWeight: 400, color: "var(--muted)" }}>· {itensClt.length}</span>
                      </Table.Td></Table.Row>
                    )}
                    {itensClt.map(({ l, p }) => (
                      <Table.Row key={l.employeeId}>
                        <Table.Td><strong>{l.nome}</strong>{l.setor ? <div style={{ fontSize: "0.8em", color: "var(--muted)" }}>{l.setor}</div> : null}</Table.Td>
                        <Table.Td colSpan={3} style={{ color: "var(--muted)" }}>O cálculo é da contabilidade (importado em Retorno do RH).</Table.Td>
                        <Table.Td align="right" style={{ fontWeight: 500 }}>{p.situacao === "AGUARDANDO_EXTRATO" ? "—" : <Money value={p.valor} />}</Table.Td>
                        <Table.Td>
                          <StatusBadge tone={p.situacao === "PAGA" ? "success" : p.situacao === "LANCADA" ? "info" : "neutral"}>
                            {p.situacao === "PAGA" ? "Paga" : p.situacao === "LANCADA" ? "No Contas a Pagar" : "Aguardando extrato"}
                          </StatusBadge>
                        </Table.Td>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
