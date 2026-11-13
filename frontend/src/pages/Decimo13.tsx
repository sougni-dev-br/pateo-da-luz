import { Banknote, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Decimo13Linha, Decimo13LinhaClt, gerarDecimoTerceiro, getDecimoTerceiro } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Alert, Button, EmptyState, IconButton, Money, StatusBadge, SummaryCard, Table, Tabs, TextField } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { descreverParcela, parcelaClt, parcelaDaLinha, resumirClt, resumirParcela, type Parcela13 } from "./decimo13/parcelas";
import { nomeProprio } from "./gorjeta/NomePessoa";
import { LinkInterno, linkContasAPagar } from "./folha/LinkInterno";
import { type Passo, Passos } from "./folha/Passos";
import "./folha/folha-ui.css";

const fmtData = (iso: string) => iso.split("-").reverse().join("/");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

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
  // A 2ª parcela depende da média: só se gera com a gorjeta de novembro fechada.
  const [novembroFechado, setNovembroFechado] = useState(false);
  const [avisosDaBase, setAvisosDaBase] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busca, setBusca] = useState("");
  const [avisosDaGeracao, setAvisosDaGeracao] = useState<string[]>([]);

  // Só a resposta da última consulta vale: trocar de ano rápido não deixa linhas do ano anterior na tela.
  const pedido = useRef(0);
  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setErro(null);
    try {
      const r = await getDecimoTerceiro(year);
      if (meu !== pedido.current) return;
      setLinhas(r.linhas);
      setClt(r.clt ?? []);
      setNovembroFechado(r.novembroFechado);
      setAvisosDaBase(r.avisos);
    } catch (e) {
      if (meu !== pedido.current) return;
      setLinhas(null);
      setClt([]);
      setAvisosDaBase([]);
      setErro(e instanceof Error ? e.message : "Não foi possível calcular o 13º.");
    }
  }, [year]);
  useEffect(() => {
    setLinhas(null);
    setConfirmando(false);
    setAvisosDaGeracao([]);
    if (podeVer) void carregar();
  }, [carregar, podeVer]);

  async function lancar() {
    setBusy(true);
    setAvisosDaGeracao([]);
    try {
      const r = await gerarDecimoTerceiro(year, parcela);
      const partes = [
        r.criadas + r.restauradas > 0 ? `${r.criadas + r.restauradas} lançada(s)` : null,
        r.atualizadas > 0 ? `${r.atualizadas} atualizada(s)` : null,
      ].filter(Boolean);
      setNotice(partes.length > 0
        ? { tone: "success", message: `${parcela}ª parcela do 13º: ${partes.join(" e ")} no Contas a Pagar. A baixa é feita lá.` }
        : { tone: "info", message: `Nada a lançar na ${parcela}ª parcela: tudo o que podia ser lançado já está lançado e atualizado.` });
      setAvisosDaGeracao(r.avisos);
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
  const itensClt = clt.map((l) => ({ l, p: parcelaClt(l, parcela) }));
  const r = resumirParcela(itens.map((i) => i.p));
  const rc = resumirClt(itensClt.map((i) => i.p));
  const vencimento = itens.find((i) => i.p.vencimento)?.p.vencimento ?? null;
  const lancadasClt = rc.pessoas - rc.aguardando;
  const aGerar = r.novas + r.atualizar;
  const totalGeral = r.totalNovas + r.totalLancado + rc.total;
  const podeGerar = canEdit && aGerar > 0 && !confirmando && (parcela === 1 || novembroFechado);

  const termo = semAcento(busca.trim());
  const bate = (nome: string) => termo === "" || semAcento(nome).includes(termo);
  const vistosSr = itens.filter((i) => bate(i.l.nome));
  const vistosClt = itensClt.filter((i) => bate(i.l.nome));

  const botaoLancar = podeGerar ? (
    <Button leadingIcon={<Banknote size={14} />} onClick={() => setConfirmando(true)}>Lançar {parcela}ª parcela ({aGerar})</Button>
  ) : undefined;
  const aguardaNovembro = parcela === 2 && !novembroFechado && aGerar > 0;
  const passos: Passo[] = [
    { titulo: "Conferir o cálculo", estado: "feito",
      detalhe: `${r.pessoas} calculada(s) aqui${r.semCalculo > 0 ? ` · ${r.semCalculo} sem cálculo` : ""}` },
    { titulo: "Lançar no Contas a Pagar", estado: aGerar > 0 ? "atual" : "feito", acao: botaoLancar,
      detalhe: aguardaNovembro ? "Disponível quando a gorjeta de novembro estiver fechada: a média precisa dela"
        : aGerar > 0 ? [r.novas > 0 ? `Falta lançar ${r.novas} (${brl(r.totalNovas)})` : null, r.atualizar > 0 ? `${r.atualizar} a atualizar` : null].filter(Boolean).join(" · ")
        : r.pessoas > 0 ? "Tudo lançado" : "Nada a lançar" },
    { titulo: "Dar a baixa", estado: aGerar > 0 ? "pendente" : "atual",
      detalhe: r.lancadas > 0 ? "Pague e dê a baixa no Contas a Pagar" : "Depois de lançar, a baixa é no Contas a Pagar",
      acao: r.lancadas > 0 && vencimento ? <LinkInterno para={linkContasAPagar(vencimento)} className="ds-button ds-button-md ds-button-secondary">Abrir no Contas a Pagar</LinkInterno> : undefined },
  ];

  return (
    <div className="stack folha-tela">
      <Notice notice={notice} />
      <section className="panel">
        <h2 className="folha-sr">13º salário {year}</h2>

        <div className="folha-barra">
          <Tabs aria-label="Parcela do 13º" value={String(parcela)}
            tabs={[{ value: "1", label: "1ª parcela" }, { value: "2", label: "2ª parcela" }]}
            onChange={(v) => { setParcela(v === "2" ? 2 : 1); setConfirmando(false); }} />
          <div className="folha-competencia" role="group" aria-label="Ano">
            <IconButton size="sm" label="Ano anterior" icon={<ChevronLeft size={16} />} onClick={() => setYear((y) => y - 1)} />
            <strong>{year}</strong>
            <IconButton size="sm" label="Próximo ano" icon={<ChevronRight size={16} />} onClick={() => setYear((y) => y + 1)} />
          </div>
        </div>

        <p className="folha-regra">
          <b>{descreverParcela(parcela, vencimento ? fmtData(vencimento) : null).split(" · ")[0]}</b>
          <span>{descreverParcela(parcela, null).split(" · ").slice(1).join(" · ")}</span>
        </p>

        {erro && <Alert tone="error">{erro}</Alert>}
        {!linhas && !erro && <EmptyState title="Calculando o 13º…" />}

        {linhas && (
          <>
            <Passos rotulo={`Passos da ${parcela}ª parcela`} passos={passos} />

            {avisosDaBase.length > 0 && <Alert tone="warning">{avisosDaBase.map((a, i) => <div key={i}>{a}</div>)}</Alert>}
            {avisosDaGeracao.length > 0 && <Alert tone="warning">{avisosDaGeracao.map((a, i) => <div key={i}>{a}</div>)}</Alert>}

            {confirmando && (
              <Alert tone="warning">
                <div>
                  Vai lançar {r.novas} título(s) novo(s) da {parcela}ª parcela ({brl(r.totalNovas)}), com vencimento em {vencimento ? fmtData(vencimento) : "—"}
                  {r.atualizar > 0 ? ` e atualizar ${r.atualizar} em aberto para o cálculo de hoje` : ""}. Parcela já paga não muda.
                </div>
                <div className="form-actions">
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmando(false)}>Cancelar</Button>
                  <Button disabled={busy} onClick={() => void lancar()}>{busy ? "Lançando…" : "Confirmar lançamento"}</Button>
                </div>
              </Alert>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "0 0 16px" }}>
              <SummaryCard compact label="Falta lançar" moneyValue={r.totalNovas} tone={aGerar > 0 ? "warning" : undefined} detail={`${r.novas} pessoa(s)${r.atualizar > 0 ? ` · ${r.atualizar} a atualizar` : ""}`} />
              <SummaryCard compact label="Já no Contas a Pagar" moneyValue={r.totalLancado + rc.total} detail={`${r.lancadas + lancadasClt} pessoa(s)`} />
              <SummaryCard compact label={`Total da ${parcela}ª parcela`} moneyValue={totalGeral} detail={`${r.pessoas + lancadasClt} pessoa(s)`} />
            </div>

            {linhas.length === 0 && clt.length === 0 ? (
              <EmptyState title="Ninguém com 13º a calcular neste ano." description="Confira se os funcionários têm data de admissão e salário no cadastro." />
            ) : (
              <>
                <div className="folha-barra" style={{ marginBottom: 8 }}>
                  <TextField className="folha-filtro" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar por nome" aria-label="Filtrar por nome" />
                </div>
                <div style={{ overflowX: "auto" }}>
                  <Table className="folha-tabela">
                    <Table.Head>
                      <Table.Row>
                        <Table.Th minWidth={180}>Funcionário</Table.Th>
                        <Table.Th>Avos</Table.Th>
                        <Table.Th align="right">Salário</Table.Th>
                        <Table.Th align="right">Média variáveis</Table.Th>
                        <Table.Th align="right">{parcela}ª parcela</Table.Th>
                        <Table.Th>Situação</Table.Th>
                      </Table.Row>
                    </Table.Head>
                    <Table.Body>
                      {itens.length > 0 && (
                        <Table.Row className="folha-grupo">
                          <Table.Td colSpan={6}>
                            <div className="folha-grupo-titulo">Sem registro <small>calculado aqui · {vistosSr.length} de {itens.length}</small></div>
                          </Table.Td>
                        </Table.Row>
                      )}
                      {vistosSr.map(({ l, p }) => (
                        <Table.Row key={l.employeeId}>
                          <Table.Td>
                            <strong>{nomeProprio(l.nome)}</strong>
                            {l.setor ? <span className="folha-nota">{l.setor}</span> : null}
                            {l.preRegistro && l.semRegistroAte && l.registroEm ? (
                              <span className="folha-nota">só o período sem registro (até {fmtData(l.semRegistroAte)}); registrado em {fmtData(l.registroEm)}, o resto vem da contabilidade</span>
                            ) : null}
                          </Table.Td>
                          {l.calculo ? (
                            <>
                              <Table.Td title={l.calculo.memoria}>{parcela === 1 ? l.calculo.avosParcela1 : l.calculo.avos}/12 <span className="folha-nota" style={{ display: "inline" }}>desde {fmtData(l.calculo.desde)}</span></Table.Td>
                              <Table.Td align="right" className="num"><Money value={l.calculo.salario} /></Table.Td>
                              <Table.Td align="right" className="num"><Money value={parcela === 1 ? l.calculo.mediaParcela1 : l.calculo.mediaFinal} /></Table.Td>
                              <Table.Td align="right" className="num" style={{ fontWeight: 600 }}>
                                {p.situacao === "EXCLUIDA" ? <span style={{ color: "var(--muted)" }}>—</span> : <Money value={p.valor} />}
                                {p.atualizarPara != null && <span className="folha-nota">passa a {brl(p.atualizarPara)} ao gerar de novo</span>}
                                {parcela === 2 && l.acerto != null && Math.abs(l.acerto) >= 0.01 && (
                                  <span className="folha-nota">{l.acerto > 0 ? `falta pagar ${brl(l.acerto)} (acerto)` : `pago a mais ${brl(-l.acerto)}`}</span>
                                )}
                              </Table.Td>
                              <Table.Td>
                                <StatusBadge tone={p.situacao === "PAGA" ? "success" : p.situacao === "LANCADA" ? "info" : p.situacao === "EXCLUIDA" ? "neutral" : "warning"}>
                                  {p.situacao === "PAGA" ? "Paga" : p.situacao === "LANCADA" ? "Lançada" : p.situacao === "EXCLUIDA" ? "Excluída à mão" : "Falta lançar"}
                                </StatusBadge>
                              </Table.Td>
                            </>
                          ) : (
                            <Table.Td colSpan={5} style={{ color: "var(--muted)" }}>{l.motivoSemCalculo}</Table.Td>
                          )}
                        </Table.Row>
                      ))}

                      {itensClt.length > 0 && (
                        <Table.Row className="folha-grupo">
                          <Table.Td colSpan={6}>
                            <div className="folha-grupo-titulo">
                              CLT <small>o cálculo é da contabilidade: o valor aparece quando o extrato é importado em Retorno do RH · {lancadasClt} de {itensClt.length} importados</small>
                            </div>
                          </Table.Td>
                        </Table.Row>
                      )}
                      {vistosClt.map(({ l, p }) => (
                        <Table.Row key={l.employeeId}>
                          <Table.Td>
                            <strong>{nomeProprio(l.nome)}</strong>
                            {l.setor ? <span className="folha-nota">{l.setor}</span> : null}
                          </Table.Td>
                          <Table.Td colSpan={3} style={{ color: "var(--muted)" }}>{p.situacao === "AGUARDANDO_EXTRATO" ? "" : "valor do extrato"}</Table.Td>
                          <Table.Td align="right" className="num" style={{ fontWeight: 600 }}>{p.situacao === "AGUARDANDO_EXTRATO" ? <span style={{ color: "var(--muted)" }}>—</span> : <Money value={p.valor} />}</Table.Td>
                          <Table.Td>
                            <StatusBadge tone={p.situacao === "PAGA" ? "success" : p.situacao === "LANCADA" ? "info" : "neutral"}>
                              {p.situacao === "PAGA" ? "Paga" : p.situacao === "LANCADA" ? "No Contas a Pagar" : "Aguardando extrato"}
                            </StatusBadge>
                          </Table.Td>
                        </Table.Row>
                      ))}

                      {vistosSr.length + vistosClt.length === 0 && (
                        <Table.Row><Table.Td colSpan={6} style={{ color: "var(--muted)" }}>Ninguém com “{busca}”.</Table.Td></Table.Row>
                      )}
                      <Table.Row className="folha-total">
                        <Table.Td colSpan={4}>Total da {parcela}ª parcela</Table.Td>
                        <Table.Td align="right" className="num"><Money value={totalGeral} /></Table.Td>
                        <Table.Td />
                      </Table.Row>
                    </Table.Body>
                  </Table>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
