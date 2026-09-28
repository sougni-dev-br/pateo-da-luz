import { History, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type TipFunction, type TipMudanca, type TipTeamMember, getTipCompanies, getTipFunctions, getTipMemberHistory, getTipTeam,
  saveTipFunctions, saveTipTeamMember,
} from "../../api/client";
import { HistoricoLinhaDoTempo } from "./HistoricoLinhaDoTempo";
import { Alert, Button, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import "./gorjeta.css";
import { inputStyle, mutedStyle, numInputStyle, panelStyle, pts } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

type Props = {
  canEdit: boolean;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
  onChanged: () => void;
};

const nome = (e: TipTeamMember) => (e.displayName || `${e.firstName} ${e.lastName}`).trim();
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const primeiroDe = (texto: Set<string>) => (coluna: string) => (texto.has(coluna) ? "asc" as const : "desc" as const);

const COLUNAS_EQUIPE: ColunaOpcional[] = [
  { chave: "participa", rotulo: "Participa" }, { chave: "funcao", rotulo: "Função" }, { chave: "pers", rotulo: "Pontos pers." },
  { chave: "base", rotulo: "Base" }, { chave: "empresa", rotulo: "Empresa" },
];
const TEXTO_EQUIPE = new Set(["nome", "funcao", "empresa"]);

const COLUNAS_FUNCOES: ColunaOpcional[] = [
  { chave: "pontos", rotulo: "Pontos" }, { chave: "min", rotulo: "Mín." }, { chave: "max", rotulo: "Máx." },
  { chave: "grupo", rotulo: "Grupo" }, { chave: "obs", rotulo: "Observação" }, { chave: "ativa", rotulo: "Ativa" },
];
const TEXTO_FUNCOES = new Set(["nome", "grupo", "obs"]);

type FuncaoComIndice = { f: TipFunction; i: number };
const EXTRATORES_FUNCOES: Extratores<FuncaoComIndice> = {
  nome: ({ f }) => f.name,
  pontos: ({ f }) => f.points,
  min: ({ f }) => f.minPoints,
  max: ({ f }) => f.maxPoints,
  grupo: ({ f }) => f.group,
  obs: ({ f }) => f.notes,
  ativa: ({ f }) => (f.isActive ? 1 : 0),
};

// Quem participa da gorjeta, com que função e em que empresa. Os pontos-base do
// rateio saem daqui: função (ou pontos personalizados). O ajuste de cada mês é
// feito na aba Apuração, sem mexer nesta base.
export function AbaEquipe({ canEdit, onNotice, onChanged }: Props) {
  const [team, setTeam] = useState<TipTeamMember[]>([]);
  const [funcoes, setFuncoes] = useState<TipFunction[]>([]);
  const [empresas, setEmpresas] = useState<Array<{ id: string; tradeName: string }>>([]);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [funcoesSujas, setFuncoesSujas] = useState(false);
  // Vigência e motivo das mudanças de função/pontos: vão para o histórico.
  const [vigencia, setVigencia] = useState(() => new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [historicoDe, setHistoricoDe] = useState<TipTeamMember | null>(null);
  const [historico, setHistorico] = useState<TipMudanca[] | null>(null);
  const painelHistorico = useRef<HTMLDivElement>(null);

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
  const ordFuncoes = useOrdenacao("funcoes");
  const colFuncoes = useColunas("funcoes");
  const ve = colEquipe.visivel;
  const vf = colFuncoes.visivel;
  const primeiroEquipe = primeiroDe(TEXTO_EQUIPE);
  const primeiroFuncoes = primeiroDe(TEXTO_FUNCOES);
  const thE = (coluna: string) => ({ coluna, ordem: ordEquipe.ordem, onOrdenar: () => ordEquipe.alternar(coluna, primeiroEquipe(coluna)) });
  const thF = (coluna: string) => ({ coluna, ordem: ordFuncoes.ordem, onOrdenar: () => ordFuncoes.alternar(coluna, primeiroFuncoes(coluna)) });

  async function carregar() {
    try {
      const [t, f, c] = await Promise.all([getTipTeam(), getTipFunctions(), getTipCompanies()]);
      setTeam(t);
      setFuncoes(f);
      setEmpresas(c);
      setFuncoesSujas(false);
    } catch (e) {
      onNotice("error", (e as Error).message);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, []);

  const funcaoPorId = useMemo(() => new Map(funcoes.filter((f) => f.id).map((f) => [f.id!, f])), [funcoes]);
  const empresaPorId = useMemo(() => new Map(empresas.map((c) => [c.id, c.tradeName])), [empresas]);
  const baseDe = (m: TipTeamMember) => {
    const f = m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId) : undefined;
    return m.pontosPadrao ?? f?.points ?? null;
  };

  const extratoresEquipe: Extratores<TipTeamMember> = {
    nome: (m) => nome(m),
    participa: (m) => (m.participaGorjeta ? 1 : 0),
    funcao: (m) => (m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId)?.name : null),
    pers: (m) => m.pontosPadrao,
    base: (m) => baseDe(m),
    empresa: (m) => (m.companyId ? empresaPorId.get(m.companyId) : null),
  };

  async function salvarMembro(m: TipTeamMember, patch: Partial<TipTeamMember>) {
    const novo = { ...m, ...patch };
    setTeam((prev) => prev.map((x) => (x.id === m.id ? novo : x)));
    setSalvando(m.id);
    try {
      await saveTipTeamMember(m.id, {
        participaGorjeta: novo.participaGorjeta, tipoGorjeta: novo.tipoGorjeta, cotaFixaGorjeta: novo.cotaFixaGorjeta,
        pontosPadrao: novo.pontosPadrao, tipFunctionId: novo.tipFunctionId, companyId: novo.companyId,
        validFrom: vigencia || undefined, reason: motivo.trim() || undefined,
      });
      onChanged();
      if (historicoDe?.id === m.id) setHistorico(await getTipMemberHistory(m.id));
    } catch (e) {
      setTeam((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      onNotice("error", (e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  function editarFuncao(i: number, patch: Partial<TipFunction>) {
    setFuncoes((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    setFuncoesSujas(true);
  }

  async function salvarFuncoes() {
    try {
      await saveTipFunctions(funcoes, { validFrom: vigencia || undefined, reason: motivo.trim() || undefined });
      onNotice("success", "Tabela de funções salva. Use \"Atualizar do cadastro\" na Apuração para levar os novos pontos ao período aberto.");
      await carregar();
      onChanged();
    } catch (e) {
      onNotice("error", (e as Error).message);
    }
  }

  const visiveis = team.filter((m) => mostrarInativos || m.isActive || m.participaGorjeta);
  const equipeOrdenada = aplicarOrdem(visiveis, ordEquipe.ordem, extratoresEquipe);
  const participantes = team.filter((m) => m.participaGorjeta);
  const somaBase = participantes.filter((m) => m.isActive).reduce((a, m) => a + (baseDe(m) ?? 0), 0);

  // A edição usa a posição original da função; a ordem é só de exibição.
  // Função nova (ainda sem id) fica sempre no fim, onde foi criada.
  const funcoesComIndice = funcoes.map((f, i) => ({ f, i }));
  const funcoesOrdenadas = [
    ...aplicarOrdem(funcoesComIndice.filter((x) => x.f.id), ordFuncoes.ordem, EXTRATORES_FUNCOES),
    ...funcoesComIndice.filter((x) => !x.f.id),
  ];

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
          Pontos-base = pontos da função, ou os personalizados quando preenchidos. Sem registro recebe salário + gorjeta na lista de pagamento.
          A reserva da casa não é mais um funcionário: é informada em pontos nos parâmetros de cada período.
        </span>
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...thE("nome")} align="left" minWidth={200}>Funcionário</ThOrdenavel>
              {ve("participa") && <ThOrdenavel {...thE("participa")}>Participa</ThOrdenavel>}
              {ve("funcao") && <ThOrdenavel {...thE("funcao")} minWidth={200}>Função</ThOrdenavel>}
              {ve("pers") && <ThOrdenavel {...thE("pers")} title="Pontos personalizados: substituem os da função">Pontos pers.</ThOrdenavel>}
              {ve("base") && <ThOrdenavel {...thE("base")}>Base</ThOrdenavel>}
              {ve("empresa") && <ThOrdenavel {...thE("empresa")} minWidth={160}>Empresa</ThOrdenavel>}
              <Table.Th aria-label="Histórico"> </Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {equipeOrdenada.map((m) => {
              const f = m.tipFunctionId ? funcaoPorId.get(m.tipFunctionId) : undefined;
              const base = baseDe(m);
              const foraFaixa = m.pontosPadrao != null && f && (
                (f.minPoints != null && m.pontosPadrao < f.minPoints) || (f.maxPoints != null && m.pontosPadrao > f.maxPoints));
              const off = !canEdit || salvando === m.id;
              return (
                <Table.Row key={m.id}>
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
                      <select style={inputStyle} value={m.tipFunctionId ?? ""} disabled={off}
                        onChange={(e) => void salvarMembro(m, { tipFunctionId: e.target.value || null })}>
                        <option value="">—</option>
                        {funcoes.filter((x) => x.isActive || x.id === m.tipFunctionId).map((x) => (
                          <option key={x.id} value={x.id}>{x.name} ({pts(x.points)})</option>
                        ))}
                      </select>
                    </Table.Td>
                  )}
                  {ve("pers") && (
                    <Table.Td>
                      <input key={`${m.id}-${m.pontosPadrao}`} style={{ ...numInputStyle, textAlign: "center" }} type="number" step="0.5" min="0" disabled={off}
                        defaultValue={m.pontosPadrao ?? ""} placeholder={f ? pts(f.points) : ""} aria-label={`Pontos personalizados de ${nome(m)}`}
                        onBlur={(e) => {
                          const v = numOrNull(e.target.value);
                          if (v !== m.pontosPadrao) void salvarMembro(m, { pontosPadrao: v });
                        }} />
                    </Table.Td>
                  )}
                  {ve("base") && (
                    <Table.Td style={{ fontWeight: 600, color: foraFaixa ? "var(--warning, #b45309)" : undefined }}
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

      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>Funções e pontos-base</strong>
          <div className="barra-lista">
            <SeletorColunas colunas={COLUNAS_FUNCOES} ocultas={colFuncoes.ocultas} alternar={colFuncoes.alternar} mostrarTodas={colFuncoes.mostrarTodas} />
            {canEdit && (
              <>
                <Button variant="secondary" leadingIcon={<Plus size={14} />}
                  onClick={() => { setFuncoes((p) => [...p, { name: "", points: 0, minPoints: null, maxPoints: null, group: null, notes: null, isActive: true }]); setFuncoesSujas(true); }}>
                  Nova função
                </Button>
                <Button leadingIcon={<Save size={14} />} disabled={!funcoesSujas} onClick={() => void salvarFuncoes()}>Salvar tabela</Button>
              </>
            )}
          </div>
        </div>
        {funcoesSujas && <Alert tone="warning">Alterações na tabela ainda não salvas.</Alert>}
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...thF("nome")} align="left" minWidth={200}>Função / nível</ThOrdenavel>
              {vf("pontos") && <ThOrdenavel {...thF("pontos")}>Pontos</ThOrdenavel>}
              {vf("min") && <ThOrdenavel {...thF("min")}>Mín.</ThOrdenavel>}
              {vf("max") && <ThOrdenavel {...thF("max")}>Máx.</ThOrdenavel>}
              {vf("grupo") && <ThOrdenavel {...thF("grupo")}>Grupo</ThOrdenavel>}
              {vf("obs") && <ThOrdenavel {...thF("obs")} minWidth={220}>Observação</ThOrdenavel>}
              {vf("ativa") && <ThOrdenavel {...thF("ativa")}>Ativa</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {funcoesOrdenadas.map(({ f, i }) => (
              <Table.Row key={f.id ?? `nova-${i}`}>
                <Table.Td><input style={inputStyle} value={f.name} disabled={!canEdit} aria-label="Nome da função" onChange={(e) => editarFuncao(i, { name: e.target.value })} /></Table.Td>
                {vf("pontos") && <Table.Td><input style={{ ...numInputStyle, textAlign: "center" }} type="number" step="0.5" min="0" value={f.points} disabled={!canEdit} aria-label="Pontos" onChange={(e) => editarFuncao(i, { points: Number(e.target.value) })} /></Table.Td>}
                {vf("min") && <Table.Td><input style={{ ...numInputStyle, textAlign: "center" }} type="number" step="0.5" min="0" value={f.minPoints ?? ""} disabled={!canEdit} aria-label="Mínimo" onChange={(e) => editarFuncao(i, { minPoints: numOrNull(e.target.value) })} /></Table.Td>}
                {vf("max") && <Table.Td><input style={{ ...numInputStyle, textAlign: "center" }} type="number" step="0.5" min="0" value={f.maxPoints ?? ""} disabled={!canEdit} aria-label="Máximo" onChange={(e) => editarFuncao(i, { maxPoints: numOrNull(e.target.value) })} /></Table.Td>}
                {vf("grupo") && <Table.Td><input style={{ ...inputStyle, width: 120, textAlign: "center" }} value={f.group ?? ""} disabled={!canEdit} aria-label="Grupo" onChange={(e) => editarFuncao(i, { group: e.target.value || null })} /></Table.Td>}
                {vf("obs") && <Table.Td><input style={inputStyle} value={f.notes ?? ""} disabled={!canEdit} aria-label="Observação" onChange={(e) => editarFuncao(i, { notes: e.target.value || null })} /></Table.Td>}
                {vf("ativa") && <Table.Td><input type="checkbox" checked={f.isActive} disabled={!canEdit} aria-label="Função ativa" onChange={(e) => editarFuncao(i, { isActive: e.target.checked })} /></Table.Td>}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </div>
  );
}
