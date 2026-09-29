// Aba "Funções e pontos": a tabela de funções com os pontos de cada uma.
// Nada se perde: cada alteração vai para um rascunho neste navegador; gravar no
// sistema é um passo explícito (revisar → salvar), com vigência e motivo.
import { AlertTriangle, History, Plus, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type TipFunction, getTipFunctionsTable, getTipTeam, saveTipFunctions } from "../../api/client";
import { Alert, Button, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import "./gorjeta.css";
import { hojeLocal, inputStyle, mutedStyle, numInputStyle, panelStyle, pts } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";
import {
  type CampoFuncao, type Diferenca, ROTULO_CAMPO, apagarRascunho, chaveDe, diferencas, gravarRascunho, lerRascunho, problemas,
} from "./rascunhoFuncoes";

type Props = {
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  onChanged: () => void;
};

const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const valorTexto = (c: CampoFuncao, v: unknown) =>
  v == null ? "—" : c === "isActive" ? (v ? "sim" : "não") : typeof v === "number" ? pts(v) : String(v);

const COLUNAS: ColunaOpcional[] = [
  { chave: "grupo", rotulo: "Grupo" }, { chave: "min", rotulo: "Mín." }, { chave: "max", rotulo: "Máx." },
  { chave: "pessoas", rotulo: "Pessoas" }, { chave: "obs", rotulo: "Observação" }, { chave: "ativa", rotulo: "Ativa" },
];
const TEXTO = new Set(["nome", "grupo", "obs"]);
type Linha = { f: TipFunction; i: number };

export function AbaFuncoes({ canEdit, onNotice, onChanged }: Props) {
  const [original, setOriginal] = useState<TipFunction[]>([]);
  const [versao, setVersao] = useState("");
  const [funcoes, setFuncoes] = useState<TipFunction[]>([]);
  const [vigencia, setVigencia] = useState(hojeLocal());
  const [motivo, setMotivo] = useState("");
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "info" | "warning"; texto: string } | null>(null);
  const [pessoasPorFuncao, setPessoasPorFuncao] = useState<Map<string, number>>(new Map());
  const [revisando, setRevisando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const ord = useOrdenacao("funcoes");
  const col = useColunas("funcoes");
  const v = col.visivel;

  async function carregar(manterRascunho: boolean) {
    try {
      const [tabela, equipe] = await Promise.all([getTipFunctionsTable(), getTipTeam()]);
      const contagem = new Map<string, number>();
      for (const m of equipe) if (m.participaGorjeta && m.isActive && m.tipFunctionId) contagem.set(m.tipFunctionId, (contagem.get(m.tipFunctionId) ?? 0) + 1);
      setPessoasPorFuncao(contagem);
      setOriginal(tabela.funcoes);
      setVersao(tabela.versao);
      const r = manterRascunho ? lerRascunho() : null;
      const pendentes = r ? diferencas(tabela.funcoes, r.funcoes).length : 0;
      if (r && pendentes > 0) {
        setFuncoes(r.funcoes);
        setVigencia(r.vigencia || hojeLocal());
        setMotivo(r.motivo ?? "");
        setSalvoEm(r.salvoEm);
        setAviso(r.versao === tabela.versao
          ? { tom: "info", texto: `Recuperamos ${pendentes} alteração(ões) não salvas, do rascunho de ${hora(r.salvoEm)}.` }
          : { tom: "warning", texto: `Seu rascunho de ${hora(r.salvoEm)} foi recuperado, mas a tabela foi salva depois dele. Confira as alterações antes de salvar.` });
      } else {
        if (r) apagarRascunho();
        setFuncoes(tabela.funcoes);
        setSalvoEm(null);
      }
      setCarregado(true);
    } catch (e) {
      onNotice("error", (e as Error).message);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(true); }, []);

  const difs = useMemo(() => diferencas(original, funcoes), [original, funcoes]);
  const erros = useMemo(() => problemas(funcoes), [funcoes]);
  const pendente = difs.length > 0;
  const alteradas = useMemo(() => new Map(difs.map((d) => [d.chave, d])), [difs]);

  // Guarda o rascunho a cada alteração (e o limpa quando não há mais nada pendente).
  useEffect(() => {
    if (!carregado) return;
    if (!pendente) { apagarRascunho(); setSalvoEm(null); return; }
    const agora = new Date().toISOString();
    if (gravarRascunho({ versao, salvoEm: agora, funcoes, vigencia, motivo })) setSalvoEm(agora);
  }, [carregado, pendente, versao, funcoes, vigencia, motivo]);

  // Fechar ou recarregar a página com alteração pendente pede confirmação.
  useEffect(() => {
    if (!pendente) return;
    const segurar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", segurar);
    return () => window.removeEventListener("beforeunload", segurar);
  }, [pendente]);

  function editar(i: number, patch: Partial<TipFunction>) {
    setFuncoes((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  function desfazer(d: Diferenca) {
    if (d.nova) { setFuncoes((prev) => prev.filter((f, i) => chaveDe(f, i) !== d.chave)); return; }
    const velha = original.find((f) => f.id === d.id);
    if (velha) setFuncoes((prev) => prev.map((f) => (f.id === d.id ? velha : f)));
  }
  function descartar() {
    if (!window.confirm(`Descartar ${difs.length} alteração(ões) não salvas?`)) return;
    setFuncoes(original);
    setRevisando(false);
    setAviso(null);
  }

  async function salvar() {
    setSalvando(true);
    try {
      await saveTipFunctions(funcoes, { validFrom: vigencia || undefined, reason: motivo.trim() || undefined, baseVersion: versao });
      apagarRascunho();
      setRevisando(false);
      setAviso(null);
      setMotivo("");
      await carregar(false);
      onChanged();
      onNotice("success", "Tabela de funções salva. Para levar os novos pontos ao período aberto, use \"Atualizar do cadastro\" na Apuração.");
    } catch (e) {
      const msg = (e as Error).message;
      onNotice("error", msg);
      if (/outra pessoa/i.test(msg)) setAviso({ tom: "warning", texto: "Outra pessoa salvou a tabela enquanto você editava. Seu rascunho continua aqui. Clique em \"Comparar com a versão salva\" para ver as diferenças de novo antes de gravar." });
    } finally {
      setSalvando(false);
    }
  }

  // Compara o rascunho com a versão mais nova do servidor, sem perder nada.
  async function compararComServidor() {
    let tabela: Awaited<ReturnType<typeof getTipFunctionsTable>>;
    try { tabela = await getTipFunctionsTable(); } catch (e) { onNotice("error", (e as Error).message); return; }
    setOriginal(tabela.funcoes);
    setVersao(tabela.versao);
    setAviso({ tom: "info", texto: "Rascunho comparado com a versão salva agora. As células marcadas são o que você ainda vai mudar." });
  }

  const extratores: Extratores<Linha> = {
    nome: ({ f }) => f.name, pontos: ({ f }) => f.points, min: ({ f }) => f.minPoints, max: ({ f }) => f.maxPoints,
    grupo: ({ f }) => f.group, obs: ({ f }) => f.notes, ativa: ({ f }) => (f.isActive ? 1 : 0),
    pessoas: ({ f }) => (f.id ? pessoasPorFuncao.get(f.id) ?? 0 : 0),
  };
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, TEXTO.has(c) ? "asc" : "desc") });
  const comIndice = funcoes.map((f, i) => ({ f, i }));
  // Função nova (ainda sem id) fica no fim, onde foi criada; a ordem é só de exibição.
  const linhas = [...aplicarOrdem(comIndice.filter((x) => x.f.id), ord.ordem, extratores), ...comIndice.filter((x) => !x.f.id)];
  const ativas = funcoes.filter((f) => f.isActive).length;
  const off = !canEdit || salvando;

  // Célula alterada: destaque + valor anterior no título.
  const marca = (chave: string, campo: CampoFuncao) => {
    const d = alteradas.get(chave);
    if (!d) return {};
    if (d.nova) return { className: "celula-nova" };
    const c = d.campos.find((x) => x.campo === campo);
    return c ? { className: "celula-alterada", title: `Antes: ${valorTexto(campo, c.antes)}` } : {};
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {aviso && <Alert tone={aviso.tom === "warning" ? "warning" : "info"}>{aviso.texto}</Alert>}

      <div style={panelStyle}>
        <div className="barra-lista">
          <strong>Funções e pontos-base</strong>
          <span style={mutedStyle}>{funcoes.length} funções · {ativas} ativas</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <SeletorColunas colunas={COLUNAS} ocultas={col.ocultas} alternar={col.alternar} mostrarTodas={col.mostrarTodas} />
            {canEdit && (
              <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} disabled={off}
                onClick={() => setFuncoes((p) => [...p, { name: "", points: 0, minPoints: null, maxPoints: null, group: null, notes: null, isActive: true }])}>
                Nova função
              </Button>
            )}
          </div>
        </div>
        <span style={mutedStyle}>
          Os pontos da função valem para todos que estão nela; o extra de cada pessoa fica na aba Equipe. Nada é gravado até você clicar em
          “Revisar e salvar” — enquanto isso, as alterações ficam guardadas neste navegador.
        </span>
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("nome")} align="left" minWidth={220}>Função / nível</ThOrdenavel>
              {v("grupo") && <ThOrdenavel {...th("grupo")}>Grupo</ThOrdenavel>}
              <ThOrdenavel {...th("pontos")}>Pontos</ThOrdenavel>
              {v("min") && <ThOrdenavel {...th("min")}>Mín.</ThOrdenavel>}
              {v("max") && <ThOrdenavel {...th("max")}>Máx.</ThOrdenavel>}
              {v("pessoas") && <ThOrdenavel {...th("pessoas")} title="Participantes ativos nesta função">Pessoas</ThOrdenavel>}
              {v("obs") && <ThOrdenavel {...th("obs")} minWidth={200}>Observação</ThOrdenavel>}
              {v("ativa") && <ThOrdenavel {...th("ativa")}>Ativa</ThOrdenavel>}
              <Table.Th aria-label="Desfazer"> </Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map(({ f, i }) => {
              const chave = chaveDe(f, i);
              const d = alteradas.get(chave);
              const pessoas = f.id ? pessoasPorFuncao.get(f.id) ?? 0 : 0;
              return (
                <Table.Row key={chave} className={d ? "linha-alterada" : undefined}>
                  <Table.Td {...marca(chave, "name")}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input style={inputStyle} value={f.name} disabled={off} aria-label="Nome da função" onChange={(e) => editar(i, { name: e.target.value })} />
                      {d?.nova && <StatusBadge tone="info">nova</StatusBadge>}
                    </div>
                  </Table.Td>
                  {v("grupo") && <Table.Td {...marca(chave, "group")}><input style={{ ...inputStyle, width: 130, textAlign: "center" }} value={f.group ?? ""} disabled={off} aria-label={`Grupo de ${f.name}`} onChange={(e) => editar(i, { group: e.target.value || null })} /></Table.Td>}
                  <Table.Td {...marca(chave, "points")}><input style={{ ...numInputStyle, width: 72, textAlign: "center", fontWeight: 700 }} type="number" step="0.5" min="0" value={f.points} disabled={off} aria-label={`Pontos de ${f.name}`} onChange={(e) => editar(i, { points: numOrNull(e.target.value) ?? 0 })} /></Table.Td>
                  {v("min") && <Table.Td {...marca(chave, "minPoints")}><input style={{ ...numInputStyle, textAlign: "center" }} type="number" step="0.5" min="0" value={f.minPoints ?? ""} disabled={off} aria-label={`Mínimo de ${f.name}`} onChange={(e) => editar(i, { minPoints: numOrNull(e.target.value) })} /></Table.Td>}
                  {v("max") && <Table.Td {...marca(chave, "maxPoints")}><input style={{ ...numInputStyle, textAlign: "center" }} type="number" step="0.5" min="0" value={f.maxPoints ?? ""} disabled={off} aria-label={`Máximo de ${f.name}`} onChange={(e) => editar(i, { maxPoints: numOrNull(e.target.value) })} /></Table.Td>}
                  {v("pessoas") && <Table.Td style={{ color: pessoas ? undefined : "var(--muted)" }}>{pessoas}</Table.Td>}
                  {v("obs") && <Table.Td {...marca(chave, "notes")}><input style={inputStyle} value={f.notes ?? ""} disabled={off} aria-label={`Observação de ${f.name}`} onChange={(e) => editar(i, { notes: e.target.value || null })} /></Table.Td>}
                  {v("ativa") && <Table.Td {...marca(chave, "isActive")}><input type="checkbox" checked={f.isActive} disabled={off} aria-label={`${f.name} ativa`} onChange={(e) => editar(i, { isActive: e.target.checked })} /></Table.Td>}
                  <Table.Td>
                    {d && canEdit && (
                      <button type="button" className="botao-desfazer" onClick={() => desfazer(d)} disabled={salvando}
                        title={d.nova ? "Remover a função nova" : "Voltar ao que está salvo"} aria-label={`Desfazer alterações em ${f.name || "função nova"}`}>
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      {pendente && canEdit && (
        <div className="barra-salvar" role="region" aria-label="Alterações não salvas">
          {revisando && (
            <div className="barra-salvar-revisao">
              <strong>O que vai ser gravado</strong>
              <ul>
                {difs.map((d) => {
                  const n = d.id ? pessoasPorFuncao.get(d.id) ?? 0 : 0;
                  return (
                    <li key={d.chave}>
                      <span className="barra-salvar-funcao">{d.nova ? "Nova: " : ""}{d.nome}</span>
                      {d.campos.map((c) => (
                        <span key={c.campo} className="barra-salvar-campo">
                          {ROTULO_CAMPO[c.campo]} {d.nova ? valorTexto(c.campo, c.depois) : <>{valorTexto(c.campo, c.antes)} → <strong>{valorTexto(c.campo, c.depois)}</strong></>}
                        </span>
                      ))}
                      {!d.nova && d.campos.some((c) => c.campo === "points") && n > 0 && (
                        <span className="barra-salvar-afeta"><History size={12} /> muda a base de {n} pessoa(s)</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {erros.length > 0 && (
            <div className="barra-salvar-erros" role="alert">
              <AlertTriangle size={14} />
              <span>{erros.join(" ")}</span>
            </div>
          )}
          <div className="barra-salvar-linha">
            <span className="barra-salvar-status">
              <span className="ponto-pendente" aria-hidden /> {difs.length} alteração(ões) não salvas
              {salvoEm && <span style={mutedStyle}> · rascunho guardado {hora(salvoEm)}</span>}
            </span>
            <label className="barra-lista-campo">Vale a partir de
              <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} aria-label="Vigência das alterações" />
            </label>
            <input className="barra-salvar-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo (ex.: reajuste de pontos da cozinha)" aria-label="Motivo das alterações" />
            <div className="barra-salvar-acoes">
              <button type="button" className="barra-lista-link" onClick={descartar} disabled={salvando}>Descartar</button>
              {aviso?.tom === "warning" && (
                <Button variant="secondary" onClick={() => void compararComServidor()} disabled={salvando}>Comparar com a versão salva</Button>
              )}
              {revisando
                ? <Button leadingIcon={<Save size={14} />} onClick={() => void salvar()} disabled={salvando || erros.length > 0}>{salvando ? "Salvando…" : "Confirmar e salvar"}</Button>
                : <Button leadingIcon={<Save size={14} />} onClick={() => setRevisando(true)} disabled={erros.length > 0}>Revisar e salvar</Button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
