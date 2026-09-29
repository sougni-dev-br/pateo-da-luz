// Depois da apuração: envio à contabilidade → extratos devolvidos (conferência)
// → OK dado → folha salarial líquidos → paga. Cada etapa fica registrada.
import { Check, FileUp, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type TipConferencia, type TipConferenciaCompleta, type TipEtapa, type TipLinhaConferencia, type TipStatusConferencia,
  aceitarTipDivergencia, desfazerTipAceite, enviarTipExtrato, getTipConferencia, marcarTipEtapa, removerTipExtrato,
} from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { FolhaLiquidos } from "./FolhaLiquidos";
import "./gorjeta.css";
import { money, mutedStyle, panelStyle } from "./gorjetaUtils";
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
};
const PENDENTE = new Set<TipStatusConferencia>(["DIVERGE", "FALTA_NO_EXTRATO", "SO_NO_EXTRATO", "SEM_EXTRATO_DA_EMPRESA"]);
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

export function AbaContabilidade({ year, month, canEdit, onNotice }: Props) {
  const [dados, setDados] = useState<TipConferenciaCompleta | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [soPendentes, setSoPendentes] = useState(false);
  const [aceitando, setAceitando] = useState<{ chave: string; texto: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const ord = useOrdenacao("conferencia");
  const erro = (e: unknown) => onNotice("error", (e as Error).message);

  async function carregar() {
    try { setDados(await getTipConferencia(year, month)); } catch (e) { erro(e); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDados(null); void carregar(); }, [year, month]);

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
  const linhas = aplicarOrdem(dados.linhas.filter((l) => !soPendentes || PENDENTE.has(l.status)), ord.ordem, EXT);
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "nome" || c === "empresa" || c === "status" ? "asc" : "desc") });

  const passos: Array<{ chave: TipEtapa | "APURADA" | "CONFERIDO"; titulo: string; feito: boolean; detalhe: string; acao?: TipEtapa }> = [
    { chave: "APURADA", titulo: "Apuração fechada", feito: fechado, detalhe: fechado ? dados.code : "feche na aba Apuração" },
    { chave: "ENVIADO_CONTABILIDADE", titulo: "Enviado à contabilidade", feito: estado.ENVIADO_CONTABILIDADE.marcada,
      detalhe: estado.ENVIADO_CONTABILIDADE.marcada ? `${quando(estado.ENVIADO_CONTABILIDADE.em)} · ${estado.ENVIADO_CONTABILIDADE.por}` : "PDF na aba Pagamento e envio", acao: "ENVIADO_CONTABILIDADE" },
    { chave: "CONFERIDO", titulo: "Extratos conferidos", feito: dados.extratos.length > 0 && dados.pendentes === 0,
      detalhe: dados.extratos.length === 0 ? "nenhum extrato" : dados.pendentes ? `${dados.pendentes} pendência(s)` : `${dados.extratos.length} empresa(s), tudo certo` },
    { chave: "OK_CONTABILIDADE", titulo: "OK dado à contabilidade", feito: ok,
      detalhe: ok ? `${quando(estado.OK_CONTABILIDADE.em)} · ${estado.OK_CONTABILIDADE.por}` : "responda o e-mail e marque aqui", acao: "OK_CONTABILIDADE" },
    { chave: "FOLHA_PAGA", titulo: "Folha paga no banco", feito: estado.FOLHA_PAGA.marcada,
      detalhe: estado.FOLHA_PAGA.marcada ? `${quando(estado.FOLHA_PAGA.em)} · ${estado.FOLHA_PAGA.por}` : "depois do pagamento", acao: "FOLHA_PAGA" },
  ];
  const proximo = passos.findIndex((p) => !p.feito);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ol className="etapas-folha" aria-label="Etapas do mês">
        {passos.map((p, i) => (
          <li key={p.chave} className={p.feito ? "feita" : i === proximo ? "atual" : undefined}>
            <span className="etapas-folha-marca" aria-hidden>{p.feito ? <Check size={13} /> : i + 1}</span>
            <div>
              <strong>{p.titulo}</strong>
              <span>{p.detalhe}</span>
              {canEdit && p.acao && (p.feito
                ? <button type="button" className="barra-lista-link" disabled={ocupado} onClick={() => void etapa(p.acao!, "DESMARCOU")}>desmarcar</button>
                : i === proximo && <Button disabled={ocupado} onClick={() => void etapa(p.acao!, "MARCOU")}>Marcar</Button>)}
            </div>
          </li>
        ))}
      </ol>

      <div style={panelStyle}>
        <div className="barra-lista">
          <strong>Extratos da contabilidade</strong>
          <span style={mutedStyle}>Um por empresa. A gorjeta do extrato é conferida com a gorjeta líquida da apuração (rateio − vales).</span>
          {canEdit && !ok && (
            <div style={{ marginLeft: "auto" }}>
              <input ref={entrada} type="file" accept="application/pdf" multiple hidden onChange={(e) => void enviarArquivos(e.target.files)} />
              <Button leadingIcon={<FileUp size={14} />} disabled={ocupado} onClick={() => entrada.current?.click()}>
                {ocupado ? "Lendo…" : "Carregar extrato (PDF)"}
              </Button>
            </div>
          )}
        </div>
        {dados.extratos.length === 0
          ? <span style={mutedStyle}>Nenhum extrato carregado para esta competência.</span>
          : (
            <ul className="lista-extratos">
              {dados.extratos.map((x) => (
                <li key={x.id}>
                  <strong>{x.empresa}</strong>
                  <span style={mutedStyle}>{x.pessoas} pessoas · {x.arquivo} · {quando(x.importadoEm)} por {x.importadoPor}</span>
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
          </div>
          <Table className="tabela-gorjeta">
            <Table.Head>
              <Table.Row>
                <ThOrdenavel {...th("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
                <ThOrdenavel {...th("empresa")}>Empresa</ThOrdenavel>
                <ThOrdenavel {...th("apuracao")} title="Rateio − vales + créditos">Apuração</ThOrdenavel>
                <ThOrdenavel {...th("extrato")}>Extrato</ThOrdenavel>
                <ThOrdenavel {...th("dif")}>Diferença</ThOrdenavel>
                <ThOrdenavel {...th("status")}>Situação</ThOrdenavel>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {linhas.map((l) => {
                const pend = PENDENTE.has(l.status);
                const abrindo = aceitando?.chave === l.chave;
                return (
                  <Table.Row key={l.chave} className={pend ? "linha-pendente" : undefined}>
                    <Table.Td style={{ fontWeight: 500, textAlign: "left" }}>
                      {l.nome}
                      {l.justificativa && <div style={mutedStyle}>{l.justificativa}</div>}
                      {abrindo && (
                        <form className="aceite-form" onSubmit={(e) => {
                          e.preventDefault();
                          void aceitarTipDivergencia(year, month, l.chave, aceitando.texto).then((c) => { aplicarConf(c); setAceitando(null); }).catch(erro);
                        }}>
                          <input autoFocus value={aceitando.texto} onChange={(e) => setAceitando({ chave: l.chave, texto: e.target.value })}
                            placeholder="Por que está certo assim?" aria-label={`Justificativa para ${l.nome}`} />
                          <Button type="submit" disabled={aceitando.texto.trim().length < 5}>Aceitar</Button>
                          <button type="button" className="barra-lista-link" onClick={() => setAceitando(null)}>cancelar</button>
                        </form>
                      )}
                    </Table.Td>
                    <Table.Td style={mutedStyle}>{l.empresa ?? "—"}</Table.Td>
                    <Table.Td>{l.apuracao == null ? "—" : money(l.apuracao)}</Table.Td>
                    <Table.Td>{l.extrato == null ? "—" : money(l.extrato)}</Table.Td>
                    <Table.Td style={{ fontWeight: 600, color: l.diferenca && Math.abs(l.diferenca) >= 0.01 && pend ? "var(--danger)" : undefined }}>
                      {l.diferenca == null || Math.abs(l.diferenca) < 0.01 ? "—" : money(l.diferenca)}
                    </Table.Td>
                    <Table.Td>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <StatusBadge tone={STATUS[l.status].tom}>{STATUS[l.status].rotulo}</StatusBadge>
                        {canEdit && !ok && pend && !abrindo && (
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
            </Table.Body>
          </Table>
        </div>
      )}

      {dados.podeVerFolha
        ? <FolhaLiquidos year={year} month={month} canEdit={canEdit} liberada={ok} versao={`${dados.extratos.map((x) => x.id + x.importadoEm).join()}|${ok}`} onNotice={onNotice} />
        : <div style={panelStyle}><span style={mutedStyle}>A folha salarial líquidos tem salários e PIX: aparece para quem pode ver Funcionários.</span></div>}
    </div>
  );
}
