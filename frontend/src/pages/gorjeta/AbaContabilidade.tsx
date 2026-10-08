// Depois da apuração: envio à contabilidade → extratos devolvidos (conferência)
// → OK dado → liberar para pagamento (títulos por empresa no Contas a Pagar) → pagos.
// Cada etapa fica registrada; a última marca sozinha quando todos os títulos são baixados.
import { Check, FileUp, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { type CSSProperties, useContext, useEffect, useRef, useState } from "react";
import {
  type TipConferencia, type TipConferenciaCompleta, type TipEtapa, type TipFolhaLote, type TipTrocaExtrato, type TipLinhaConferencia, type TipStatusConferencia,
  aceitarTipDivergencia, confirmarTipVinculo, desfazerTipAceite, enviarTipExtrato, getTipConferencia, getTipFolhaLotes, marcarTipEtapa, removerTipExtrato,
} from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { FolhaLiquidos } from "./FolhaLiquidos";
import { LiberarPagamento, resumoDosLotes } from "./LiberarPagamento";
import { ResultadoTrocaExtrato } from "./ResultadoTrocaExtrato";
import "./gorjeta.css";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { money, mutedStyle, panelStyle } from "./gorjetaUtils";
import { ApelidosContext, NomePessoa, nomeProprio, resolverApelido, textoPessoa } from "./NomePessoa";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Props = {
  year: number;
  month: number;
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
};

const STATUS: Record<TipStatusConferencia, { rotulo: string; tom: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  OK: { rotulo: "Bate", tom: "success" },
  ACEITA: { rotulo: "Aceita", tom: "info" },
  SALARIO_COMBINADO: { rotulo: "Salário combinado", tom: "info" },
  DIVERGE: { rotulo: "Diverge", tom: "danger" },
  FALTA_NO_EXTRATO: { rotulo: "Falta no extrato", tom: "danger" },
  SO_NO_EXTRATO: { rotulo: "Só no extrato", tom: "danger" },
  SEM_EXTRATO_DA_EMPRESA: { rotulo: "Falta o extrato da empresa", tom: "warning" },
  NAO_PARTICIPA: { rotulo: "Não participa", tom: "neutral" },
  VINCULO_A_CONFIRMAR: { rotulo: "Confirmar a pessoa", tom: "warning" },
};
const PENDENTE = new Set<TipStatusConferencia>(["DIVERGE", "FALTA_NO_EXTRATO", "SO_NO_EXTRATO", "SEM_EXTRATO_DA_EMPRESA", "VINCULO_A_CONFIRMAR"]);
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

const lerComoBase64 = (arquivo: File) => new Promise<string>((ok, falha) => {
  const leitor = new FileReader();
  leitor.onload = () => ok(String(leitor.result));
  leitor.onerror = () => falha(new Error("Não foi possível abrir o arquivo."));
  leitor.readAsDataURL(arquivo);
});

const EXT: Extratores<TipLinhaConferencia> = {
  nome: (l) => l.nome, empresa: (l) => l.empresa, apuracao: (l) => l.apuracao, extrato: (l) => l.extrato,
  dif: (l) => l.diferenca, status: (l) => STATUS[l.status].rotulo,
};
const COLUNAS: ColunaOpcional[] = [
  { chave: "empresa", rotulo: "Empresa" }, { chave: "apuracao", rotulo: "Apuração" }, { chave: "extrato", rotulo: "Extrato" },
  { chave: "dif", rotulo: "Diferença" },
];
// A Situação não se oculta: é nela que ficam aceitar, confirmar a pessoa e desfazer.
const totalTd: CSSProperties = { fontWeight: 700, borderTop: "2px solid var(--line-strong, #c8d0da)" };
const soma = (l: TipLinhaConferencia[], v: (x: TipLinhaConferencia) => number | null | undefined) => l.reduce((a, x) => a + (v(x) ?? 0), 0);
const OCULTO_TETO = "Gorjeta informada pelo teto do IR: o valor exige permissão de ver Funcionários.";
/** Total de uma coluna em que alguma linha pelo teto veio sem valor (sem permissão): o total não inclui essas linhas. */
function TotalComOcultos({ linhas, valor }: { linhas: TipLinhaConferencia[]; valor: (x: TipLinhaConferencia) => number | null | undefined }) {
  const ocultos = linhas.some((l) => l.peloTeto && valor(l) == null);
  return (
    <Table.Td style={totalTd}>
      {money(soma(linhas, valor))}
      {ocultos && <div style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }} title={OCULTO_TETO}>sem os valores ocultos</div>}
    </Table.Td>
  );
}

export function AbaContabilidade({ year, month, canEdit, onNotice }: Props) {
  const [dados, setDados] = useState<TipConferenciaCompleta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [soPendentes, setSoPendentes] = useState(false);
  const [aceitando, setAceitando] = useState<{ chave: string; texto: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  // Trocar o extrato de uma empresa (a contabilidade reemitiu): vale também com o OK dado.
  const entradaTroca = useRef<HTMLInputElement>(null);
  const [trocando, setTrocando] = useState<{ id: string; empresa: string } | null>(null);
  const [resultadoTroca, setResultadoTroca] = useState<{ empresa: string; troca: TipTrocaExtrato; avisos: string[] } | null>(null);
  const ord = useOrdenacao("conferencia");
  const col = useColunas("conferencia");
  const filtro = useFiltro("conferencia");
  // O apelido vem na linha; se não vier (backend antigo), sai do cadastro pelo funcionário.
  const apelidos = useContext(ApelidosContext);
  const erro = (e: unknown) => onNotice("error", (e as Error).message);

  // Títulos da folha liberados no Contas a Pagar (só existem depois do OK à contabilidade).
  const [lotes, setLotes] = useState<TipFolhaLote[]>([]);
  const [soltos, setSoltos] = useState(0);

  async function carregar() {
    try {
      const conf = await getTipConferencia(year, month);
      setDados(conf);
      const r = conf.etapas.estado.OK_CONTABILIDADE.marcada ? await getTipFolhaLotes(year, month) : { lotes: [], soltos: 0 };
      setLotes(r.lotes);
      setSoltos(r.soltos ?? 0);
    } catch (e) { erro(e); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDados(null); setLotes([]); void carregar(); }, [year, month]);

  const aplicarConf = (c: TipConferencia) => setDados((d) => (d ? { ...d, ...c } : d));

  async function enviarArquivos(lista: FileList | null) {
    if (!lista?.length) return;
    setOcupado(true);
    try {
      const avisos: string[] = [];
      for (const arquivo of Array.from(lista)) {
        const r = await enviarTipExtrato(year, month, await lerComoBase64(arquivo), arquivo.name);
        aplicarConf(r);
        avisos.push(...r.avisos);
      }
      onNotice(avisos.length ? "warning" : "success", avisos.length ? `Extrato lido. Confira: ${avisos.join(" ")}` : "Extrato lido e conferido.");
    } catch (e) { erro(e); } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  function escolherTroca(id: string, empresa: string) {
    setTrocando({ id, empresa });
    entradaTroca.current?.click();
  }

  async function trocarExtrato(lista: FileList | null) {
    const alvo = trocando;
    const arquivo = lista?.[0];
    if (entradaTroca.current) entradaTroca.current.value = "";
    if (!alvo || !arquivo) return;
    // Com o OK dado (ou a folha liberada) o motivo é obrigatório e vai para a auditoria.
    const travado = Boolean(dados?.etapas.estado.OK_CONTABILIDADE.marcada) || lotes.length > 0;
    const motivo = (window.prompt(`Por que trocar o extrato de ${alvo.empresa}? (ex.: contabilidade reemitiu)`) ?? "").trim();
    if (travado && motivo.length < 5) {
      onNotice("error", "Para trocar o extrato com o OK dado, escreva o motivo (pelo menos 5 letras).");
      return;
    }
    setOcupado(true);
    try {
      const r = await enviarTipExtrato(year, month, await lerComoBase64(arquivo), arquivo.name, { substitui: alvo.id, ...(motivo ? { motivo } : {}) });
      aplicarConf(r);
      if (r.troca) setResultadoTroca({ empresa: alvo.empresa, troca: r.troca, avisos: r.avisos });
      onNotice(r.avisos.length || r.troca?.contasAPagar.length ? "warning" : "success", `Extrato de ${alvo.empresa} trocado.`);
    } catch (e) { erro(e); } finally {
      setOcupado(false);
      setTrocando(null);
    }
  }

  async function etapa(e: TipEtapa, acao: "MARCOU" | "DESMARCOU") {
    setOcupado(true);
    try {
      const etapas = await marcarTipEtapa(year, month, e, acao);
      setDados((d) => (d ? { ...d, etapas } : d));
    } catch (err) { erro(err); } finally { setOcupado(false); }
  }

  if (!dados) return <div style={panelStyle}><span style={mutedStyle}>Carregando…</span></div>;
  const { estado } = dados.etapas;
  const fechado = dados.status === "CLOSED";
  const ok = estado.OK_CONTABILIDADE.marcada;
  const filtradas = filtro.aplicar(dados.linhas.filter((l) => !soPendentes || PENDENTE.has(l.status)),
    (l) => [textoPessoa(l.nome, resolverApelido(apelidos, l.employeeId, l.apelido)), l.nomeNoExtrato ?? "", l.empresa ?? "", l.justificativa ?? ""].join(" "),
    { empresa: (l) => l.empresa, status: (l) => STATUS[l.status].rotulo });
  const linhas = aplicarOrdem(filtradas, ord.ordem, EXT);
  const filtrando = filtro.ativo || soPendentes;
  const v = col.visivel;
  const antesDosValores = v("empresa") ? 2 : 1;
  const th =(c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "nome" || c === "empresa" || c === "status" ? "asc" : "desc") });

  const passos: Array<{ chave: TipEtapa | "APURADA" | "CONFERIDO"; titulo: string; feito: boolean; detalhe: string; acao?: TipEtapa }> = [
    { chave: "APURADA", titulo: "Apuração fechada", feito: fechado, detalhe: fechado ? dados.code : "feche na aba Apuração" },
    { chave: "ENVIADO_CONTABILIDADE", titulo: "Enviado à contabilidade", feito: estado.ENVIADO_CONTABILIDADE.marcada,
      detalhe: estado.ENVIADO_CONTABILIDADE.marcada ? `${quando(estado.ENVIADO_CONTABILIDADE.em)} · ${estado.ENVIADO_CONTABILIDADE.por}` : "PDF na aba Pagamento e envio",
      // Com títulos liberados o envio não se desmarca: trocar o extrato é "Trocar extrato";
      // desfazer, "Desfazer liberação" no passo 5 (o backend recusa do mesmo jeito).
      acao: lotes.length > 0 ? undefined : "ENVIADO_CONTABILIDADE" },
    { chave: "CONFERIDO", titulo: "Extratos conferidos", feito: dados.extratos.length > 0 && dados.pendentes === 0,
      detalhe: dados.extratos.length === 0 ? "nenhum extrato" : dados.pendentes ? `${dados.pendentes} pendência(s)` : `${dados.extratos.length} empresa(s), tudo certo` },
    { chave: "OK_CONTABILIDADE", titulo: "OK dado à contabilidade", feito: ok,
      detalhe: ok ? `${quando(estado.OK_CONTABILIDADE.em)} · ${estado.OK_CONTABILIDADE.por}` : "responda o e-mail e marque aqui",
      // Com títulos liberados o OK não se desmarca (desfaça a liberação antes).
      acao: lotes.length > 0 ? undefined : "OK_CONTABILIDADE" },
    // Liberar cria os títulos no Contas a Pagar; o passo fica feito sozinho quando todos são
    // baixados. "Folha paga" marcada à mão (antes dos títulos) ainda pode ser desmarcada.
    { chave: "FOLHA_PAGA", titulo: "Liberar para pagamento", feito: estado.FOLHA_PAGA.marcada,
      detalhe: estado.FOLHA_PAGA.marcada
        ? `${lotes.length > 0 ? "todos os títulos pagos · " : ""}${quando(estado.FOLHA_PAGA.em)} · ${estado.FOLHA_PAGA.por}`
        : resumoDosLotes(lotes),
      acao: lotes.length === 0 && estado.FOLHA_PAGA.marcada ? "FOLHA_PAGA" : undefined },
  ];
  const proximo = passos.findIndex((p) => !p.feito);

  return (
    <div className="aba-contabilidade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ol className="etapas-folha" aria-label="Etapas do mês">
        {passos.map((p, i) => (
          <li key={p.chave} className={p.feito ? "feita" : i === proximo ? "atual" : undefined}>
            <span className="etapas-folha-marca" aria-hidden>{p.feito ? <Check size={13} /> : i + 1}</span>
            <div>
              <strong>{p.titulo}</strong>
              <span>{p.detalhe}</span>
              {canEdit && p.acao && (p.feito
                ? <button type="button" className="barra-lista-link" disabled={ocupado} onClick={() => void etapa(p.acao!, "DESMARCOU")}>desmarcar</button>
                : i === proximo && <Button size="sm" disabled={ocupado} onClick={() => void etapa(p.acao!, "MARCOU")}>Marcar como feito</Button>)}
            </div>
          </li>
        ))}
      </ol>

      {dados.podeVerFolha && (
        <LiberarPagamento year={year} month={month} lotes={lotes} soltos={soltos} onSoltos={setSoltos} liberavel={ok && !(estado.FOLHA_PAGA.marcada && lotes.length === 0)} canEdit={canEdit}
          onLotes={setLotes} onEtapas={(etapas) => setDados((d) => (d ? { ...d, etapas } : d))} onNotice={onNotice} />
      )}

      <div style={panelStyle}>
        <div className="cabecalho-painel">
          <div className="cabecalho-painel-texto">
            <strong>Extratos da contabilidade</strong>
            <span>Um por empresa. A gorjeta do extrato é conferida com a gorjeta líquida da apuração (rateio − vales).</span>
          </div>
          {canEdit && !ok && (
            <div className="cabecalho-painel-acoes">
              <input ref={entrada} type="file" accept="application/pdf" multiple hidden onChange={(e) => void enviarArquivos(e.target.files)} />
              <Button size="sm" leadingIcon={<FileUp size={14} />} disabled={ocupado} onClick={() => entrada.current?.click()}>
                {ocupado ? "Lendo…" : "Carregar extrato (PDF)"}
              </Button>
            </div>
          )}
        </div>
        <input ref={entradaTroca} type="file" accept="application/pdf" hidden aria-label="PDF do extrato novo" onChange={(e) => void trocarExtrato(e.target.files)} />
        {resultadoTroca && (
          <ResultadoTrocaExtrato empresa={resultadoTroca.empresa} troca={resultadoTroca.troca} avisos={resultadoTroca.avisos} onFechar={() => setResultadoTroca(null)} />
        )}
        {dados.extratos.length === 0
          ? (
            <div className="estado-vazio">
              <strong>Nenhum extrato carregado para esta competência.</strong>
              <span>Quando a contabilidade devolver o extrato de cada empresa, carregue o PDF aqui: a conferência é automática.</span>
            </div>
          )
          : (
            <ul className="lista-extratos">
              {dados.extratos.map((x) => (
                <li key={x.id}>
                  <strong>{x.empresa}</strong>
                  <span style={mutedStyle}>{x.pessoas} pessoas · {x.arquivo} · {quando(x.importadoEm)} por {x.importadoPor}</span>
                  {canEdit && (
                    <button type="button" className="barra-lista-link" disabled={ocupado} aria-label={`Trocar o extrato de ${x.empresa}`}
                      title="A contabilidade reemitiu? Escolha o PDF novo da mesma empresa" onClick={() => escolherTroca(x.id, x.empresa)}>
                      <RefreshCw size={12} /> Trocar extrato
                    </button>
                  )}
                  {canEdit && !ok && (
                    <button type="button" className="botao-desfazer" aria-label={`Tirar o extrato de ${x.empresa}`} title="Tirar este extrato"
                      onClick={() => void removerTipExtrato(year, month, x.id).then(aplicarConf).catch(erro)}><Trash2 size={14} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>

      {dados.extratos.length > 0 && (
        <div style={panelStyle}>
          <div className="barra-lista">
            <strong>Conferência</strong>
            <span style={mutedStyle}>
              {dados.linhas.filter((l) => l.status === "OK").length} batem · {dados.pendentes} pendente(s) · {dados.linhas.filter((l) => l.status === "ACEITA").length} aceita(s)
            </span>
            <label className="barra-lista-campo" style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> Só pendências
            </label>
            <SeletorColunas colunas={COLUNAS} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
          </div>
          <BarraFiltro filtro={filtro} total={dados.linhas.length} visiveis={filtradas.length} placeholder="Filtrar por nome, apelido, empresa…"
            listas={[
              { chave: "empresa", rotulo: "Empresa", opcoes: opcoesDe(dados.linhas, (l) => l.empresa) },
              { chave: "status", rotulo: "Situação", opcoes: opcoesDe(dados.linhas, (l) => STATUS[l.status].rotulo) },
            ]} />
          {filtradas.length === 0 && <span style={mutedStyle}>{soPendentes && !filtro.ativo ? "Nenhuma pendência." : "Ninguém bate com o filtro."}</span>}
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <ThOrdenavel {...th("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
                {v("empresa") && <ThOrdenavel {...th("empresa")}>Empresa</ThOrdenavel>}
                {v("apuracao") && <ThOrdenavel {...th("apuracao")} title="Rateio − vales + créditos (com teto do IR: a gorjeta informada)">Apuração</ThOrdenavel>}
                {v("extrato") && <ThOrdenavel {...th("extrato")}>Extrato</ThOrdenavel>}
                {v("dif") && <ThOrdenavel {...th("dif")}>Diferença</ThOrdenavel>}
                <ThOrdenavel {...th("status")}>Situação</ThOrdenavel>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {linhas.map((l) => {
                const pend = PENDENTE.has(l.status);
                const abrindo = aceitando?.chave === l.chave;
                return (
                  <Table.Row key={l.chave} className={pend ? "linha-pendente" : undefined}>
                    <Table.Td style={{ textAlign: "left" }}>
                      <NomePessoa nome={nomeProprio(l.nome)} employeeId={l.employeeId} apelido={l.apelido} />
                      {l.justificativa && <div style={mutedStyle}>{l.justificativa}</div>}
                      {l.status === "VINCULO_A_CONFIRMAR" && l.nomeNoExtrato && l.nomeNoExtrato !== l.nome && (
                        <div style={mutedStyle}>no extrato: {l.nomeNoExtrato}</div>
                      )}
                      {abrindo && (
                        <form className="aceite-form" onSubmit={(e) => {
                          e.preventDefault();
                          void aceitarTipDivergencia(year, month, l.chave, aceitando.texto).then((c) => { aplicarConf(c); setAceitando(null); }).catch(erro);
                        }}>
                          <input autoFocus value={aceitando.texto} onChange={(e) => setAceitando({ chave: l.chave, texto: e.target.value })}
                            placeholder="Por que está certo assim?" aria-label={`Justificativa para ${l.nome}`} />
                          <Button type="submit" disabled={aceitando.texto.trim().length < 5}>Aceitar</Button>
                          {aceitando.texto.trim().length < 5 && <span className="dica-minimo">faltam {5 - aceitando.texto.trim().length} letra(s)</span>}
                          <button type="button" className="barra-lista-link" onClick={() => setAceitando(null)}>cancelar</button>
                        </form>
                      )}
                    </Table.Td>
                    {v("empresa") && <Table.Td style={mutedStyle}>{l.empresa ?? "—"}</Table.Td>}
                    {v("apuracao") && (
                      <Table.Td title={l.peloTeto ? (l.apuracao == null
                        ? "Gorjeta informada pelo teto do IR (teto − salário registrado): o valor exige permissão de ver Funcionários."
                        : "Gorjeta informada pelo teto do IR: teto − salário registrado. A pessoa recebe a gorjeta dos pontos na folha.") : undefined}>
                        {l.apuracao == null ? "—" : money(l.apuracao)}
                        {l.peloTeto && <div style={{ fontSize: 11, color: "var(--muted)" }}>pelo teto do IR</div>}
                        {l.naRescisao && <div style={{ fontSize: 11, color: "var(--muted)" }}>paga na rescisão</div>}
                      </Table.Td>
                    )}
                    {v("extrato") && <Table.Td title={l.peloTeto && l.extrato == null ? OCULTO_TETO : undefined}>{l.extrato == null ? "—" : money(l.extrato)}</Table.Td>}
                    {v("dif") && (
                      <Table.Td style={{ fontWeight: 600, color: l.diferenca && Math.abs(l.diferenca) >= 0.01 && pend ? "var(--danger)" : undefined }}>
                        {l.diferenca == null || Math.abs(l.diferenca) < 0.01 ? "—" : money(l.diferenca)}
                      </Table.Td>
                    )}
                    <Table.Td>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <StatusBadge tone={STATUS[l.status].tom}>{STATUS[l.status].rotulo}</StatusBadge>
                        {canEdit && !ok && l.status === "VINCULO_A_CONFIRMAR" && l.extratoId && (
                          <>
                            <button type="button" className="barra-lista-link" title={`No extrato: ${l.nomeNoExtrato ?? l.nome}`}
                              onClick={() => void confirmarTipVinculo(year, month, l.extratoId!, l.nomeNoExtrato ?? l.nome, true).then(aplicarConf).catch(erro)}>é esta pessoa</button>
                            <button type="button" className="barra-lista-link"
                              onClick={() => void confirmarTipVinculo(year, month, l.extratoId!, l.nomeNoExtrato ?? l.nome, false).then(aplicarConf).catch(erro)}>não é</button>
                          </>
                        )}
                        {canEdit && !ok && pend && l.status !== "VINCULO_A_CONFIRMAR" && !abrindo && (
                          <button type="button" className="barra-lista-link" onClick={() => setAceitando({ chave: l.chave, texto: "" })}>aceitar</button>
                        )}
                        {canEdit && !ok && l.status === "ACEITA" && (
                          <button type="button" className="botao-desfazer" title="Desfazer o aceite" aria-label={`Desfazer o aceite de ${l.nome}`}
                            onClick={() => void desfazerTipAceite(year, month, l.chave).then(aplicarConf).catch(erro)}><Undo2 size={13} /></button>
                        )}
                      </div>
                    </Table.Td>
                  </Table.Row>
                );
              })}
              <Table.Row>
                <Table.Td colSpan={antesDosValores} style={{ ...totalTd, textAlign: "left" }}>
                  {filtrando ? `Total do filtro (${filtradas.length} de ${dados.linhas.length})` : "Total"}
                </Table.Td>
                {v("apuracao") && <TotalComOcultos linhas={filtradas} valor={(l) => l.apuracao} />}
                {v("extrato") && <TotalComOcultos linhas={filtradas} valor={(l) => l.extrato} />}
                {v("dif") && <TotalComOcultos linhas={filtradas} valor={(l) => l.diferenca} />}
                <Table.Td style={totalTd}> </Table.Td>
              </Table.Row>
            </Table.Body>
          </Table>
        </div>
      )}

      {dados.podeVerFolha
        ? <FolhaLiquidos year={year} month={month} canEdit={canEdit} liberada={ok} versao={`${dados.extratos.map((x) => x.id + x.importadoEm).join()}|${ok}|${dados.linhas.map((l) => l.chave + l.status).join()}`} onNotice={onNotice} />
        : <div style={panelStyle}><span style={mutedStyle}>A folha salarial líquidos tem salários e PIX: aparece para quem pode ver Funcionários.</span></div>}
    </div>
  );
}
