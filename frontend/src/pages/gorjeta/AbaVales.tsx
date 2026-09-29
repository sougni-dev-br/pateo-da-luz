// Aba "Vales": o que foi adiantado no restaurante (adiantamento, refeição,
// retirada de caixa…) e é abatido da gorjeta antes do envio à contabilidade.
// Tudo fica gravado: corrigir e cancelar deixam autor e motivo; cancelado
// continua na lista e nos relatórios, só deixa de descontar.
import { Ban, Check, Download, Pencil, Printer, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type TipValeDescricao, type TipValeLancado, type TipValeType, type TipValesPeriodo, addTipVale, cancelarTipVale, editarTipVale,
  emitirReciboVale, getTipCompanies, getTipValeDescricoes, getTipVales,
} from "../../api/client";
import { FormLancarVale, type NovoVale } from "./FormLancarVale";
import { imprimirReciboVale } from "./reciboVale";
import { Button, StatusBadge, Table } from "../../design-system";
import { VALE_LABELS, baixarCsv, money, mutedStyle, panelStyle } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Props = {
  year: number;
  month: number;
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  /** Um vale mudou: a apuração e o pagamento precisam recarregar. */
  onChanged: () => void;
  /** Pessoa para já abrir filtrada (vindo do atalho da Apuração). */
  pessoaInicial?: string | null;
};

const TIPOS: TipValeType[] = ["ADIANTAMENTO", "REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "OUTRO", "CREDITO"];
const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const sinal = (v: TipValeLancado) => (v.type === "CREDITO" ? v.amount : -v.amount);

type Formulario = { participantId: string; type: TipValeType; amount: string; date: string; notes: string };
const CHAVE_EMPRESA = "gorjeta-vales-empresa-recibo";
const lerEmpresa = () => { try { return window.localStorage.getItem(CHAVE_EMPRESA) ?? ""; } catch { return ""; } };

const EXT: Extratores<TipValeLancado> = {
  data: (v) => v.date ?? v.lancadoEm, nome: (v) => v.nome, tipo: (v) => VALE_LABELS[v.type], valor: (v) => sinal(v),
  obs: (v) => v.notes, por: (v) => v.lancadoPor,
};

export function AbaVales({ year, month, canEdit, onNotice, onChanged, pessoaInicial = null }: Props) {
  const [dados, setDados] = useState<TipValesPeriodo | null>(null);
  const [descricoes, setDescricoes] = useState<TipValeDescricao[]>([]);
  const [empresas, setEmpresas] = useState<Array<{ id: string; tradeName: string }>>([]);
  // Recibo de quem não tem empresa no cadastro (sem registro): escolhe a emitente.
  const [ultimoRecibo, setUltimoRecibo] = useState<{ url: string; codigo: string } | null>(null);
  const [escolherEmpresa, setEscolherEmpresa] = useState<{ valeId: string; nome: string; empresaId: string } | null>(null);
  const [editando, setEditando] = useState<(Formulario & { id: string }) | null>(null);
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);
  const [filtroPessoa, setFiltroPessoa] = useState(pessoaInicial ?? "");
  const [verCancelados, setVerCancelados] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ord = useOrdenacao("vales");
  const erro = (e: unknown) => onNotice("error", (e as Error).message);

  async function carregar() {
    try { setDados(await getTipVales(year, month)); } catch (e) { erro(e); }
  }
  async function carregarDescricoes() {
    try { setDescricoes(await getTipValeDescricoes()); } catch (e) { erro(e); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDados(null); void carregar(); }, [year, month]);
  useEffect(() => {
    void carregarDescricoes();
    getTipCompanies().then(setEmpresas).catch(erro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recibo: registra a emissão, gera o PDF e abre a caixa de impressão; o link fica à mão.
  async function imprimir(valeId: string, empresaId: string | null) {
    try {
      const r = await emitirReciboVale(valeId, empresaId);
      const url = await imprimirReciboVale(r);
      setUltimoRecibo({ url, codigo: r.codigo ?? "" });
      if (empresaId) { try { window.localStorage.setItem(CHAVE_EMPRESA, empresaId); } catch { /* só não lembra */ } }
      await carregar();
    } catch (e) {
      erro(e);
    }
  }
  function pedirRecibo(valeId: string, participantId: string, nome: string) {
    const pessoa = dados?.pessoas.find((p) => p.participantId === participantId);
    if (pessoa?.empresaId) { void imprimir(valeId, pessoa.empresaId); return; }
    setEscolherEmpresa({ valeId, nome, empresaId: lerEmpresa() || empresas[0]?.id || "" });
  }

  const fechado = dados?.status === "CLOSED";
  const pode = canEdit && !fechado;
  const ativos = useMemo(() => (dados?.vales ?? []).filter((v) => !v.canceladoEm), [dados]);
  const pessoas = useMemo(() => [...(dados?.pessoas ?? [])].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [dados]);

  async function depoisDeMudar(mensagem: string) {
    await carregar();
    onChanged();
    onNotice("success", mensagem);
  }

  async function lancar(v: NovoVale): Promise<boolean> {
    const pessoa = dados?.pessoas.find((p) => p.participantId === v.participantId);
    setOcupado(true);
    try {
      const criado = await addTipVale(v.participantId, { type: v.type, amount: v.amount, date: v.date || undefined, notes: v.notes || undefined });
      await depoisDeMudar(`Vale ${criado.codigo ?? ""} lançado.`);
      if (v.imprimir) {
        if (pessoa?.empresaId) await imprimir(criado.id, pessoa.empresaId);
        else setEscolherEmpresa({ valeId: criado.id, nome: pessoa?.nome ?? "", empresaId: lerEmpresa() || empresas[0]?.id || "" });
      }
      return true;
    } catch (e) {
      erro(e);
      return false;
    } finally { setOcupado(false); }
  }

  async function salvarEdicao() {
    if (!editando) return;
    const amount = Number(editando.amount.replace(",", "."));
    setOcupado(true);
    try {
      await editarTipVale(editando.id, { type: editando.type, amount, date: editando.date || null, notes: editando.notes.trim() || null });
      setEditando(null);
      await depoisDeMudar("Vale corrigido. A alteração ficou registrada.");
    } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  async function cancelar() {
    if (!cancelando) return;
    setOcupado(true);
    try {
      await cancelarTipVale(cancelando.id, cancelando.motivo.trim());
      setCancelando(null);
      await depoisDeMudar("Vale cancelado. Ele continua no histórico, mas não desconta mais.");
    } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  function exportar() {
    if (!dados) return;
    baixarCsv(`gorjeta-vales-${dados.code}.csv`, [
      ["Data", "Funcionário", "Tipo", "Descrição", "Valor", "Lançado por", "Lançado em", "Situação", "Motivo do cancelamento"],
      ...(dados.vales).map((v) => [dia(v.date), v.nome, VALE_LABELS[v.type], v.notes, sinal(v), v.lancadoPor, quando(v.lancadoEm),
        v.canceladoEm ? `Cancelado por ${v.canceladoPor ?? "—"} em ${quando(v.canceladoEm)}` : "Ativo", v.motivoCancelamento]),
    ]);
  }

  if (!dados) return <div style={panelStyle}><span style={mutedStyle}>Carregando os vales…</span></div>;

  const totalDescontos = ativos.filter((v) => v.type !== "CREDITO").reduce((a, v) => a + v.amount, 0);
  const totalCreditos = ativos.filter((v) => v.type === "CREDITO").reduce((a, v) => a + v.amount, 0);
  const gorjeta = pessoas.reduce((a, p) => a + p.gorjeta, 0);
  const liquida = pessoas.reduce((a, p) => a + p.liquida, 0);
  const lista = aplicarOrdem(
    dados.vales.filter((v) => (verCancelados || !v.canceladoEm) && (!filtroPessoa || v.participantId === filtroPessoa)),
    ord.ordem, EXT,
  );
  const comVales = pessoas.filter((p) => p.descontos > 0 || p.creditos > 0);
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "valor" ? "desc" : "asc") });

  return (
    <div className="aba-vales" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {fechado && (
        <div className="estado-vazio" style={{ alignItems: "flex-start", textAlign: "left" }}>
          <strong>Período fechado.</strong>
          <span>Os vales abaixo já foram abatidos da gorjeta enviada. Para lançar, corrigir ou cancelar, reabra o período na aba Apuração.</span>
        </div>
      )}

      <div className="cards-totais">
        {[
          { rotulo: "Gorjeta do rateio", valor: gorjeta, detalhe: `${pessoas.length} pessoas`, cor: "var(--info)" },
          { rotulo: "Vales (descontos)", valor: totalDescontos ? -totalDescontos : 0, detalhe: `${ativos.filter((v) => v.type !== "CREDITO").length} lançamentos`, cor: "var(--danger)" },
          { rotulo: "Créditos", valor: totalCreditos, detalhe: "somam à gorjeta", cor: "var(--success)" },
          { rotulo: "Gorjeta líquida", valor: liquida, detalhe: "vai para o pagamento e a contabilidade", cor: "var(--gold)" },
        ].map((c) => (
          <div key={c.rotulo} className="card-total" style={{ boxShadow: `inset 3px 0 0 ${c.cor}` }}>
            <span>{c.rotulo}</span>
            <strong>{money(c.valor)}</strong>
            <small>{c.detalhe}</small>
          </div>
        ))}
      </div>

      {pode && (
        <div style={panelStyle}>
          <FormLancarVale
            pessoas={pessoas.filter((p) => p.participantId).map((p) => ({
              participantId: p.participantId!, nome: p.nome, funcao: p.funcao, empresa: p.empresa, semRegistro: p.semRegistro, liquida: p.liquida,
            }))}
            descricoes={descricoes} pessoaInicial={pessoaInicial ?? ""} ocupado={ocupado}
            onLancar={lancar} onDescricoesMudaram={() => void carregarDescricoes()} onErro={erro} />
        </div>
      )}

      {ultimoRecibo && (
        <div className="aviso-recibo" role="status">
          <Printer size={14} /> Recibo {ultimoRecibo.codigo} enviado para impressão.
          <a href={ultimoRecibo.url} target="_blank" rel="noopener noreferrer" download={`Recibo_${ultimoRecibo.codigo}.pdf`}>Abrir o PDF</a>
          <button type="button" className="barra-lista-link" onClick={() => setUltimoRecibo(null)}>fechar</button>
        </div>
      )}

      {escolherEmpresa && (
        <form className="painel-recibo" style={panelStyle} onSubmit={(e) => {
          e.preventDefault();
          const alvo = escolherEmpresa;
          setEscolherEmpresa(null);
          void imprimir(alvo.valeId, alvo.empresaId);
        }}>
          <strong>Recibo de {escolherEmpresa.nome}</strong>
          <span style={mutedStyle}>Sem empresa no cadastro (sem registro): escolha em nome de qual empresa sai o recibo.</span>
          <div className="barra-lista">
            <select value={escolherEmpresa.empresaId} onChange={(e) => setEscolherEmpresa({ ...escolherEmpresa, empresaId: e.target.value })} aria-label="Empresa do recibo">
              {empresas.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
            </select>
            <Button type="submit" size="sm" leadingIcon={<Printer size={14} />} disabled={!escolherEmpresa.empresaId}>Imprimir recibo</Button>
            <button type="button" className="barra-lista-link" onClick={() => setEscolherEmpresa(null)}>agora não</button>
          </div>
        </form>
      )}

      {comVales.length > 0 && (
        <div style={panelStyle}>
          <div className="cabecalho-painel-texto">
            <strong>Por pessoa</strong>
            <span>Clique numa pessoa para ver só os vales dela.</span>
          </div>
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={200}>Funcionário</Table.Th>
                <Table.Th>Gorjeta</Table.Th>
                <Table.Th>Vales</Table.Th>
                <Table.Th>Créditos</Table.Th>
                <Table.Th>Gorjeta líquida</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {comVales.map((p) => (
                <Table.Row key={p.employeeId} className={`linha-clicavel${filtroPessoa === p.participantId ? " linha-em-edicao" : ""}`}
                  onClick={() => setFiltroPessoa(filtroPessoa === p.participantId ? "" : p.participantId ?? "")}>
                  <Table.Td style={{ fontWeight: 500 }}>
                    {p.nome}
                    {p.liquida < 0 && <div style={{ ...mutedStyle, color: "var(--danger)" }}>vales maiores que a gorjeta</div>}
                  </Table.Td>
                  <Table.Td>{money(p.gorjeta)}</Table.Td>
                  <Table.Td style={{ color: "var(--danger)" }}>{p.descontos ? money(-p.descontos) : "—"}</Table.Td>
                  <Table.Td style={{ color: "var(--success)" }}>{p.creditos ? money(p.creditos) : "—"}</Table.Td>
                  <Table.Td style={{ fontWeight: 700 }}>{money(p.liquida)}</Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      <div style={panelStyle}>
        <div className="cabecalho-painel">
          <div className="cabecalho-painel-texto">
            <strong>Lançamentos {dados.code}</strong>
            <span>{ativos.length} ativo(s){dados.vales.length !== ativos.length ? ` · ${dados.vales.length - ativos.length} cancelado(s)` : ""}</span>
          </div>
          <div className="cabecalho-painel-acoes">
            <label className="barra-lista-campo">
              Pessoa
              <select value={filtroPessoa} onChange={(e) => setFiltroPessoa(e.target.value)}>
                <option value="">Todas</option>
                {pessoas.filter((p) => p.participantId).map((p) => <option key={p.participantId!} value={p.participantId!}>{p.nome}</option>)}
              </select>
            </label>
            <label className="barra-lista-campo">
              <input type="checkbox" checked={verCancelados} onChange={(e) => setVerCancelados(e.target.checked)} /> Mostrar cancelados
            </label>
            <Button variant="secondary" size="sm" leadingIcon={<Download size={14} />} onClick={exportar} disabled={dados.vales.length === 0}>Excel (CSV)</Button>
          </div>
        </div>
        {lista.length === 0 ? (
          <div className="estado-vazio">
            <strong>{dados.vales.length === 0 ? "Nenhum vale lançado neste período." : "Nenhum vale com esse filtro."}</strong>
            {dados.vales.length === 0 && <span>Lance aqui os adiantamentos e descontos feitos no restaurante: eles saem da gorjeta antes do envio à contabilidade.</span>}
          </div>
        ) : (
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <ThOrdenavel {...th("data")}>Data</ThOrdenavel>
                <ThOrdenavel {...th("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
                <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>
                <ThOrdenavel {...th("obs")} minWidth={180}>Descrição</ThOrdenavel>
                <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>
                <ThOrdenavel {...th("por")}>Lançado por</ThOrdenavel>
                <Table.Th>Recibo</Table.Th>
                <Table.Th aria-label="Ações"> </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {lista.map((v) => {
                const cancelado = Boolean(v.canceladoEm);
                const emEdicao = editando?.id === v.id;
                return (
                  <Table.Row key={v.id} className={cancelado ? "linha-cancelada" : undefined}>
                    <Table.Td>{emEdicao
                      ? <input type="date" value={editando.date} onChange={(e) => setEditando({ ...editando, date: e.target.value })} aria-label="Data do vale" />
                      : dia(v.date)}</Table.Td>
                    <Table.Td style={{ fontWeight: 500 }}>{v.nome}</Table.Td>
                    <Table.Td>{emEdicao
                      ? (
                        <select value={editando.type} onChange={(e) => setEditando({ ...editando, type: e.target.value as TipValeType })} aria-label="Tipo do vale">
                          {TIPOS.map((t) => <option key={t} value={t}>{VALE_LABELS[t]}</option>)}
                        </select>
                      )
                      : <>{VALE_LABELS[v.type]}{v.doFundo && <div style={mutedStyle}>distribuição do fundo</div>}</>}</Table.Td>
                    <Table.Td style={{ textAlign: "left" }}>
                      {emEdicao
                        ? <input value={editando.notes} onChange={(e) => setEditando({ ...editando, notes: e.target.value })} aria-label="Descrição do vale" maxLength={300} />
                        : v.notes ?? "—"}
                      {cancelado && <div style={mutedStyle}>Cancelado por {v.canceladoPor} em {quando(v.canceladoEm)}: {v.motivoCancelamento}</div>}
                      {cancelando?.id === v.id && (
                        <form className="aceite-form" onSubmit={(e) => { e.preventDefault(); void cancelar(); }}>
                          <input autoFocus value={cancelando.motivo} onChange={(e) => setCancelando({ id: v.id, motivo: e.target.value })}
                            placeholder="Motivo do cancelamento" aria-label="Motivo do cancelamento" />
                          <Button type="submit" size="sm" disabled={ocupado || cancelando.motivo.trim().length < 5}>Cancelar vale</Button>
                          <button type="button" className="barra-lista-link" onClick={() => setCancelando(null)}>voltar</button>
                        </form>
                      )}
                    </Table.Td>
                    <Table.Td style={{ fontWeight: 700, color: v.type === "CREDITO" ? "var(--success)" : "var(--danger)" }}>
                      {emEdicao
                        ? <input type="number" step="0.01" min="0" value={editando.amount} onChange={(e) => setEditando({ ...editando, amount: e.target.value })} aria-label="Valor do vale" style={{ width: 100 }} />
                        : money(sinal(v))}
                    </Table.Td>
                    <Table.Td style={mutedStyle} title={v.alteradoEm ? `Corrigido em ${quando(v.alteradoEm)}` : undefined}>
                      {v.lancadoPor ?? "—"}<div>{quando(v.lancadoEm)}{v.alteradoEm ? " · corrigido" : ""}</div>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      <span style={{ ...mutedStyle, display: "block" }}>{v.codigo ?? "—"}</span>
                      {!cancelado && v.type !== "CREDITO" && (
                        <button type="button" className="botao-recibo" onClick={() => pedirRecibo(v.id, v.participantId, v.nome)}
                          title={v.reciboImpressoEm ? `Impresso ${v.reciboImpressoes}× · último em ${quando(v.reciboImpressoEm)}` : "Imprimir recibo para assinatura"}>
                          <Printer size={13} /> {v.reciboImpressoes ? `imprimir de novo (${v.reciboImpressoes}×)` : "imprimir"}
                        </button>
                      )}
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {cancelado ? <StatusBadge tone="neutral">Cancelado</StatusBadge>
                        : emEdicao ? (
                          <>
                            <button type="button" className="botao-desfazer" aria-label="Salvar correção" disabled={ocupado || !(Number(editando.amount) > 0)} onClick={() => void salvarEdicao()}><Check size={15} /></button>
                            <button type="button" className="botao-desfazer" aria-label="Desistir da correção" onClick={() => setEditando(null)}><X size={15} /></button>
                          </>
                        ) : pode && (
                          <>
                            {!v.doFundo && (
                              <button type="button" className="botao-desfazer" aria-label={`Corrigir vale de ${v.nome}`} title="Corrigir"
                                onClick={() => { setCancelando(null); setEditando({ id: v.id, participantId: v.participantId, type: v.type, amount: String(v.amount), date: v.date ?? "", notes: v.notes ?? "" }); }}>
                                <Pencil size={14} />
                              </button>
                            )}
                            <button type="button" className="botao-desfazer" aria-label={`Cancelar vale de ${v.nome}`} title="Cancelar (fica no histórico)"
                              onClick={() => { setEditando(null); setCancelando({ id: v.id, motivo: "" }); }}>
                              <Ban size={14} />
                            </button>
                          </>
                        )}
                    </Table.Td>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </div>
    </div>
  );
}
