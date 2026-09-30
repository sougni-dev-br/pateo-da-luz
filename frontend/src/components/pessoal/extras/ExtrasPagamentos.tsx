import { Ban, FileText, Receipt } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  cancelarPagamentoExtra, gerarPagamentoExtras, getExtraPagamentos, getReciboExtra,
  type ExtraPagamento, type ExtraPagamentos, type ExtraPendente,
} from "../../../api/client";
import type { NoticeState } from "../../Notice";
import { Alert, Button, EmptyState, FormField, Money, PanelEyebrow, RowMenu, StatusBadge, Table, TextField, Textarea } from "../../../design-system";
import { Janela } from "./Janela";
import { brl, dataCurta, diariasTexto, hojeIso } from "./extrasRotulos";
import { imprimirRecibo } from "./reciboExtra";

type Props = {
  year: number;
  month: number;
  mesRotulo: string;
  podeAprovar: boolean;
  podeCancelar: boolean;
  setNotice: (n: NoticeState) => void;
  onMudou: () => void;
};

const SITUACAO: Record<ExtraPagamento["situacao"], { rotulo: string; tom: "info" | "danger" | "success" | "neutral" }> = {
  OPEN: { rotulo: "Em aberto", tom: "info" },
  OVERDUE: { rotulo: "Vencido", tom: "danger" },
  PAID: { rotulo: "Pago", tom: "success" },
  CANCELED: { rotulo: "Cancelado", tom: "neutral" },
};

type Grupo = { pessoaId: string; nome: string; origem: ExtraPendente["origem"]; diarias: ExtraPendente[]; total: number };

export function ExtrasPagamentos({ year, month, mesRotulo, podeAprovar, podeCancelar, setNotice, onMudou }: Props) {
  // Guarda de qual mês são os dados: ao trocar de mês, os antigos não aparecem
  // sob o nome do mês novo.
  const [carga, setCarga] = useState<{ chave: string; v: ExtraPagamentos } | null>(null);
  const chave = `${year}-${month}`;
  const dados = carga && carga.chave === chave ? carga.v : null;
  const [erro, setErro] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [gerando, setGerando] = useState<{ dueDate: string; notes: string } | null>(null);
  const [cancelando, setCancelando] = useState<{ pg: ExtraPagamento; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const cargaAtual = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++cargaAtual.current;
    try {
      const d = await getExtraPagamentos(year, month);
      if (minha !== cargaAtual.current) return;
      setCarga({ chave: `${year}-${month}`, v: d });
      setErro(null);
      // Mantém marcadas só as que continuam pendentes.
      setMarcadas((m) => new Set([...m].filter((id) => d.pendentes.some((p) => p.id === id))));
    } catch (e) {
      if (minha === cargaAtual.current) setErro(e instanceof Error ? e.message : "Não foi possível carregar os pagamentos.");
    }
  }, [year, month]);

  useEffect(() => { void carregar(); }, [carregar]);

  const grupos = useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>();
    for (const d of dados?.pendentes ?? []) {
      const g = mapa.get(d.pessoaId) ?? { pessoaId: d.pessoaId, nome: d.nome, origem: d.origem, diarias: [], total: 0 };
      g.diarias.push(d);
      g.total = Math.round((g.total + d.totalAmount) * 100) / 100;
      mapa.set(d.pessoaId, g);
    }
    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [dados]);

  const selecionadas = (dados?.pendentes ?? []).filter((d) => marcadas.has(d.id));
  const totalSelecionado = Math.round(selecionadas.reduce((s, d) => s + d.totalAmount, 0) * 100) / 100;
  const pessoasSelecionadas = new Set(selecionadas.map((d) => d.pessoaId)).size;
  const totalPendente = grupos.reduce((s, g) => s + g.total, 0);

  function alternar(ids: string[], marcar: boolean) {
    setMarcadas((m) => {
      const n = new Set(m);
      for (const id of ids) (marcar ? n.add(id) : n.delete(id));
      return n;
    });
  }

  async function confirmarGeracao() {
    if (!gerando) return;
    setOcupado(true);
    try {
      const r = await gerarPagamentoExtras([...marcadas], gerando.dueDate, gerando.notes.trim() || null);
      setGerando(null);
      setMarcadas(new Set());
      setNotice({ tone: "success", message: `${r.pagamentos.length} pagamento(s) gerado(s): ${r.pagamentos.map((p) => p.code).join(", ")}. A baixa é feita em Contas a Pagar.` });
      await carregar();
      onMudou();
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não foi possível gerar o pagamento." });
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCancelamento() {
    if (!cancelando) return;
    if (cancelando.motivo.trim().length < 3) return setNotice({ tone: "error", message: "Informe o motivo do cancelamento (mín. 3 caracteres)." });
    setOcupado(true);
    try {
      const r = await cancelarPagamentoExtra(cancelando.pg.id, cancelando.motivo.trim());
      setCancelando(null);
      setNotice({ tone: "success", message: `Pagamento cancelado. ${diariasTexto(r.diariasSoltas)} voltaram para "Para pagar".` });
      await carregar();
      onMudou();
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não foi possível cancelar." });
    } finally {
      setOcupado(false);
    }
  }

  async function recibo(pg: ExtraPagamento) {
    try {
      imprimirRecibo(await getReciboExtra(pg.id));
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não foi possível montar o recibo." });
    }
  }

  const avisoErro = erro && (
    <Alert tone="error">
      {erro} <button type="button" className="extras-link-botao" onClick={() => void carregar()}>Tentar de novo</button>
    </Alert>
  );
  if (!dados) return avisoErro || <p className="extras-sub">Carregando…</p>;

  return (
    <div className="stack">
      {avisoErro}
      <section className="panel extras-painel-pagar">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Diárias realizadas sem pagamento</PanelEyebrow>
            <h2>Para pagar</h2>
          </div>
          {grupos.length > 0 && <strong className="extras-num" style={{ fontSize: 18 }}><Money value={totalPendente} /></strong>}
        </div>
        {grupos.length === 0 ? (
          <EmptyState title="Nada para pagar" description="Toda diária realizada já está num pagamento." />
        ) : (
          <>
            <div className="extras-pagar-ajuda">
              <p className="extras-sub" style={{ margin: 0 }}>
                Marque o que vai junto no mesmo pagamento: uma diária, as do dia ou as da semana. Sai um título por pessoa.
              </p>
              {podeAprovar && (
                <Button variant="secondary" size="sm" onClick={() => alternar((dados.pendentes ?? []).map((d) => d.id), selecionadas.length !== dados.pendentes.length)}>
                  {selecionadas.length === dados.pendentes.length ? "Desmarcar tudo" : "Marcar tudo"}
                </Button>
              )}
            </div>
            <div className="extras-pagar">
              {grupos.map((g) => {
                const ids = g.diarias.map((d) => d.id);
                const todas = ids.every((id) => marcadas.has(id));
                const algumas = !todas && ids.some((id) => marcadas.has(id));
                return (
                  <div className="extras-pagar-pessoa" key={g.pessoaId}>
                    <label className="extras-pagar-cabeca">
                      <input
                        type="checkbox"
                        checked={todas}
                        ref={(el) => { if (el) el.indeterminate = algumas; }}
                        onChange={(e) => alternar(ids, e.target.checked)}
                        disabled={!podeAprovar}
                      />
                      <strong>{g.nome}</strong>
                      <span className={`extras-origem${g.origem === "FORA" ? " fora" : ""}`}>{g.origem === "CASA" ? "Casa" : "De fora"}</span>
                      <span className="extras-sub">{diariasTexto(g.diarias.reduce((s, d) => s + (d.duration === "MEIA" ? 0.5 : 1), 0))}</span>
                      <span className="extras-num" style={{ marginLeft: "auto", fontWeight: 700 }}><Money value={g.total} /></span>
                    </label>
                    {g.diarias.map((d) => (
                      <label className="extras-pagar-linha" key={d.id}>
                        <input type="checkbox" checked={marcadas.has(d.id)} onChange={(e) => alternar([d.id], e.target.checked)} disabled={!podeAprovar} />
                        <span className="extras-num">{dataCurta(d.date)}</span>
                        <span className="extras-sub">{d.sector} · {d.duration === "MEIA" ? "meia" : "inteira"}</span>
                        <span className="extras-num" style={{ marginLeft: "auto" }}><Money value={d.totalAmount} /></span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            {podeAprovar ? (
              <div className="extras-selecao">
                <span>
                  {selecionadas.length === 0
                    ? "Nenhuma diária marcada"
                    : `${diariasTexto(selecionadas.length)} · ${pessoasSelecionadas} pessoa(s) · `}
                  {selecionadas.length > 0 && <strong><Money value={totalSelecionado} /></strong>}
                </span>
                <Button onClick={() => setGerando({ dueDate: hojeIso(), notes: "" })} disabled={selecionadas.length === 0}>
                  Gerar pagamento
                </Button>
              </div>
            ) : (
              <p className="extras-sub">Gerar pagamento exige a permissão "Aprovar" em Extras.</p>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <PanelEyebrow>Títulos no Contas a Pagar</PanelEyebrow>
            <h2>Pagamentos</h2>
          </div>
          <Link to="/financeiro/contas-a-pagar" className="extras-link">Abrir Contas a Pagar</Link>
        </div>
        <p className="extras-sub" style={{ marginTop: 0 }}>Em aberto de qualquer mês e os que vencem em {mesRotulo}. A baixa é feita em Contas a Pagar.</p>
        {dados.pagamentos.length === 0 ? (
          <EmptyState title="Nenhum pagamento" description="Gere o pagamento das diárias realizadas no quadro acima." />
        ) : (
          <Table className="extras-tabela">
            <Table.Head>
              <Table.Row>
                <Table.Th>Pagamento</Table.Th>
                <Table.Th>Pessoa</Table.Th>
                <Table.Th className="extras-ocultar-celular">Vencimento</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Valor</Table.Th>
                <Table.Th aria-label="Ações" />
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {dados.pagamentos.map((pg) => (
                <Table.Row key={pg.id}>
                  <Table.Td>
                    <strong className="extras-num">{pg.code}</strong>
                    <div><StatusBadge tone={SITUACAO[pg.situacao].tom}>{SITUACAO[pg.situacao].rotulo}</StatusBadge></div>
                  </Table.Td>
                  <Table.Td>
                    <strong>{pg.nome}</strong>
                    {/* Cancelado soltou as diárias: não há o que listar, só o motivo. */}
                    {pg.situacao !== "CANCELED" && (
                      <div className="extras-sub">{diariasTexto(pg.diarias.reduce((s, d) => s + (d.duration === "MEIA" ? 0.5 : 1), 0))}: {pg.diarias.map((d) => dataCurta(d.date).slice(0, 5)).join(", ")}</div>
                    )}
                    {pg.situacao === "CANCELED" && pg.cancelReason && <div className="extras-sub">cancelado: {pg.cancelReason}</div>}
                  </Table.Td>
                  <Table.Td className="extras-ocultar-celular extras-num">
                    {dataCurta(pg.dueDate)}
                    {pg.paymentDate && <div className="extras-sub">pago {new Date(pg.paymentDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}{pg.paidPaymentMethodName ? ` · ${pg.paidPaymentMethodName}` : ""}</div>}
                  </Table.Td>
                  <Table.Td style={{ textAlign: "right" }} className="extras-num"><strong><Money value={pg.amount} /></strong></Table.Td>
                  <Table.Td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {pg.situacao !== "CANCELED" && (
                      <Button variant="secondary" size="sm" leadingIcon={<Receipt size={14} />} onClick={() => void recibo(pg)}>Recibo</Button>
                    )}
                    {pg.situacao !== "CANCELED" && podeCancelar && !pg.paymentDate && (
                      <RowMenu
                        items={[{ label: "Cancelar pagamento", icon: <Ban size={14} />, tone: "danger" as const, onClick: () => setCancelando({ pg, motivo: "" }) }]}
                      />
                    )}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </section>

      {gerando && (
        <Janela titulo={<><FileText size={18} style={{ verticalAlign: -3 }} /> Gerar pagamento</>} onFechar={() => setGerando(null)} ocupado={ocupado}>
            <p>
              {diariasTexto(selecionadas.length)} de {pessoasSelecionadas} pessoa(s), total <strong>{brl(totalSelecionado)}</strong>.
              {pessoasSelecionadas > 1 && " Sai um título para cada pessoa."}
            </p>
            <FormField label="Vencimento" required>
              <TextField type="date" value={gerando.dueDate} onChange={(e) => setGerando({ ...gerando, dueDate: e.target.value })} />
            </FormField>
            <FormField label="Observação">
              <Textarea rows={2} value={gerando.notes} onChange={(e) => setGerando({ ...gerando, notes: e.target.value })} />
            </FormField>
            <p className="extras-sub">As diárias ficam travadas enquanto estiverem no pagamento. O título aparece em Contas a Pagar com a etiqueta "Extra".</p>
            <div className="extras-acoes">
              <Button variant="secondary" onClick={() => setGerando(null)} disabled={ocupado}>Cancelar</Button>
              <Button onClick={() => void confirmarGeracao()} disabled={ocupado || !gerando.dueDate}>{ocupado ? "Gerando…" : "Gerar pagamento"}</Button>
            </div>
        </Janela>
      )}

      {cancelando && (
        <Janela titulo={`Cancelar pagamento ${cancelando.pg.code}`} onFechar={() => setCancelando(null)} ocupado={ocupado}>
            <p>{cancelando.pg.nome} · {brl(cancelando.pg.amount)}. As diárias voltam para "Para pagar" e o título sai do Contas a Pagar.</p>
            <FormField label="Motivo" required>
              <TextField value={cancelando.motivo} onChange={(e) => setCancelando({ ...cancelando, motivo: e.target.value })} autoFocus placeholder="Ex.: valor de uma diária estava errado" />
            </FormField>
            <div className="extras-acoes">
              <Button variant="secondary" onClick={() => setCancelando(null)} disabled={ocupado}>Voltar</Button>
              <Button variant="danger" onClick={() => void confirmarCancelamento()} disabled={ocupado}>Cancelar pagamento</Button>
            </div>
        </Janela>
      )}
    </div>
  );
}
