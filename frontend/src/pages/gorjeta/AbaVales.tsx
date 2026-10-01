// Aba "Vales": o que foi adiantado no restaurante (adiantamento, refeição,
// retirada de caixa…) e é abatido da gorjeta antes do envio à contabilidade.
// Tudo fica gravado: corrigir e cancelar deixam autor e motivo; cancelado
// continua na lista e nos relatórios, só deixa de descontar.
import { Ban, Check, Download, Pencil, Printer, X } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  type TipValeDescricao, type TipValeLancado, type TipValeType, type TipValesPeriodo, addTipVale, cancelarTipVale, editarTipVale,
  emitirReciboVale, getTipCompanies, getTipValeDescricoes, getTipVales,
} from "../../api/client";
import { FormLancarVale, type NovoVale } from "./FormLancarVale";
import { imprimirReciboVale } from "./reciboVale";
import { Button, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { NomePessoa, textoPessoa } from "./NomePessoa";
import { VALE_LABELS, baixarCsv, money, mutedStyle, panelStyle } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Props = {
  year: number;
  month: number;
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  /** Um vale mudou: a apuração e o pagamento precisam recarregar. */
  onChanged: () => void;
  /**
   * Atalho "Vales de X" da Apuração: aplica a pessoa no filtro uma vez por pedido (n muda a
   * cada clique). Limpar o filtro depois vale; ao sair da aba, a pessoa do atalho sai junto.
   */
  pedidoPessoa?: { pessoa: string; n: number } | null;
};

type PessoaVales = TipValesPeriodo["pessoas"][number];

const TIPOS: TipValeType[] = ["ADIANTAMENTO", "REFEICAO", "VALE_CONSUMO", "RETIRADA_CAIXA", "OUTRO", "CREDITO"];
const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
const sinal = (v: TipValeLancado) => (v.type === "CREDITO" ? v.amount : -v.amount);
const empresaDe = (p: PessoaVales) => (p.semRegistro ? "Sem registro" : p.empresa);
const totalTd: CSSProperties = { background: "var(--paper-soft, #f2f4f7)", fontWeight: 700, borderTop: "2px solid var(--line-strong, #c8d0da)" };

type Formulario = { participantId: string; type: TipValeType; amount: string; date: string; notes: string };
const CHAVE_EMPRESA = "gorjeta-vales-empresa-recibo";
const lerEmpresa = () => { try { return window.localStorage.getItem(CHAVE_EMPRESA) ?? ""; } catch { return ""; } };

const EXT: Extratores<TipValeLancado> = {
  data: (v) => v.date ?? v.lancadoEm, nome: (v) => v.nome, tipo: (v) => VALE_LABELS[v.type], valor: (v) => sinal(v),
  obs: (v) => v.notes, por: (v) => v.lancadoPor, recibo: (v) => v.codigo,
};
// Corrigindo um vale, estas colunas aparecem mesmo se ocultas: são os campos da correção.
const EDITAVEIS = new Set(["data", "tipo", "obs", "valor"]);
const COLUNAS_LISTA: ColunaOpcional[] = [
  { chave: "data", rotulo: "Data" }, { chave: "tipo", rotulo: "Tipo" }, { chave: "obs", rotulo: "Descrição" },
  { chave: "valor", rotulo: "Valor" }, { chave: "por", rotulo: "Lançado por" }, { chave: "recibo", rotulo: "Recibo" },
];

const EXT_PESSOA: Extratores<PessoaVales> = {
  nome: (p) => p.nome, gorjeta: (p) => p.gorjeta, vales: (p) => p.descontos, creditos: (p) => p.creditos, liquida: (p) => p.liquida,
};
const COLUNAS_PESSOA: ColunaOpcional[] = [
  { chave: "gorjeta", rotulo: "Gorjeta" }, { chave: "vales", rotulo: "Vales" }, { chave: "creditos", rotulo: "Créditos" },
  { chave: "liquida", rotulo: "Gorjeta líquida" },
];

export function AbaVales({ year, month, canEdit, onNotice, onChanged, pedidoPessoa = null }: Props) {
  const [dados, setDados] = useState<TipValesPeriodo | null>(null);
  const [descricoes, setDescricoes] = useState<TipValeDescricao[]>([]);
  const [empresas, setEmpresas] = useState<Array<{ id: string; tradeName: string }>>([]);
  // Recibo de quem não tem empresa no cadastro (sem registro): escolhe a emitente.
  const [ultimoRecibo, setUltimoRecibo] = useState<{ url: string; codigo: string } | null>(null);
  const [escolherEmpresa, setEscolherEmpresa] = useState<{ valeId: string; nome: string; empresaId: string } | null>(null);
  const [editando, setEditando] = useState<(Formulario & { id: string }) | null>(null);
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ord = useOrdenacao("vales-lista");
  const filtro = useFiltro("vales-lista");
  const col = useColunas("vales-lista", ["data", "por", "recibo"]);
  const ordP = useOrdenacao("vales-pessoas");
  const filtroP = useFiltro("vales-pessoas");
  const colP = useColunas("vales-pessoas", ["gorjeta", "creditos"]);
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
  // Vindo do atalho da Apuração: a pessoa entra no filtro da lista de lançamentos, uma vez
  // por clique. Ao sair da aba, sai também — se o usuário não tiver trocado de pessoa.
  const pessoaDoAtalho = useRef<string | null>(null);
  useEffect(() => {
    if (!pedidoPessoa) return;
    filtro.setValor("pessoa", pedidoPessoa.pessoa);
    pessoaDoAtalho.current = pedidoPessoa.pessoa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoPessoa?.n]);
  useEffect(() => () => {
    if (pessoaDoAtalho.current) filtro.limparValorSe("pessoa", pessoaDoAtalho.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A pessoa do filtro é um participante deste período: em outro mês ela não existe e
  // esconderia todos os vales. Ao carregar, pessoa que não está no período sai do filtro.
  useEffect(() => {
    const pessoa = filtro.valores.pessoa;
    if (!dados || !pessoa) return;
    if (!dados.pessoas.some((p) => p.participantId === pessoa)) filtro.setValor("pessoa", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);

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
      ["Data", "Funcionário", "Apelido", "Tipo", "Descrição", "Valor", "Lançado por", "Lançado em", "Situação", "Motivo do cancelamento"],
      ...(dados.vales).map((v) => [dia(v.date), v.nome, v.apelido ?? "", VALE_LABELS[v.type], v.notes, sinal(v), v.lancadoPor, quando(v.lancadoEm),
        v.canceladoEm ? `Cancelado por ${v.canceladoPor ?? "—"} em ${quando(v.canceladoEm)}` : "Ativo", v.motivoCancelamento]),
    ]);
  }

  if (!dados) return <div style={panelStyle}><span style={mutedStyle}>Carregando os vales…</span></div>;

  const totalDescontos = ativos.filter((v) => v.type !== "CREDITO").reduce((a, v) => a + v.amount, 0);
  const totalCreditos = ativos.filter((v) => v.type === "CREDITO").reduce((a, v) => a + v.amount, 0);
  const gorjeta = pessoas.reduce((a, p) => a + p.gorjeta, 0);
  const liquida = pessoas.reduce((a, p) => a + p.liquida, 0);

  // Lançamentos: texto por nome/apelido/descrição/código; listas por pessoa, tipo, situação e empresa.
  const pessoaPorParticipante = new Map(pessoas.map((p) => [p.participantId, p]));
  const pessoaFiltrada = filtro.valores.pessoa ?? "";
  const listasLancamentos = [
    { chave: "pessoa", rotulo: "Pessoa", opcoes: pessoas.filter((p) => p.participantId)
      .map((p) => ({ valor: p.participantId!, rotulo: p.apelido ? `${p.nome} (${p.apelido})` : p.nome })) },
    { chave: "tipo", rotulo: "Tipo", opcoes: TIPOS.map((t) => ({ valor: t, rotulo: VALE_LABELS[t] })) },
    { chave: "situacao", rotulo: "Situação", opcoes: [{ valor: "Ativo", rotulo: "Ativos" }, { valor: "Cancelado", rotulo: "Cancelados" }] },
    { chave: "empresa", rotulo: "Empresa", opcoes: opcoesDe(pessoas, empresaDe) },
  ];
  const filtrados = filtro.aplicar(dados.vales,
    (v) => [textoPessoa(v.nome, v.apelido), v.notes ?? "", VALE_LABELS[v.type], v.codigo ?? "", v.lancadoPor ?? ""].join(" "),
    {
      pessoa: (v) => v.participantId, tipo: (v) => v.type, situacao: (v) => (v.canceladoEm ? "Cancelado" : "Ativo"),
      empresa: (v) => { const p = pessoaPorParticipante.get(v.participantId); return p ? empresaDe(p) : null; },
    });
  const lista = aplicarOrdem(filtrados, ord.ordem, EXT);
  const saldoLista = filtrados.filter((v) => !v.canceladoEm).reduce((a, v) => a + sinal(v), 0);
  const vc = (c: string) => col.visivel(c) || (editando != null && EDITAVEIS.has(c));
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "valor" ? "desc" : "asc") });
  // Linha de total: o rótulo ocupa as colunas até o Valor.
  const antesDoValor = 1 + ["data", "tipo", "obs"].filter(vc).length;
  const depoisDoValor = 1 + ["por", "recibo"].filter(vc).length;
  const rotuloLista = filtro.ativo ? `Total do filtro (${filtrados.length} de ${dados.vales.length})` : "Total";

  // Por pessoa: texto por nome/apelido/função/empresa; listas por vínculo, empresa e função.
  const comVales = pessoas.filter((p) => p.descontos > 0 || p.creditos > 0);
  const listasPessoas = [
    { chave: "vinculo", rotulo: "Vínculo", opcoes: [{ valor: "CLT", rotulo: "CLT" }, { valor: "Sem registro", rotulo: "Sem registro" }] },
    { chave: "empresa", rotulo: "Empresa", opcoes: opcoesDe(comVales, (p) => p.empresa) },
    { chave: "funcao", rotulo: "Função", opcoes: opcoesDe(comVales, (p) => p.funcao) },
  ];
  const pessoasFiltradas = filtroP.aplicar(comVales,
    (p) => [textoPessoa(p.nome, p.apelido), p.funcao ?? "", p.empresa ?? ""].join(" "),
    { vinculo: (p) => (p.semRegistro ? "Sem registro" : "CLT"), empresa: (p) => p.empresa, funcao: (p) => p.funcao });
  const linhasPessoas = aplicarOrdem(pessoasFiltradas, ordP.ordem, EXT_PESSOA);
  const vp = colP.visivel;
  const thP = (c: string) => ({ coluna: c, ordem: ordP.ordem, onOrdenar: () => ordP.alternar(c, c === "nome" ? "asc" : "desc") });
  const somaP = (f: (p: PessoaVales) => number) => pessoasFiltradas.reduce((a, p) => a + f(p), 0);

  // Situação do cancelamento: vai na Descrição; com ela oculta, fica embaixo do nome.
  function blocoCancelamento(v: TipValeLancado) {
    return (
      <>
        {v.canceladoEm && <div style={mutedStyle}>Cancelado por {v.canceladoPor} em {quando(v.canceladoEm)}: {v.motivoCancelamento}</div>}
        {cancelando?.id === v.id && (
          <form className="aceite-form" onSubmit={(e) => { e.preventDefault(); void cancelar(); }}>
            <input autoFocus value={cancelando.motivo} onChange={(e) => setCancelando({ id: v.id, motivo: e.target.value })}
              placeholder="Motivo do cancelamento" aria-label="Motivo do cancelamento" />
            <Button type="submit" size="sm" variant="danger" disabled={ocupado || cancelando.motivo.trim().length < 5}>Cancelar vale</Button>
            {cancelando.motivo.trim().length < 5 && (
              <span className="dica-minimo">faltam {5 - cancelando.motivo.trim().length} letra(s) no motivo</span>
            )}
            <button type="button" className="barra-lista-link" onClick={() => setCancelando(null)}>voltar</button>
          </form>
        )}
      </>
    );
  }

  return (
    <div className="aba-vales" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {fechado && (
        <div className="estado-vazio" style={{ alignItems: "flex-start", textAlign: "left" }}>
          <strong>Período fechado.</strong>
          <span>Os vales abaixo já foram abatidos da gorjeta enviada. Para lançar, corrigir ou cancelar, reabra o período na aba Apuração.</span>
        </div>
      )}

      {pode && (
        <div style={panelStyle}>
          <FormLancarVale key={pedidoPessoa?.n ?? 0}
            pessoas={pessoas.filter((p) => p.participantId).map((p) => ({
              participantId: p.participantId!, nome: p.nome, apelido: p.apelido, funcao: p.funcao, empresa: p.empresa, semRegistro: p.semRegistro, foraDaGorjeta: p.foraDaGorjeta, liquida: p.liquida,
            }))}
            descricoes={descricoes} pessoaInicial={pedidoPessoa?.pessoa ?? ""} ocupado={ocupado}
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

      {comVales.length > 0 && (
        <div style={panelStyle}>
          <div className="cabecalho-painel">
            <div className="cabecalho-painel-texto">
              <strong>Por pessoa</strong>
              <span>Clique numa pessoa para ver só os vales dela.</span>
            </div>
            <div className="cabecalho-painel-acoes">
              <SeletorColunas colunas={COLUNAS_PESSOA} ocultas={colP.ocultas} alternar={colP.alternar} mostrarTodas={colP.mostrarTodas} />
            </div>
          </div>
          <BarraFiltro filtro={filtroP} listas={listasPessoas} total={comVales.length} visiveis={pessoasFiltradas.length} />
          {pessoasFiltradas.length === 0 ? <span style={mutedStyle}>Ninguém bate com o filtro.</span> : (
            <Table className="tabela-gorjeta">
              <Table.Head>
                <Table.Row>
                  <ThOrdenavel {...thP("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
                  {vp("gorjeta") && <ThOrdenavel {...thP("gorjeta")}>Gorjeta</ThOrdenavel>}
                  {vp("vales") && <ThOrdenavel {...thP("vales")}>Vales</ThOrdenavel>}
                  {vp("creditos") && <ThOrdenavel {...thP("creditos")}>Créditos</ThOrdenavel>}
                  {vp("liquida") && <ThOrdenavel {...thP("liquida")}>Gorjeta líquida</ThOrdenavel>}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {linhasPessoas.map((p) => (
                  <Table.Row key={p.employeeId} className={`linha-clicavel${p.participantId && pessoaFiltrada === p.participantId ? " linha-em-edicao" : ""}`}
                    onClick={() => filtro.setValor("pessoa", pessoaFiltrada === p.participantId ? "" : p.participantId ?? "")}>
                    <Table.Td>
                      <NomePessoa nome={p.nome} apelido={p.apelido} employeeId={p.employeeId}>
                        {p.foraDaGorjeta
                          ? <span style={mutedStyle} title="Não participa da gorjeta: os vales descontam do salário na Lista de pagamento">fora da gorjeta · desconta do salário</span>
                          : p.liquida < 0 && <span style={{ ...mutedStyle, color: "var(--danger)" }}>vales maiores que a gorjeta</span>}
                      </NomePessoa>
                    </Table.Td>
                    {vp("gorjeta") && <Table.Td>{money(p.gorjeta)}</Table.Td>}
                    {vp("vales") && <Table.Td style={{ color: "var(--danger)" }}>{p.descontos ? money(-p.descontos) : "—"}</Table.Td>}
                    {vp("creditos") && <Table.Td style={{ color: "var(--success)" }}>{p.creditos ? money(p.creditos) : "—"}</Table.Td>}
                    {vp("liquida") && <Table.Td style={{ fontWeight: 700 }}>{money(p.liquida)}</Table.Td>}
                  </Table.Row>
                ))}
                <Table.Row>
                  <Table.Td style={totalTd}>{filtroP.ativo ? `Total do filtro (${pessoasFiltradas.length} de ${comVales.length})` : "Total"}</Table.Td>
                  {vp("gorjeta") && <Table.Td style={totalTd}>{money(somaP((p) => p.gorjeta))}</Table.Td>}
                  {vp("vales") && <Table.Td style={{ ...totalTd, color: "var(--danger)" }}>{money(-somaP((p) => p.descontos))}</Table.Td>}
                  {vp("creditos") && <Table.Td style={{ ...totalTd, color: "var(--success)" }}>{money(somaP((p) => p.creditos))}</Table.Td>}
                  {vp("liquida") && <Table.Td style={totalTd}>{money(somaP((p) => p.liquida))}</Table.Td>}
                </Table.Row>
              </Table.Body>
            </Table>
          )}
        </div>
      )}

      <div style={panelStyle}>
        <div className="cabecalho-painel">
          <div className="cabecalho-painel-texto">
            <strong>Lançamentos {dados.code}</strong>
            <span>{ativos.length} ativo(s){dados.vales.length !== ativos.length ? ` · ${dados.vales.length - ativos.length} cancelado(s)` : ""}</span>
          </div>
          <div className="cabecalho-painel-acoes">
            <SeletorColunas colunas={COLUNAS_LISTA} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
            <Button variant="secondary" size="sm" leadingIcon={<Download size={14} />} onClick={exportar} disabled={dados.vales.length === 0}>Excel (CSV)</Button>
          </div>
        </div>
        {dados.vales.length > 0 && (
          <BarraFiltro filtro={filtro} listas={listasLancamentos} total={dados.vales.length} visiveis={filtrados.length}
            placeholder="Filtrar por nome, apelido, descrição…" />
        )}
        {lista.length === 0 ? (
          <div className="estado-vazio">
            <strong>{dados.vales.length === 0 ? "Nenhum vale lançado neste período." : "Nenhum vale com esse filtro."}</strong>
            {dados.vales.length === 0 && <span>Lance aqui os adiantamentos e descontos feitos no restaurante: eles saem da gorjeta antes do envio à contabilidade.</span>}
          </div>
        ) : (
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                {vc("data") && <ThOrdenavel {...th("data")}>Data</ThOrdenavel>}
                <ThOrdenavel {...th("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
                {vc("tipo") && <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>}
                {vc("obs") && <ThOrdenavel {...th("obs")} minWidth={180}>Descrição</ThOrdenavel>}
                {vc("valor") && <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>}
                {vc("por") && <ThOrdenavel {...th("por")}>Lançado por</ThOrdenavel>}
                {vc("recibo") && <ThOrdenavel {...th("recibo")}>Recibo</ThOrdenavel>}
                <Table.Th aria-label="Ações"> </Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {lista.map((v) => {
                const cancelado = Boolean(v.canceladoEm);
                const emEdicao = editando?.id === v.id;
                return (
                  <Table.Row key={v.id} className={cancelado ? "linha-cancelada" : undefined}>
                    {vc("data") && (
                      <Table.Td>{emEdicao
                        ? <input type="date" value={editando.date} onChange={(e) => setEditando({ ...editando, date: e.target.value })} aria-label="Data do vale" />
                        : dia(v.date)}</Table.Td>
                    )}
                    <Table.Td>
                      <NomePessoa nome={v.nome} apelido={v.apelido} employeeId={v.employeeId}>
                        {!vc("tipo") && <span style={mutedStyle}>{VALE_LABELS[v.type]}</span>}
                      </NomePessoa>
                      {!vc("obs") && blocoCancelamento(v)}
                    </Table.Td>
                    {vc("tipo") && (
                      <Table.Td>{emEdicao
                        ? (
                          <select value={editando.type} onChange={(e) => setEditando({ ...editando, type: e.target.value as TipValeType })} aria-label="Tipo do vale">
                            {TIPOS.map((t) => <option key={t} value={t}>{VALE_LABELS[t]}</option>)}
                          </select>
                        )
                        : <>{VALE_LABELS[v.type]}{v.doFundo && <div style={mutedStyle}>distribuição do fundo</div>}</>}</Table.Td>
                    )}
                    {vc("obs") && (
                      <Table.Td style={{ textAlign: "left" }}>
                        {emEdicao
                          ? <input value={editando.notes} onChange={(e) => setEditando({ ...editando, notes: e.target.value })} aria-label="Descrição do vale" maxLength={300} />
                          : v.notes ?? "—"}
                        {blocoCancelamento(v)}
                      </Table.Td>
                    )}
                    {vc("valor") && (
                      <Table.Td style={{ fontWeight: 700, color: v.type === "CREDITO" ? "var(--success)" : "var(--danger)" }}>
                        {emEdicao
                          ? <input type="number" step="0.01" inputMode="decimal" min="0" value={editando.amount} onChange={(e) => setEditando({ ...editando, amount: e.target.value })} aria-label="Valor do vale" style={{ width: 100 }} />
                          : money(sinal(v))}
                      </Table.Td>
                    )}
                    {vc("por") && (
                      <Table.Td style={mutedStyle} title={v.alteradoEm ? `Corrigido em ${quando(v.alteradoEm)}` : undefined}>
                        {v.lancadoPor ?? "—"}<div>{quando(v.lancadoEm)}{v.alteradoEm ? " · corrigido" : ""}</div>
                      </Table.Td>
                    )}
                    {vc("recibo") && (
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        <span style={{ ...mutedStyle, display: "block" }}>{v.codigo ?? "—"}</span>
                        {v.reciboImpressoEm && <span style={{ ...mutedStyle, fontSize: 11 }}>impresso {v.reciboImpressoes}×</span>}
                      </Table.Td>
                    )}
                    {/* Ações ficam numa coluna que não se oculta: recibo, corrigir e cancelar. */}
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {cancelado ? <StatusBadge tone="neutral">Cancelado</StatusBadge>
                        : emEdicao ? (
                          <>
                            <button type="button" className="botao-desfazer" aria-label="Salvar correção" disabled={ocupado || !(Number(editando.amount) > 0)} onClick={() => void salvarEdicao()}><Check size={15} /></button>
                            <button type="button" className="botao-desfazer" aria-label="Desistir da correção" onClick={() => setEditando(null)}><X size={15} /></button>
                          </>
                        ) : (
                          <>
                            {v.type !== "CREDITO" && (
                              <button type="button" className="botao-recibo" onClick={() => pedirRecibo(v.id, v.participantId, v.nome)}
                                aria-label={`Imprimir recibo do vale de ${v.nome}`}
                                title={v.reciboImpressoEm ? `Impresso ${v.reciboImpressoes}× · último em ${quando(v.reciboImpressoEm)}` : "Imprimir recibo para assinatura"}>
                                <Printer size={13} /> {v.reciboImpressoes ? `imprimir de novo (${v.reciboImpressoes}×)` : "imprimir"}
                              </button>
                            )}
                            {pode && (
                          <>
                            {!v.doFundo && (
                              <button type="button" className="botao-desfazer" aria-label={`Corrigir vale de ${v.nome}`} title="Corrigir"
                                onClick={() => { setCancelando(null); setEditando({ id: v.id, participantId: v.participantId, type: v.type, amount: String(v.amount), date: v.date ?? "", notes: v.notes ?? "" }); }}>
                                <Pencil size={14} /><span className="acao-texto">corrigir</span>
                              </button>
                            )}
                            <button type="button" className="botao-desfazer" aria-label={`Cancelar vale de ${v.nome}`} title="Cancelar (fica no histórico)"
                              onClick={() => { setEditando(null); setCancelando({ id: v.id, motivo: "" }); }}>
                              <Ban size={14} /><span className="acao-texto">cancelar</span>
                            </button>
                          </>
                            )}
                          </>
                        )}
                    </Table.Td>
                  </Table.Row>
                );
              })}
              <Table.Row>
                {vc("valor") ? (
                  <>
                    <Table.Td colSpan={antesDoValor} style={totalTd} title="Vales cancelados não entram no total">{rotuloLista}</Table.Td>
                    <Table.Td style={{ ...totalTd, whiteSpace: "nowrap" }}>{money(saldoLista)}</Table.Td>
                    <Table.Td colSpan={depoisDoValor} style={totalTd}> </Table.Td>
                  </>
                ) : (
                  <Table.Td colSpan={antesDoValor + depoisDoValor} style={totalTd} title="Vales cancelados não entram no total">{rotuloLista}: {money(saldoLista)}</Table.Td>
                )}
              </Table.Row>
            </Table.Body>
          </Table>
        )}
      </div>
    </div>
  );
}
