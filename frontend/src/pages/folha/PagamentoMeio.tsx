// Adiantamento (dia 20) e 1ª quinzena (dia 15): ver o que está no Contas a Pagar antes de
// pagar, lançar o que falta com confirmação e imprimir a lista para o banco — no mesmo
// padrão da folha de líquidos (por empresa ou Pateo A–Z, colunas do PDF escolhidas).
import { AlertTriangle, Banknote, Check, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type LinhaPagamentoMeio, type PagamentoMeio as Dados, type TipoPagamentoMeio, generatePayroll, getPagamentoMeio,
} from "../../api/client";
import { Alert, Button, Select, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "../gorjeta/colunas";
import { SEM_DADOS_BANCARIOS, linhasDadosBancarios } from "../gorjeta/dadosBancarios";
import { BarraFiltro, opcoesDe, useFiltro } from "../gorjeta/filtro";
import { money, mutedStyle } from "../gorjeta/gorjetaUtils";
import { NomePessoa, nomeProprio } from "../gorjeta/NomePessoa";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "../gorjeta/ordenacao";
import {
  COLUNAS_OPCIONAIS_PDF, type ModoImpressaoFolha, competenciaPdf, gerarPdfListaPagamento,
} from "../gorjeta/pdfFolhaLiquidos";
import "../gorjeta/gorjeta.css";
import {
  KIND_DO_TIPO, diaDoPagamento, TITULO_PAGAMENTO, aLancar, ddmmaaaa, listaParaPdf, precisaAtualizar, regrasDoPdf, resultadoDoLancamento,
  seloDoPdf, textoSituacao, vencimentoDaLista,
} from "./regrasPagamentoMeio";

type Props = {
  year: number;
  month: number;
  canEdit: boolean;
  /** Percentual do adiantamento (Configurações da folha), para a regra no PDF. */
  percentAdiantamento: number | null;
  /** Dia do vencimento do adiantamento (Configurações da folha), para os rótulos. */
  diaAdiantamento: number | null;
  /** Muda quando a folha do mês muda (lançou, baixou, excluiu): recarrega a lista. */
  versao: string;
  /** Depois de lançar: a Folha recarrega os lançamentos do mês. */
  onLancado: () => void;
};

const SITUACAO_ROTULO: Record<LinhaPagamentoMeio["situacao"], string> = { A_LANCAR: "Falta lançar", LANCADO: "No Contas a Pagar", PAGO: "Pago" };
const SITUACAO_TOM: Record<LinhaPagamentoMeio["situacao"], "warning" | "info" | "success"> = { A_LANCAR: "warning", LANCADO: "info", PAGO: "success" };

const EXT: Extratores<LinhaPagamentoMeio> = {
  nome: (l) => l.nome, valor: (l) => l.valor, situacao: (l) => SITUACAO_ROTULO[l.situacao], banco: (l) => linhasDadosBancarios(l).join(" "),
};
const TEXTO = new Set(["nome", "situacao", "banco"]);
const COLUNAS: ColunaOpcional[] = [{ chave: "situacao", rotulo: "Situação" }, { chave: "banco", rotulo: "Dados bancários" }];
const MODOS_IMPRESSAO = [{ value: "empresa", label: "Por empresa" }, { value: "alfabetica", label: "Pateo (A–Z)" }];

// Preferências de quem confere; sem armazenamento (aba anônima), voltam ao padrão.
const CHAVE_MODO = "pagamento-meio:modo-impressao";
const CHAVE_TIPO = "pagamento-meio:tipo";
function lerPreferencia<T extends string>(chave: string, valores: readonly T[], padrao: T): T {
  try { const v = window.localStorage.getItem(chave); return valores.includes(v as T) ? (v as T) : padrao; } catch { return padrao; }
}
function gravarPreferencia(chave: string, valor: string) {
  try { window.localStorage.setItem(chave, valor); } catch { /* só não lembra */ }
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function DadosBancarios({ linha }: { linha: LinhaPagamentoMeio }) {
  const linhas = linhasDadosBancarios(linha);
  if (linhas.length === 0) return <span style={{ ...mutedStyle, color: "var(--warning, #b45309)" }}>{SEM_DADOS_BANCARIOS}</span>;
  return <div style={{ display: "grid", gap: 2, fontSize: 13 }}>{linhas.map((t) => <span key={t} style={{ overflowWrap: "anywhere" }}>{t}</span>)}</div>;
}

/** O que o lançamento vai criar: confirmar antes de gravar. */
function Confirmacao({ tipo, linhas, lancando, onConfirmar, onCancelar }: {
  tipo: TipoPagamentoMeio; linhas: LinhaPagamentoMeio[]; lancando: boolean; onConfirmar: () => void; onCancelar: () => void;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  // Aparece embaixo dos botões: rola até ela e põe o foco no "Cancelar" — um Enter distraído não grava nada.
  useEffect(() => {
    caixa.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    caixa.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  const novos = linhas.filter((l) => l.situacao === "A_LANCAR");
  const atualizar = linhas.filter(precisaAtualizar);
  const total = novos.reduce((a, l) => a + l.valor, 0);
  return (
    <div ref={caixa} role="group" aria-label="Confirmar lançamento" className="pagamento-meio-confirmacao"
      onKeyDown={(e) => { if (e.key === "Escape" && !lancando) onCancelar(); }}>
      <strong>Confirme o que vai para o Contas a Pagar</strong>
      {novos.length > 0 && (
        <>
          <span>{plural(novos.length, "título novo", "títulos novos")} de {TITULO_PAGAMENTO[tipo].toLowerCase()} · total {money(total)}:</span>
          <ul>
            {novos.map((l) => <li key={l.employeeId}>{nomeProprio(l.nome)} — <strong>{money(l.valor)}</strong> · vence {ddmmaaaa(l.vencimento)}</li>)}
          </ul>
        </>
      )}
      {atualizar.length > 0 && (
        <>
          <span>{plural(atualizar.length, "título em aberto terá", "títulos em aberto terão")} o valor atualizado pelo cálculo de hoje:</span>
          <ul>
            {atualizar.map((l) => (
              <li key={l.employeeId}>{nomeProprio(l.nome)} — de {money(l.valor)} para <strong>{money(l.atualizarPara)}</strong> · vence {ddmmaaaa(l.vencimento)}</li>
            ))}
          </ul>
        </>
      )}
      <span style={mutedStyle}>Depois de lançar, confira a lista abaixo e imprima o PDF para o pagamento.</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={onCancelar} disabled={lancando}>Cancelar</Button>
        <Button leadingIcon={<Check size={14} />} onClick={onConfirmar} disabled={lancando}>{lancando ? "Lançando…" : "Confirmar e lançar"}</Button>
      </div>
    </div>
  );
}

export function PagamentoMeio({ year, month, canEdit, percentAdiantamento, diaAdiantamento, versao, onLancado }: Props) {
  const [tipo, setTipo] = useState<TipoPagamentoMeio>(() => lerPreferencia(CHAVE_TIPO, ["ADIANTAMENTO", "QUINZENA"] as const, "ADIANTAMENTO"));
  const [modo, setModo] = useState<ModoImpressaoFolha>(() => lerPreferencia(CHAVE_MODO, ["empresa", "alfabetica"] as const, "empresa"));
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [resultado, setResultado] = useState<{ tom: "success" | "warning" | "error"; linhas: string[] } | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const tipos = (["ADIANTAMENTO", "QUINZENA"] as const).map((t) => ({ value: t, label: `${TITULO_PAGAMENTO[t]} (${diaDoPagamento(t, diaAdiantamento)})` }));
  const ord = useOrdenacao("pagamento-meio");
  const col = useColunas("pagamento-meio");
  const colPdf = useColunas("pagamento-meio-pdf");
  const filtro = useFiltro("pagamento-meio");

  // Só a resposta do último pedido vale: trocar de mês ou de tipo no meio não mistura listas.
  const pedido = useRef(0);
  async function carregar(): Promise<Dados | null> {
    const vez = ++pedido.current;
    try {
      const d = await getPagamentoMeio(year, month, tipo);
      if (vez !== pedido.current) return null;
      setDados(d);
      setErro(null);
      return d;
    } catch (e) {
      if (vez === pedido.current) setErro((e as Error).message);
      return null;
    }
  }
  // Outro mês ou outro tipo: lista nova do zero (o resultado de um lançamento é do mês e do tipo
  // em que foi feito). Só a versão mudou (a Folha recarregou): atualiza sem piscar a tela.
  const contexto = `${year}-${month}-${tipo}`;
  const contextoAtual = useRef("");
  // carregar muda a cada render; o que dispara a recarga é a competência, o tipo e a versão.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (contextoAtual.current !== contexto) {
      contextoAtual.current = contexto;
      setDados(null);
      setConfirmando(false);
      setResultado(null);
    }
    void carregar();
  }, [contexto, versao]);

  async function lancar() {
    if (!dados) return;
    const antes = dados.linhas;
    const doContexto = contexto;
    setLancando(true);
    try {
      const r = await generatePayroll(year, month, KIND_DO_TIPO[tipo]);
      const depois = await carregar();
      // Trocou de mês ou de tipo no meio (os controles ficam travados, mas por garantia): não mistura.
      if (contextoAtual.current !== doContexto) return;
      const msgs: string[] = [];
      if (!depois) {
        setResultado({ tom: "warning", linhas: [
          `Lançamento feito (${plural(r.created, "título criado", "títulos criados")}), mas a lista não recarregou. Use "Tentar de novo" antes de lançar outra vez.`,
        ] });
      } else {
        const { lancados, pendentes, total } = resultadoDoLancamento(antes, depois);
        msgs.push(lancados.length > 0
          ? `${plural(lancados.length, "título criado", "títulos criados")} no Contas a Pagar · ${money(total)}: ${lancados.map((l) => nomeProprio(l.nome)).join(", ")}.`
          : "Nenhum título novo criado.");
        if (r.atualizados) msgs.push(`${plural(r.atualizados, "título atualizado", "títulos atualizados")} (sem baixa, valor mudou).`);
        if (pendentes.length > 0) msgs.push(`Continuam sem lançar: ${pendentes.map((l) => nomeProprio(l.nome)).join(", ")}.`);
        const pulados = (r.avisos ?? []).filter((a) => a.includes("não gerad"));
        msgs.push(...pulados);
        setResultado({ tom: pendentes.length > 0 || pulados.length > 0 ? "warning" : "success", linhas: msgs });
      }
      setConfirmando(false);
      onLancado();
    } catch (e) {
      setResultado({ tom: "error", linhas: [(e as Error).message] });
    } finally {
      setLancando(false);
    }
  }

  async function imprimir() {
    if (!dados || imprimindo) return;
    setImprimindo(true);
    const competencia = competenciaPdf(year, month);
    const venc = vencimentoDaLista(dados.linhas.filter((l) => l.situacao !== "PAGO"));
    const codigo = `${tipo === "QUINZENA" ? "QUINZ" : "ADIANT"}-${year}-${String(month).padStart(2, "0")}`;
    try {
      await gerarPdfListaPagamento(listaParaPdf(dados), {
        titulo: `${TITULO_PAGAMENTO[tipo]} - lista de pagamento`,
        apoio: `Competência ${competencia}${venc ? `   |   vencimento ${ddmmaaaa(venc)}` : ""}`,
        codigo, selo: seloDoPdf(dados), regras: regrasDoPdf(tipo, percentAdiantamento),
        rotuloValor: "Valor", rotuloTotal: "Total a pagar",
        subtituloGrupo: (g) => (g === "Sem registro" ? "valor calculado pelo sistema" : "valor pelo extrato da contabilidade"),
        rodape: `${TITULO_PAGAMENTO[tipo]} ${competencia} - ${codigo}`, arquivo: `${codigo}.pdf`, modo, ocultas: colPdf.ocultas,
      });
    } catch (e) {
      setResultado({ tom: "error", linhas: ["Erro ao gerar o PDF: " + (e as Error).message] });
    } finally {
      setImprimindo(false);
    }
  }

  const cabecalho = (
    <div className="cabecalho-painel">
      <div className="cabecalho-painel-texto">
        <strong>Lista de pagamento · {TITULO_PAGAMENTO[tipo]} ({diaDoPagamento(tipo, diaAdiantamento)})</strong>
        <span>O que está no Contas a Pagar, o que falta lançar e o que já foi pago — com os dados bancários para pagar.</span>
      </div>
      <div className="cabecalho-painel-acoes">
        <Select aria-label="Qual pagamento" options={tipos} value={tipo} disabled={lancando}
          onChange={(e) => {
            const t = e.target.value as TipoPagamentoMeio;
            // O filtro de uma lista (empresa, situação) não serve para a outra.
            filtro.limpar();
            setTipo(t);
            gravarPreferencia(CHAVE_TIPO, t);
          }} />
      </div>
    </div>
  );

  const avisoResultado = resultado && <Alert tone={resultado.tom}>{resultado.linhas.map((m) => <div key={m}>{m}</div>)}</Alert>;
  if (erro) {
    return (
      <div className="pagamento-meio">
        {cabecalho}
        {avisoResultado}
        <Alert tone="error">{erro}</Alert>
        <div><Button variant="secondary" size="sm" onClick={() => void carregar()}>Tentar de novo</Button></div>
      </div>
    );
  }
  if (!dados) return <div className="pagamento-meio">{cabecalho}<span style={mutedStyle}>Carregando a lista…</span></div>;

  const pendentes = aLancar(dados);
  const filtradas = filtro.aplicar(dados.linhas,
    (l) => [l.nome, l.grupo, ...linhasDadosBancarios(l), l.aviso ?? ""].join(" "),
    { grupo: (l) => l.grupo, situacao: (l) => SITUACAO_ROTULO[l.situacao] });
  const ordenadas = aplicarOrdem(filtradas, ord.ordem, EXT);
  const grupos = [...new Set(dados.linhas.map((l) => l.grupo))];
  const v = col.visivel;
  const depoisDoValor = ["situacao", "banco"].filter(v).length;
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO.has(c) ? "asc" : "desc") });
  const semDados = dados.linhas.filter((l) => l.situacao !== "PAGO" && linhasDadosBancarios(l).length === 0).length;
  const aPagar = dados.linhas.filter((l) => l.situacao !== "PAGO").length;

  return (
    <div className="pagamento-meio">
      {cabecalho}

      <div className="pagamento-meio-resumo" role="list" aria-label="Resumo">
        <div role="listitem" className={dados.aLancar.pessoas > 0 ? "pm-cartao pm-falta" : "pm-cartao"}>
          <span>Falta lançar</span><strong>{dados.aLancar.pessoas}</strong><small>{money(dados.aLancar.total)}</small>
        </div>
        <div role="listitem" className="pm-cartao"><span>No Contas a Pagar</span><strong>{dados.lancado.pessoas}</strong><small>{money(dados.lancado.total)}</small></div>
        <div role="listitem" className="pm-cartao"><span>Pago</span><strong>{dados.pago.pessoas}</strong><small>{money(dados.pago.total)}</small></div>
        <div role="listitem" className="pm-cartao pm-total"><span>Total do mês</span><strong>{money(dados.total)}</strong><small>{plural(dados.linhas.length, "pessoa", "pessoas")}</small></div>
      </div>

      {dados.avisos.length > 0 && <Alert tone="warning">{dados.avisos.map((a) => <div key={a}>{a}</div>)}</Alert>}
      {avisoResultado}

      <div className="pagamento-meio-acoes">
        {canEdit && pendentes.length > 0 && (
          <Button leadingIcon={<Banknote size={14} />} disabled={confirmando || lancando} data-lancar="1"
            onClick={() => { setConfirmando(true); setResultado(null); }}
            title="Mostra o que vai ser lançado e pede confirmação antes de gravar">
            Lançar no Contas a Pagar ({pendentes.length})
          </Button>
        )}
        <SeletorColunas colunas={COLUNAS} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
        <div className="folha-pdf-acao">
          <SeletorColunas rotulo="Colunas do PDF" colunas={COLUNAS_OPCIONAIS_PDF} ocultas={colPdf.ocultas} alternar={colPdf.alternar} mostrarTodas={colPdf.mostrarTodas} />
          <Select aria-label="Modo de impressão do PDF" options={MODOS_IMPRESSAO} value={modo}
            title="Por empresa: um bloco por empresa com subtotal. Pateo: todos juntos em ordem alfabética."
            onChange={(e) => { const m = e.target.value as ModoImpressaoFolha; setModo(m); gravarPreferencia(CHAVE_MODO, m); }} />
          <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} disabled={aPagar === 0 || imprimindo}
            title={aPagar === 0 ? "Todos já pagos: nada a imprimir" : dados.aLancar.pessoas > 0 ? "Sai como prévia: ainda falta lançar alguém" : filtro.ativo ? "O PDF sai com a lista inteira, sem o filtro" : undefined}
            onClick={() => void imprimir()}>
            {imprimindo ? "Gerando…" : "PDF para pagamento"}
          </Button>
        </div>
      </div>

      {confirmando && (
        <Confirmacao tipo={tipo} linhas={pendentes} lancando={lancando} onConfirmar={() => void lancar()}
          onCancelar={() => {
            setConfirmando(false);
            // O foco volta ao botão que abriu a confirmação.
            requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("[data-lancar]")?.focus());
          }} />
      )}

      {semDados > 0 && (
        <span style={{ ...mutedStyle, color: "var(--warning, #b45309)", display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={13} aria-hidden="true" />
          {plural(semDados, "pessoa a pagar está", "pessoas a pagar estão")} sem PIX e sem conta no cadastro — preencha em Funcionários → Dados bancários.
        </span>
      )}

      {dados.linhas.length === 0 ? (
        <span style={mutedStyle}>Nada de {TITULO_PAGAMENTO[tipo].toLowerCase()} neste mês: nem no Contas a Pagar, nem a lançar.</span>
      ) : (
        <>
          <BarraFiltro filtro={filtro} total={dados.linhas.length} visiveis={filtradas.length} placeholder="Filtrar por nome, empresa, PIX, banco…"
            listas={[
              { chave: "grupo", rotulo: "Empresa/grupo", opcoes: opcoesDe(dados.linhas, (l) => l.grupo) },
              { chave: "situacao", rotulo: "Situação", opcoes: opcoesDe(dados.linhas, (l) => SITUACAO_ROTULO[l.situacao]) },
            ]} />
          {filtradas.length === 0 && <span style={mutedStyle}>Ninguém bate com o filtro.</span>}
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <ThOrdenavel {...th("nome")} align="left" minWidth={220}>Funcionário</ThOrdenavel>
                <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>
                {v("situacao") && <ThOrdenavel {...th("situacao")}>Situação</ThOrdenavel>}
                {v("banco") && <ThOrdenavel {...th("banco")} align="left" minWidth={220}>Dados bancários</ThOrdenavel>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {grupos.map((g) => {
                const doGrupo = ordenadas.filter((l) => l.grupo === g);
                if (doGrupo.length === 0) return null;
                return [
                  <Table.Row key={`g-${g}`} className="linha-grupo">
                    <Table.Td style={{ textAlign: "left", fontWeight: 700 }}>{g} <span style={{ ...mutedStyle, fontWeight: 400 }}>· {doGrupo.length}</span></Table.Td>
                    <Table.Td style={{ fontWeight: 700 }}>{money(doGrupo.reduce((a, l) => a + l.valor, 0))}</Table.Td>
                    {depoisDoValor > 0 && <Table.Td colSpan={depoisDoValor} />}
                  </Table.Row>,
                  ...doGrupo.map((l) => (
                    <Table.Row key={`${g}-${l.employeeId}-${l.payrollItemId ?? "novo"}`} className={l.situacao === "A_LANCAR" ? "pm-linha-falta" : undefined}>
                      <Table.Td style={{ textAlign: "left" }}>
                        <NomePessoa nome={nomeProprio(l.nome)} employeeId={l.employeeId} />
                        {l.aviso && (
                          <div style={{ ...mutedStyle, color: "var(--warning, #b45309)", display: "flex", gap: 4, alignItems: "center" }}>
                            <AlertTriangle size={12} aria-hidden="true" /> <span>{l.aviso}</span>
                          </div>
                        )}
                      </Table.Td>
                      <Table.Td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{money(l.valor)}</Table.Td>
                      {v("situacao") && (
                        <Table.Td>
                          <span style={{ whiteSpace: "nowrap" }}><StatusBadge tone={SITUACAO_TOM[l.situacao]}>{SITUACAO_ROTULO[l.situacao]}</StatusBadge></span>
                          <div style={{ ...mutedStyle, whiteSpace: "nowrap" }}>{textoSituacao(l)}</div>
                        </Table.Td>
                      )}
                      {v("banco") && <Table.Td style={{ textAlign: "left" }}><DadosBancarios linha={l} /></Table.Td>}
                    </Table.Row>
                  )),
                ];
              })}
              <Table.Row>
                <Table.Td style={{ textAlign: "left", fontWeight: 700 }}>
                  {filtro.ativo ? `Total do filtro (${filtradas.length} de ${dados.linhas.length})` : "Total do mês"}
                </Table.Td>
                <Table.Td style={{ fontWeight: 800 }}>{money(filtro.ativo ? filtradas.reduce((a, l) => a + l.valor, 0) : dados.total)}</Table.Td>
                {depoisDoValor > 0 && <Table.Td colSpan={depoisDoValor} />}
              </Table.Row>
            </Table.Body>
          </Table>
        </>
      )}
    </div>
  );
}
