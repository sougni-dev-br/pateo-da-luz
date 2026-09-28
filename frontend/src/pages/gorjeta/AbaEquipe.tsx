import { History, X } from "lucide-react";
import { EditorExtra, ExtraCelula } from "./PontoExtra";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  type TipFunction, type TipMudanca, type TipTeamMember, getTipCompanies, getTipFunctions, getTipMemberHistory, getTipTeam,
  saveTipTeamMember,
} from "../../api/client";
import { HistoricoLinhaDoTempo } from "./HistoricoLinhaDoTempo";
import { StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import "./gorjeta.css";
import { inputStyle, mutedStyle, panelStyle, pts } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Props = {
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  onChanged: () => void;
};

const nome = (e: TipTeamMember) => (e.displayName || `${e.firstName} ${e.lastName}`).trim();
const primeiroDe = (texto: Set<string>) => (coluna: string) => (texto.has(coluna) ? "asc" as const : "desc" as const);

const COLUNAS_EQUIPE: ColunaOpcional[] = [
  { chave: "participa", rotulo: "Participa" }, { chave: "funcao", rotulo: "Função" }, { chave: "pfuncao", rotulo: "Pontos da função" },
  { chave: "extra", rotulo: "Ponto extra" }, { chave: "base", rotulo: "Total" }, { chave: "empresa", rotulo: "Empresa" },
];
const TEXTO_EQUIPE = new Set(["nome", "funcao", "empresa"]);


// Quem participa da gorjeta, com que função e em que empresa. Os pontos-base do
// rateio saem daqui: pontos da função + ponto extra da pessoa (com justificativa).
// O ajuste de cada mês é feito na aba Apuração, sem mexer nesta base.
export function AbaEquipe({ canEdit, onNotice, onChanged }: Props) {
  const [team, setTeam] = useState<TipTeamMember[]>([]);
  const [funcoes, setFuncoes] = useState<TipFunction[]>([]);
  const [empresas, setEmpresas] = useState<Array<{ id: string; tradeName: string }>>([]);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  // Vigência e motivo das mudanças de função/pontos: vão para o histórico.
  const [vigencia, setVigencia] = useState(() => new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [historicoDe, setHistoricoDe] = useState<TipTeamMember | null>(null);
  const [historico, setHistorico] = useState<TipMudanca[] | null>(null);
  const painelHistorico = useRef<HTMLDivElement>(null);
  const [extraDe, setExtraDe] = useState<string | null>(null);

  async function abrirHistorico(m: TipTeamMember) {
    if (historicoDe?.id === m.id) { setHistoricoDe(null); return; }
    setHistoricoDe(m);
    setHistorico(null);
    try { setHistorico(await getTipMemberHistory(m.id)); } catch (e) { onNotice("error", (e as Error).message); }
  }
  // O histórico abre abaixo da tabela: rola até ele.
  useEffect(() => {
    if (historicoDe) painelHistorico.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [historicoDe]);

  const ordEquipe = useOrdenacao("equipe");
  const colEquipe = useColunas("equipe");
  const ve = colEquipe.visivel;
  const primeiroEquipe = primeiroDe(TEXTO_EQUIPE);
  const thE = (coluna: string) => ({ coluna, ordem: ordEquipe.ordem, onOrdenar: () => ordEquipe.alternar(coluna, primeiroEquipe(coluna)) });

  async function carregar() {
    try {
      const [t, f, c] = await Promise.all([getTipTeam(), getTipFunctions(), getTipCompanies()]);
      setTeam(t);
      setFuncoes(f);
      setEmpresas(c);
    } catch (e) {
      onNotice("error", (e as Error).message);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, []);

  const funcaoPorId = useMemo(() => new Map(funcoes.filter((f) => f.id).map((f) => [f.id!, f])), [funcoes]);
  const empresaPorId = useMemo(() => new Map(empresas.map((c) => [c.id, c.tradeName])), [empresas]);
  const pontosDaFuncao = (m: TipTeamMember) => (m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId)?.points ?? null : null);
  const baseDe = (m: TipTeamMember) => {
    const f = pontosDaFuncao(m);
    if (f == null && m.pontosExtra == null) return null;
    return Math.max(0, Math.round(((f ?? 0) + (m.pontosExtra ?? 0)) * 100) / 100);
  };
  // Funções agrupadas (Salão, Cozinha…) para o seletor ficar curto de ler.
  const funcoesPorGrupo = useMemo(() => {
    const grupos = new Map<string, TipFunction[]>();
    for (const x of funcoes) {
      if (!x.id) continue;
      const g = x.group?.trim() || "Outras";
      grupos.set(g, [...(grupos.get(g) ?? []), x]);
    }
    return [...grupos.entries()];
  }, [funcoes]);

  const extratoresEquipe: Extratores<TipTeamMember> = {
    nome: (m) => nome(m),
    participa: (m) => (m.participaGorjeta ? 1 : 0),
    funcao: (m) => (m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId)?.name : null),
    pfuncao: (m) => pontosDaFuncao(m),
    extra: (m) => m.pontosExtra,
    base: (m) => baseDe(m),
    empresa: (m) => (m.companyId ? empresaPorId.get(m.companyId) : null),
  };

  async function salvarMembro(m: TipTeamMember, patch: Partial<TipTeamMember>): Promise<boolean> {
    const novo = { ...m, ...patch };
    setTeam((prev) => prev.map((x) => (x.id === m.id ? novo : x)));
    setSalvando(m.id);
    try {
      await saveTipTeamMember(m.id, {
        participaGorjeta: novo.participaGorjeta, tipoGorjeta: novo.tipoGorjeta, cotaFixaGorjeta: novo.cotaFixaGorjeta,
        pontosExtra: novo.pontosExtra, pontosExtraMotivo: novo.pontosExtraMotivo, tipFunctionId: novo.tipFunctionId, companyId: novo.companyId,
        validFrom: vigencia || undefined, reason: motivo.trim() || undefined,
      });
      onChanged();
      if (historicoDe?.id === m.id) setHistorico(await getTipMemberHistory(m.id));
      return true;
    } catch (e) {
      setTeam((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      onNotice("error", (e as Error).message);
      return false;
    } finally {
      setSalvando(null);
    }
  }

  const visiveis = team.filter((m) => mostrarInativos || m.isActive || m.participaGorjeta);
  const equipeOrdenada = aplicarOrdem(visiveis, ordEquipe.ordem, extratoresEquipe);
  const participantes = team.filter((m) => m.participaGorjeta);
  const somaBase = participantes.filter((m) => m.isActive).reduce((a, m) => a + (baseDe(m) ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="barra-vigencia">
        <History size={16} aria-hidden />
        <span>Mudanças de função e pontos valem a partir de</span>
        <input type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} aria-label="Vigência das mudanças" />
        <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ex.: promoção a líder)"
          aria-label="Motivo das mudanças" style={{ flex: "1 1 220px" }} />
        <span className="barra-vigencia-nota">Fica no histórico de cada pessoa e nos Relatórios.</span>
      </div>

      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <strong>Equipe da gorjeta</strong>
          <div className="barra-lista">
            <span style={mutedStyle}>
              {participantes.length} participantes · <strong>{pts(somaBase)}</strong> pontos-base entre os ativos
              {salvando && " · salvando…"}
            </span>
            <label className="barra-lista-campo">
              <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} />
              Mostrar desligados que não participam
            </label>
            <SeletorColunas colunas={COLUNAS_EQUIPE} ocultas={colEquipe.ocultas} alternar={colEquipe.alternar} mostrarTodas={colEquipe.mostrarTodas} />
          </div>
        </div>
        <span style={mutedStyle}>
          Total = pontos da função + ponto extra. O extra é da pessoa (sobe ou desce) e sempre tem justificativa; a função não muda.
          Os pontos de cada função se editam na aba “Funções e pontos”. Sem registro recebe salário + gorjeta na lista de pagamento.
        </span>
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...thE("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
              {ve("participa") && <ThOrdenavel {...thE("participa")}>Participa</ThOrdenavel>}
              {ve("funcao") && <ThOrdenavel {...thE("funcao")} minWidth={190}>Função</ThOrdenavel>}
              {ve("pfuncao") && <ThOrdenavel {...thE("pfuncao")} title="Pontos definidos na tabela de funções">Pontos da função</ThOrdenavel>}
              {ve("extra") && <ThOrdenavel {...thE("extra")} minWidth={170} title="Ponto extra da pessoa, com justificativa">Ponto extra</ThOrdenavel>}
              {ve("base") && <ThOrdenavel {...thE("base")} title="Pontos da função + ponto extra">Total</ThOrdenavel>}
              {ve("empresa") && <ThOrdenavel {...thE("empresa")} minWidth={150}>Empresa</ThOrdenavel>}
              <Table.Th aria-label="Histórico"> </Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {equipeOrdenada.map((m) => {
              const f = m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId) : undefined;
              const base = baseDe(m);
              const foraFaixa = m.pontosExtra != null && base != null && f && (
                (f.minPoints != null && base < f.minPoints) || (f.maxPoints != null && base > f.maxPoints));
              const off = !canEdit || salvando === m.id;
              const editando = extraDe === m.id;
              const colunasVisiveis = 2 + COLUNAS_EQUIPE.filter((c) => ve(c.chave)).length;
              return (
                <Fragment key={m.id}>
                <Table.Row className={editando ? "linha-em-edicao" : undefined}>
                  <Table.Td>
                    <div style={{ fontWeight: 500 }}>{nome(m)}</div>
                    <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                      {m.modality === "NAO_CLT" && <StatusBadge tone="warning">Sem registro</StatusBadge>}
                      {!m.isActive && <StatusBadge tone="neutral">Desligado</StatusBadge>}
                    </div>
                  </Table.Td>
                  {ve("participa") && (
                    <Table.Td>
                      <input type="checkbox" checked={m.participaGorjeta} disabled={off} aria-label={`${nome(m)} participa da gorjeta`}
                        onChange={(e) => void salvarMembro(m, { participaGorjeta: e.target.checked })} />
                    </Table.Td>
                  )}
                  {ve("funcao") && (
                    <Table.Td>
                      <select style={inputStyle} value={m.tipFunctionId ?? ""} disabled={off} aria-label={`Função de ${nome(m)}`}
                        onChange={(e) => void salvarMembro(m, { tipFunctionId: e.target.value || null })}>
                        <option value="">— sem função —</option>
                        {funcoesPorGrupo.map(([grupo, lista]) => (
                          <optgroup key={grupo} label={grupo}>
                            {lista.filter((x) => x.isActive || x.id === m.tipFunctionId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </Table.Td>
                  )}
                  {ve("pfuncao") && <Table.Td style={{ color: f ? undefined : "var(--muted)" }}>{f ? pts(f.points) : "—"}</Table.Td>}
                  {ve("extra") && (
                    <Table.Td>
                      <ExtraCelula extra={m.pontosExtra} motivo={m.pontosExtraMotivo} aberto={editando} podeEditar={!off}
                        rotulo={nome(m)} onAbrir={() => setExtraDe(editando ? null : m.id)} />
                    </Table.Td>
                  )}
                  {ve("base") && (
                    <Table.Td style={{ fontWeight: 700, color: foraFaixa ? "var(--warning, #b45309)" : undefined }}
                      title={foraFaixa ? `Fora da faixa da função (${f?.minPoints} a ${f?.maxPoints})` : undefined}>
                      {pts(base)}{foraFaixa ? " ⚠" : ""}
                    </Table.Td>
                  )}
                  {ve("empresa") && (
                    <Table.Td>
                      <select style={inputStyle} value={m.companyId ?? ""} disabled={off}
                        onChange={(e) => void salvarMembro(m, { companyId: e.target.value || null })}>
                        <option value="">—</option>
                        {empresas.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                      </select>
                    </Table.Td>
                  )}
                  <Table.Td>
                    <button type="button" onClick={() => void abrirHistorico(m)} aria-expanded={historicoDe?.id === m.id}
                      aria-label={`Histórico de ${nome(m)}`} title="Histórico de função e pontos"
                      style={{ border: "none", borderRadius: 6, padding: 4, cursor: "pointer", background: historicoDe?.id === m.id ? "var(--paper-soft)" : "transparent", color: "var(--muted)" }}>
                      <History size={15} />
                    </button>
                  </Table.Td>
                </Table.Row>
                {editando && (
                  <Table.Row className="linha-editor-extra">
                    <Table.Td colSpan={colunasVisiveis}>
                      <EditorExtra nome={nome(m)} pontosFuncao={f?.points ?? null} extra={m.pontosExtra} motivo={m.pontosExtraMotivo}
                        salvando={salvando === m.id}
                        onCancelar={() => setExtraDe(null)}
                        onSalvar={async (extra, motivoExtra) => {
                          if (await salvarMembro(m, { pontosExtra: extra, pontosExtraMotivo: motivoExtra })) setExtraDe(null);
                        }} />
                    </Table.Td>
                  </Table.Row>
                )}
                </Fragment>
              );
            })}
          </Table.Body>
        </Table>
        {historicoDe && (
          <div ref={painelHistorico} className="painel-historico">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong>Histórico de {nome(historicoDe)}</strong>
              <button type="button" onClick={() => setHistoricoDe(null)} aria-label="Fechar histórico"
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><X size={16} /></button>
            </div>
            {historico == null ? <span style={mutedStyle}>Carregando…</span> : <HistoricoLinhaDoTempo mudancas={historico} />}
          </div>
        )}
      </div>

    </div>
  );
}
