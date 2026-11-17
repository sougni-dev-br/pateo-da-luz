import { Banknote, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Decimo13Linha, Decimo13LinhaClt, gerarDecimoTerceiro, getDecimoTerceiro, getListaDecimo13 } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { useSession } from "../context/SessionContext";
import { Alert, Button, EmptyState, IconButton, Money, StatusBadge, SummaryCard, Table, Tabs, TextField } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { codigoDaListaDecimo, listaDecimoParaPdf, regrasDaListaDecimo, seloDaListaDecimo } from "./decimo13/listaPdf";
import { competenciaPdf, gerarPdfListaPagamento } from "./gorjeta/pdfFolhaLiquidos";
import { descreverParcela, parcelaClt, parcelaDaLinha, resumirClt, resumirParcela, type Parcela13 } from "./decimo13/parcelas";
import { VariavelInformada } from "./decimo13/VariavelInformada";
import { nomeProprio } from "./gorjeta/NomePessoa";
import { LinkInterno, linkContasAPagar } from "./folha/LinkInterno";
import { type Passo, Passos } from "./folha/Passos";
import "./folha/folha-ui.css";

const fmtData = (iso: string) => iso.split("-").reverse().join("/");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type SituacaoLinha = ReturnType<typeof parcelaDaLinha>;
const toneDaSituacao = (p: SituacaoLinha) =>
  p.situacao === "PAGA" ? "success"
    : p.situacao === "LANCADA" ? "info"
    : p.situacao === "EXCLUIDA" || p.situacao === "AGUARDANDO_EXTRATO" || p.situacao === "AGUARDANDO_1A" ? "neutral"
    : p.situacao === "SOMADA" ? (p.gerar ? "warning" : "success")
    : "warning";
const rotuloDaSituacao = (p: SituacaoLinha) =>
  p.situacao === "PAGA" ? "Paga"
    : p.situacao === "LANCADA" ? "Lançada"
    : p.situacao === "SOMADA" ? (p.gerar ? "Somada (atualizar)" : "Somada ao título")
    : p.situacao === "CONFERIR" ? "Conferir título pago"
    : p.situacao === "EXCLUIDA" ? "Excluída à mão"
    : p.situacao === "AGUARDANDO_EXTRATO" ? "Aguardando extrato"
    : p.situacao === "AGUARDANDO_1A" ? "Lance a 1ª primeiro"
    : p.somaNoTitulo ? "Falta somar ao título"
    : "Falta lançar";

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
  const [somasOrfas, setSomasOrfas] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busca, setBusca] = useState("");
  const [avisosDaGeracao, setAvisosDaGeracao] = useState<string[]>([]);
  const [imprimindo, setImprimindo] = useState(false);

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
      setSomasOrfas(r.somasOrfas ?? 0);
    } catch (e) {
      if (meu !== pedido.current) return;
      setLinhas(null);
      setClt([]);
      setAvisosDaBase([]);
      setSomasOrfas(0);
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
        (r.somadas ?? 0) > 0 ? `${r.somadas} com valor a mais (salário combinado ou período sem registro) somado ao título do extrato` : null,
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

  // A lista que se leva ao banco: o mesmo PDF do adiantamento e da 1ª quinzena, com os dados do 13º.
  async function imprimirLista() {
    if (imprimindo) return;
    setImprimindo(true);
    try {
      const lista = await getListaDecimo13(year, parcela);
      const competencia = competenciaPdf(year, parcela === 1 ? 11 : 12);
      const codigo = codigoDaListaDecimo(year, parcela);
      // Só mostra o vencimento se for um só: cada empresa pode ter o seu e a primeira da lista não vale para todas.
      const vencimentos = new Set(lista.linhas.filter((l) => l.situacao !== "PAGO").map((l) => l.vencimento));
      const venc = vencimentos.size === 1 ? [...vencimentos][0] : null;
      await gerarPdfListaPagamento(listaDecimoParaPdf(lista), {
        titulo: `13º salário - ${parcela}ª parcela - lista de pagamento`,
        apoio: `Competência ${competencia}${venc ? `   |   vencimento ${fmtData(venc)}` : ""}`,
        codigo, selo: seloDaListaDecimo(lista), regras: regrasDaListaDecimo(parcela, lista.aguardandoExtrato ?? []),
        rotuloValor: "Valor", rotuloTotal: "Total a pagar",
        subtituloGrupo: (g) => (g === "Sem registro" ? "valor calculado pelo sistema" : "valor do título: extrato da contabilidade, mais o combinado ou o período sem registro quando há"),
        rodape: `13º salário ${parcela}ª parcela ${year} - ${codigo}`, arquivo: `${codigo}.pdf`, modo: "empresa", umaFolha: true,
      });
      setAvisosDaGeracao(lista.avisos);
    } catch (e) {
      setNotice({ tone: "error", message: `Erro ao gerar o PDF: ${e instanceof Error ? e.message : "tente de novo"}` });
    } finally {
      setImprimindo(false);
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
  // Somas órfãs (título carrega uma diferença do combinado que não vale mais): lançar a 1ª desfaz.
  const orfas = parcela === 1 ? somasOrfas : 0;
  const aGerar = r.novas + r.somar + r.atualizar + orfas;
  const totalGeral = r.totalNovas + r.totalLancado + rc.total;
  const podeGerar = canEdit && aGerar > 0 && !confirmando && (parcela === 1 || novembroFechado);

  const termo = semAcento(busca.trim());
  const bate = (nome: string) => termo === "" || semAcento(nome).includes(termo);
  const vistosSr = itens.filter((i) => bate(i.l.nome));
  const vistosClt = itensClt.filter((i) => bate(i.l.nome));
  const gruposSr = [
    { chave: "sr", titulo: "Sem registro", apoio: "calculado aqui; título próprio no Contas a Pagar", itens: vistosSr.filter(({ l }) => !l.preRegistro && l.origem !== "COMBINADO") },
    { chave: "pre", titulo: "Registrados depois de começar", apoio: "só o período sem registro; soma no título do extrato (um título só)", itens: vistosSr.filter(({ l }) => l.preRegistro && l.origem !== "COMBINADO") },
    { chave: "comb", titulo: "Salário combinado", apoio: "só a diferença sobre o registrado; soma no título do extrato (um título só)", itens: vistosSr.filter(({ l }) => l.origem === "COMBINADO") },
  ];
  const porPessoa = new Map((linhas ?? []).map((l) => [l.employeeId, l] as const));

  const botaoLancar = podeGerar ? (
    <Button leadingIcon={<Banknote size={14} />} onClick={() => setConfirmando(true)}>Lançar {parcela}ª parcela ({aGerar})</Button>
  ) : undefined;
  const aguardaNovembro = parcela === 2 && !novembroFechado && aGerar > 0;
  const passos: Passo[] = [
    { titulo: "Conferir o cálculo", estado: "feito",
      detalhe: `${r.pessoas} calculada(s) aqui${r.semCalculo > 0 ? ` · ${r.semCalculo} sem cálculo` : ""}` },
    { titulo: "Lançar no Contas a Pagar", estado: aGerar > 0 ? "atual" : "feito", acao: botaoLancar,
      detalhe: aguardaNovembro ? "Disponível quando a gorjeta de novembro estiver fechada: a média precisa dela"
        : aGerar > 0 ? [`Falta lançar ${brl(r.totalNovas)}`, r.novas > 0 ? `${r.novas} título(s) novo(s)` : null, r.somar > 0 ? `${r.somar} somado(s) ao título do extrato` : null, r.atualizar > 0 ? `${r.atualizar} a atualizar` : null].filter(Boolean).join(" · ")
        : r.pessoas > 0 ? "Tudo lançado" : "Nada a lançar" },
    { titulo: "Dar a baixa", estado: aGerar > 0 ? "pendente" : "atual",
      detalhe: r.lancadas > 0 ? "Pague e dê a baixa no Contas a Pagar" : "Depois de lançar, a baixa é no Contas a Pagar",
      acao: r.lancadas > 0 || lancadasClt > 0 ? (
        <>
          <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} disabled={imprimindo} onClick={() => void imprimirLista()}>
            {imprimindo ? "Gerando…" : "PDF para pagamento"}
          </Button>
          {vencimento ? <LinkInterno para={linkContasAPagar(vencimento)} className="ds-button ds-button-md ds-button-secondary">Abrir no Contas a Pagar</LinkInterno> : null}
        </>
      ) : undefined },
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

            {avisosDaBase.length > 0 && (
              <Alert tone="warning">
                {avisosDaBase.length === 1 ? <div>{avisosDaBase[0]}</div> : (
                  <details className="folha-aviso-longo">
                    <summary>{avisosDaBase.length} avisos sobre a base da média (clique para ver)</summary>
                    {avisosDaBase.map((a, i) => <p key={i}>{a}</p>)}
                  </details>
                )}
              </Alert>
            )}
            {avisosDaGeracao.length > 0 && <Alert tone="warning">{avisosDaGeracao.map((a, i) => <div key={i}>{a}</div>)}</Alert>}

            {confirmando && (
              <Alert tone="warning">
                <div>
                  Vai criar {r.novas} título(s) novo(s) da {parcela}ª parcela, somar {r.somar} ao título do extrato (um título só por pessoa) e atualizar {r.atualizar + orfas} em aberto ({brl(r.totalNovas)} a mais no total), com vencimento em {vencimento ? fmtData(vencimento) : "—"}. Parcela já paga não muda.
                </div>
                <div className="form-actions">
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmando(false)}>Cancelar</Button>
                  <Button disabled={busy} onClick={() => void lancar()}>{busy ? "Lançando…" : "Confirmar lançamento"}</Button>
                </div>
              </Alert>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, margin: "0 0 16px" }}>
              <SummaryCard compact label="Falta lançar" moneyValue={r.totalNovas} tone={aGerar > 0 ? "warning" : undefined} detail={`${r.novas + r.somar} pessoa(s)${r.atualizar > 0 ? ` · ${r.atualizar} a atualizar` : ""}`} />
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
                      {gruposSr.map((g) => g.itens.length > 0 && (
                        <Fragment key={g.chave}>
                          <Table.Row className="folha-grupo">
                            <Table.Td colSpan={6}>
                              <div className="folha-grupo-titulo">{g.titulo} <small>{g.apoio} · {g.itens.length}</small></div>
                            </Table.Td>
                          </Table.Row>
                          {g.itens.map(({ l, p }) => (
                        <Table.Row key={`${l.employeeId}-${l.origem ?? "SEM_REGISTRO"}`}>
                          <Table.Td>
                            <strong>{nomeProprio(l.nome)}</strong>
                            {l.setor ? <span className="folha-nota">{l.setor}</span> : null}
                            {l.origem === "COMBINADO" ? (
                              <span className="folha-nota">{l.p1.somadaAoExtrato && parcela === 1 ? "já somada ao título do extrato abaixo (não pague de novo)" : "o 13º do registrado vem do extrato da contabilidade"}</span>
                            ) : null}
                            {l.preRegistro && l.semRegistroAte && l.registroEm ? (
                              <span className="folha-nota">sem registro até {fmtData(l.semRegistroAte)} · registrado em {fmtData(l.registroEm)}</span>
                            ) : null}
                            {l.somaNoExtrato && l.origem !== "COMBINADO" && parcela === 1 ? (
                              <span className="folha-nota">{l.p1.somadaAoExtrato ? "já somada ao título do extrato abaixo (não pague de novo)"
                                : l.p1.aguardaExtrato ? "aguarda o extrato do 13º para somar ao título" : null}</span>
                            ) : null}
                            {l.origem === "COMBINADO" ? null : (
                              <VariavelInformada linha={l} ano={year} podeEditar={canEdit} aoMudar={carregar} aoErro={(message) => setNotice({ tone: "error", message })} />
                            )}
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
                                <StatusBadge tone={toneDaSituacao(p)}>
                                  {rotuloDaSituacao(p)}
                                </StatusBadge>
                              </Table.Td>
                            </>
                          ) : (
                            <Table.Td colSpan={5} style={{ color: "var(--muted)" }}>{l.motivoSemCalculo}</Table.Td>
                          )}
                        </Table.Row>
                          ))}
                        </Fragment>
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
                          <Table.Td colSpan={3} style={{ color: "var(--muted)" }}>
                            {p.situacao === "AGUARDANDO_EXTRATO" ? "" : "valor do extrato"}
                            {(() => {
                              const sr = parcela === 1 ? porPessoa.get(l.employeeId) : undefined;
                              if (!sr?.somaNoExtrato || !sr.viaExtrato || !sr.p1.gerar || !sr.calculo) return null;
                              return <span className="folha-nota">ao lançar: + {brl(sr.calculo.parcela1)} {sr.origem === "COMBINADO" ? "da diferença do combinado" : "do período sem registro"} → título de {brl(p.valor + sr.calculo.parcela1)}</span>;
                            })()}
                          </Table.Td>
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
