import { Copy, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPlanejamentoCenario,
  deletePlanejamentoCenario,
  getPlanejamentoCenario,
  listPlanejamentoCenarios,
  previaPlanejamentoProjecao,
  updatePlanejamentoCenario,
  type PlanejamentoCenario,
  type PlanejamentoCenarioResumo,
  type PlanejamentoLinhaDeGasto,
  type PlanejamentoPremissasDoMes,
  type PlanejamentoProjecao,
  type PlanejamentoResultado
} from "../../api/client";
import { Notice, useNotice } from "../../components/Notice";
import { Dialog } from "../../components/ui/Dialog";
import { useSession } from "../../context/SessionContext";
import { Alert, Button, EmptyState, FormGrid, Select, TextField } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { hasPermission } from "../../lib/permissions";
import { GastosEditor } from "./GastosEditor";
import { PremissasEditor } from "./PremissasEditor";
import { ResultadoGastos } from "./ResultadoGastos";
import { ResultadoProjecao } from "./ResultadoProjecao";

// Planejamento > Cenários: a aba "2027" da planilha. Parte de um ano-base real e aplica, mês a mês, o
// crescimento de clientes e de ticket médio por turno e o CMV. Vários cenários por ano (ex.: conservador e otimista).

const ATRASO_DA_PREVIA_MS = 350;

const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);
const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function Cenarios() {
  const { user } = useSession();
  const podeCriar = hasPermission(user, "planning", "create");
  const podeEditar = hasPermission(user, "planning", "edit");
  const podeExcluir = hasPermission(user, "planning", "delete");
  const { notice, setNotice } = useNotice();
  const showNotice = (tone: "success" | "error", message: string) => setNotice({ tone, message });
  const anoAtual = Number(hojeLocalIso().slice(0, 4));

  const [lista, setLista] = useState<PlanejamentoCenarioResumo[] | null>(null);
  const [cenario, setCenario] = useState<PlanejamentoCenario | null>(null);
  const [premissas, setPremissas] = useState<PlanejamentoPremissasDoMes[]>([]);
  const [anoBase, setAnoBase] = useState(0);
  const [gastos, setGastos] = useState<PlanejamentoLinhaDeGasto[]>([]);
  const [servicoPercentual, setServicoPercentual] = useState<number | null>(null);
  const [projecao, setProjecao] = useState<PlanejamentoProjecao | null>(null);
  const [resultado, setResultado] = useState<PlanejamentoResultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [dialogoNovo, setDialogoNovo] = useState(false);

  const sujo = cenario !== null && (anoBase !== cenario.anoBase || !iguais(premissas, cenario.premissas) || !iguais(gastos, cenario.gastos) || servicoPercentual !== cenario.servicoPercentual);
  const sujoRef = useRef(sujo);
  sujoRef.current = sujo;

  const pedidoDeAbertura = useRef(0);

  const abrir = useCallback(async (id: string) => {
    // Só a abertura mais recente vale: uma resposta atrasada de outro cenário é descartada.
    const pedido = ++pedidoDeAbertura.current;
    setCarregando(true);
    setErro(null);
    try {
      const aberto = await getPlanejamentoCenario(id);
      if (pedido !== pedidoDeAbertura.current) return;
      setCenario(aberto);
      setPremissas(aberto.premissas);
      setAnoBase(aberto.anoBase);
      setGastos(aberto.gastos);
      setServicoPercentual(aberto.servicoPercentual);
      setProjecao(aberto.projecao);
      setResultado(aberto.resultado);
    } catch (e) {
      if (pedido === pedidoDeAbertura.current) setErro(mensagemDe(e, "Não foi possível abrir o cenário."));
    } finally {
      if (pedido === pedidoDeAbertura.current) setCarregando(false);
    }
  }, []);

  const recarregarLista = useCallback(async (abrirId?: string) => {
    const resumos = await listPlanejamentoCenarios();
    setLista(resumos);
    const alvo = abrirId ?? resumos[0]?.id;
    if (alvo) await abrir(alvo);
    else { setCenario(null); setProjecao(null); setResultado(null); setCarregando(false); }
  }, [abrir]);

  useEffect(() => {
    recarregarLista().catch((e: unknown) => { setErro(mensagemDe(e, "Não foi possível carregar os cenários.")); setCarregando(false); });
    // Carga inicial apenas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prévia: recalcula no servidor enquanto as premissas mudam, sem gravar. A resposta antiga é descartada.
  useEffect(() => {
    if (!cenario) return undefined;
    if (!sujo) {
      // Voltou ao estado salvo (ex.: desfez a edição): mostra de novo o resultado gravado, não o da edição intermediária.
      setProjecao(cenario.projecao);
      setResultado(cenario.resultado);
      return undefined;
    }
    let cancelado = false;
    setCalculando(true);
    const espera = window.setTimeout(() => {
      previaPlanejamentoProjecao({ anoBase, premissas, gastos, servicoPercentual })
        .then((r) => { if (!cancelado) { setProjecao(r.projecao); setResultado(r.resultado); setErro(null); } })
        .catch((e: unknown) => { if (!cancelado) setErro(mensagemDe(e, "Não foi possível calcular a projeção.")); })
        .finally(() => { if (!cancelado) setCalculando(false); });
    }, ATRASO_DA_PREVIA_MS);
    return () => { cancelado = true; window.clearTimeout(espera); setCalculando(false); };
  }, [anoBase, premissas, gastos, servicoPercentual, cenario, sujo]);

  function trocarCenario(id: string) {
    if (id === cenario?.id || salvando) return;
    if (sujoRef.current && !window.confirm("Há alterações não salvas neste cenário. Descartar e abrir o outro?")) return;
    void abrir(id);
  }

  async function salvar() {
    if (!cenario) return;
    setSalvando(true);
    try {
      const salvo = await updatePlanejamentoCenario(cenario.id, { nome: cenario.nome, anoBase, premissas, gastos, servicoPercentual, atualizadoEm: cenario.atualizadoEm });
      setCenario(salvo);
      setPremissas(salvo.premissas);
      setGastos(salvo.gastos);
      setServicoPercentual(salvo.servicoPercentual);
      setProjecao(salvo.projecao);
      setResultado(salvo.resultado);
      setLista((atual) => atual?.map((r) => (r.id === salvo.id ? { ...r, anoBase: salvo.anoBase, atualizadoEm: salvo.atualizadoEm } : r)) ?? atual);
      setErro(null);
      showNotice("success", "Cenário salvo.");
    } catch (e) {
      showNotice("error", mensagemDe(e, "Não foi possível salvar o cenário."));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!cenario) return;
    if (!window.confirm(`Excluir o cenário "${cenario.nome}"? Isso não pode ser desfeito.`)) return;
    try {
      await deletePlanejamentoCenario(cenario.id);
      showNotice("success", "Cenário excluído.");
      await recarregarLista();
    } catch (e) {
      showNotice("error", mensagemDe(e, "Não foi possível excluir o cenário."));
    }
  }

  async function duplicar() {
    if (!cenario) return;
    try {
      const copia = await createPlanejamentoCenario({ ano: cenario.ano, anoBase, nome: `${cenario.nome} (cópia)`.slice(0, 60), premissas, gastos, servicoPercentual });
      showNotice("success", "Cópia criada.");
      await recarregarLista(copia.id);
    } catch (e) {
      showNotice("error", mensagemDe(e, "Não foi possível duplicar o cenário."));
    }
  }

  const opcoes = useMemo(() => (lista ?? []).map((r) => ({ value: r.id, label: `${r.ano} · ${r.nome}` })), [lista]);
  const anosBase = useMemo(() => {
    if (!cenario) return [];
    const anos = new Set([anoBase, ...Array.from({ length: 4 }, (_, i) => cenario.ano - 1 - i).filter((a) => a >= 2020)]);
    return [...anos].filter((a) => a > 0).sort((a, b) => b - a).map((a) => ({ value: String(a), label: String(a) }));
  }, [cenario, anoBase]);

  if (carregando && !cenario && !erro) return <div className="page-loading">Carregando cenários…</div>;

  return (
    <div className="plan">
      <p className="plan-intro">Projeção do Salão a partir de um ano real: você define o crescimento de clientes e de ticket médio por turno e o CMV de cada mês, e o ERP calcula as vendas. Cada cenário é independente (por exemplo, conservador e otimista).</p>
      <Notice notice={notice} />
      {erro && <Alert tone="error">{erro}</Alert>}

      <div className="plan-barra">
        {lista && lista.length > 0 && (
          <Select aria-label="Cenário" disabled={salvando} value={cenario?.id ?? ""} onChange={(e) => trocarCenario(e.target.value)} options={opcoes} containerClassName="plan-filtro plan-filtro-largo" />
        )}
        {podeCriar && <Button variant="secondary" disabled={salvando} onClick={() => { if (sujo && !window.confirm("Há alterações não salvas neste cenário. Descartar e criar outro?")) return; setDialogoNovo(true); }}><Plus size={16} aria-hidden /> Novo cenário</Button>}
        {cenario && podeCriar && <Button variant="secondary" onClick={() => void duplicar()}><Copy size={16} aria-hidden /> Duplicar</Button>}
        {cenario && podeExcluir && <Button variant="secondary" onClick={() => void excluir()}><Trash2 size={16} aria-hidden /> Excluir</Button>}
      </div>

      {!cenario && !erro && (
        <EmptyState
          title="Nenhum cenário ainda."
          description={podeCriar ? "Crie um cenário para projetar o próximo ano a partir do ano atual." : "Peça a quem administra o sistema para criar um cenário."}
        />
      )}

      {cenario && (
        <div className="plan-conteudo" aria-busy={carregando || calculando}>
          <section className="plan-secao" aria-labelledby="plan-premissas">
            <div className="plan-cabecalho-secao">
              <div>
                <h2 id="plan-premissas" className="plan-titulo">Premissas de {cenario.ano}</h2>
                <p className="plan-sub">Percentuais sobre o mesmo mês de {anoBase}. Ex.: clientes do almoço 10 = 10% a mais que em {anoBase}.</p>
              </div>
              <div className="plan-barra">
                {anosBase.length > 1 && podeEditar && (
                  <Select aria-label="Ano-base" value={String(anoBase)} onChange={(e) => setAnoBase(Number(e.target.value))} options={anosBase} containerClassName="plan-filtro" />
                )}
                {podeEditar && (
                  <Button onClick={() => void salvar()} disabled={!sujo || salvando}><Save size={16} aria-hidden /> {salvando ? "Salvando…" : "Salvar"}</Button>
                )}
                {sujo && !salvando && <Button variant="secondary" onClick={() => void abrir(cenario.id)}>Descartar alterações</Button>}
              </div>
            </div>
            {sujo && <Alert tone="info">Alterações ainda não salvas.{podeEditar ? "" : " Você só pode ver este cenário."}</Alert>}
            <div className="plan-quadro plan-quadro-estreito">
              <PremissasEditor premissas={premissas} desabilitado={!podeEditar || salvando} onMudar={setPremissas} />
            </div>
          </section>

          <section className="plan-secao" aria-labelledby="plan-gastos">
            <div>
              <h2 id="plan-gastos" className="plan-titulo">Gastos de {cenario.ano}</h2>
              <p className="plan-sub">Valor fixo por mês (R$) ou percentual das vendas. A folha é a total, com o serviço dentro: o serviço abate dela no resultado.</p>
            </div>
            <GastosEditor gastos={gastos} servicoPercentual={servicoPercentual} desabilitado={!podeEditar || salvando} onMudarGastos={setGastos} onMudarServico={setServicoPercentual} />
          </section>

          <section className="plan-secao" aria-labelledby="plan-resultado">
            <h2 id="plan-resultado" className="plan-titulo">Resultado projetado</h2>
            {projecao && projecao.total.meses.length === 0 ? (
              <EmptyState
                title={`Nenhum mês de ${anoBase} serve de base.`}
                description={`A projeção parte de meses encerrados de ${anoBase}, com vendas e clientes registrados. Se esse ano veio de planilha, peça a carga do histórico a quem administra o sistema.`}
              />
            ) : projecao && <ResultadoProjecao projecao={projecao} ano={cenario.ano} anoBase={anoBase} />}
          </section>

          {projecao && resultado && projecao.total.meses.length > 0 && (
            <section className="plan-secao" aria-labelledby="plan-lucro">
              <h2 id="plan-lucro" className="plan-titulo">Lucro do cenário</h2>
              <ResultadoGastos projecao={projecao} resultado={resultado} />
            </section>
          )}
        </div>
      )}

      <NovoCenario aberto={dialogoNovo} anoSugerido={cenario?.ano ?? anoAtual + 1} onFechar={() => setDialogoNovo(false)} onCriado={async (id) => { setDialogoNovo(false); showNotice("success", "Cenário criado."); await recarregarLista(id); }} />
    </div>
  );
}

type NovoProps = { aberto: boolean; anoSugerido: number; onFechar: () => void; onCriado: (id: string) => Promise<void> };

function NovoCenario({ aberto, anoSugerido, onFechar, onCriado }: NovoProps) {
  const [nome, setNome] = useState("");
  const [ano, setAno] = useState(String(anoSugerido));
  const [anoBase, setAnoBase] = useState(String(anoSugerido - 1));
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setNome("");
    setAno(String(anoSugerido));
    setAnoBase(String(anoSugerido - 1));
    setErro(null);
  }, [aberto, anoSugerido]);

  async function criar() {
    setGravando(true);
    setErro(null);
    try {
      const criado = await createPlanejamentoCenario({ ano: Number(ano), anoBase: Number(anoBase), nome: nome.trim() });
      await onCriado(criado.id);
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível criar o cenário."));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} title="Novo cenário" description="Começa com todas as premissas em 0%: o resultado igual ao ano-base." size="sm">
      <form onSubmit={(e) => { e.preventDefault(); void criar(); }}>
        <FormGrid>
          <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Ex.: Conservador" autoFocus required />
          <TextField label="Ano projetado" inputMode="numeric" value={ano} onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
          <TextField label="Ano-base (real)" inputMode="numeric" value={anoBase} onChange={(e) => setAnoBase(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
        </FormGrid>
        {erro && <Alert tone="error">{erro}</Alert>}
        <div className="plan-dialogo-acoes">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={gravando || nome.trim() === "" || ano.length !== 4 || anoBase.length !== 4}>{gravando ? "Criando…" : "Criar cenário"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
