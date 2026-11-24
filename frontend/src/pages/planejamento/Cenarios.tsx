import { Copy, History, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createPlanejamentoCenario,
  deletePlanejamentoCenario,
  getPlanejamentoCenario,
  listPlanejamentoCenarios,
  previaPlanejamentoProjecao,
  updatePlanejamentoCenario,
  type PlanejamentoCaixa,
  type PlanejamentoCaixaPremissas,
  type PlanejamentoCenario,
  type PlanejamentoCenarioResumo,
  type PlanejamentoLinhaDeGasto,
  type PlanejamentoPremissasDoMes,
  type PlanejamentoProjecao,
  type PlanejamentoResultado
} from "../../api/client";
import { Notice, useNotice } from "../../components/Notice";
import { useSession } from "../../context/SessionContext";
import { Alert, Button, EmptyState, RowMenu, Select } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { hasPermission } from "../../lib/permissions";
import { Abas, PainelDaAba, type Aba } from "./Abas";
import { BarraDeSalvar, type FalhaAoSalvar } from "./BarraDeSalvar";
import { CabecalhoDaSecao } from "./CabecalhoDaSecao";
import { CaixaEditor } from "./CaixaEditor";
import { ehValorDePartida, mixFecha } from "./caixa";
import { useConfirmacao } from "./Confirmacao";
import { mensagemHumana } from "./erros";
import { Esqueleto } from "./Esqueleto";
import { focarCmvDepoisDeRenderizar, mesesSemCmv } from "./incompleto";
import { GastosEditor } from "./GastosEditor";
import { useRealizadoDoAnoBase } from "./gastosLeitura";
import { NovoCenarioDialog } from "./NovoCenarioDialog";
import { desfazerColuna, PremissasEditor, type DesfazerTodos } from "./PremissasEditor";
import { RealizadoCaixaDialog } from "./RealizadoCaixaDialog";
import { SecaoResultado } from "./SecaoResultado";
import { avisosDe } from "./tipos";
import { Veredito } from "./Veredito";

// Planejamento > Cenários: a aba "2027" da planilha. Parte de um ano-base real e aplica, mês a mês, o
// crescimento de clientes e de ticket médio por turno e o CMV. Vários cenários por ano (ex.: conservador e otimista).
// O veredito fica sempre no topo e reage à prévia enquanto as premissas são editadas.

const ATRASO_DA_PREVIA_MS = 350;

const mensagemDe = (e: unknown, padrao: string) => mensagemHumana(e, padrao);
const iguais = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Secao = "resultado" | "premissas" | "gastos" | "caixa";

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
  const [caixaPremissas, setCaixaPremissas] = useState<PlanejamentoCaixaPremissas | null>(null);
  const [caixa, setCaixa] = useState<PlanejamentoCaixa | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [secao, setSecao] = useState<Secao>("resultado");
  const [desfazerTodos, setDesfazerTodos] = useState<DesfazerTodos | null>(null);
  const [dialogoRealizadoCaixa, setDialogoRealizadoCaixa] = useState(false);
  // O mix e os prazos de partida são suposição; o aviso some quando a pessoa aplica o realizado ou mexe no caixa.
  const [caixaTocada, setCaixaTocada] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroDaPrevia, setErroDaPrevia] = useState<string | null>(null);
  const [falha, setFalha] = useState<FalhaAoSalvar | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [dialogoNovo, setDialogoNovo] = useState(false);
  const { confirmar, dialogo: dialogoDeConfirmacao } = useConfirmacao();
  const realizadoDoAnoBase = useRealizadoDoAnoBase(anoBase, secao === "gastos");
  const fecharDesfazer = useCallback(() => setDesfazerTodos(null), []);

  const sujo = cenario !== null && (anoBase !== cenario.anoBase || !iguais(premissas, cenario.premissas) || !iguais(gastos, cenario.gastos) || servicoPercentual !== cenario.servicoPercentual || !iguais(caixaPremissas, cenario.caixaPremissas));
  // Mix que não fecha em 100% o servidor recusa: não manda a prévia nem deixa salvar até corrigir.
  const valoresDePartida = caixaPremissas !== null && !caixaTocada && ehValorDePartida(caixaPremissas);
  const caixaValida = caixaPremissas === null || mixFecha(caixaPremissas);
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
      setCaixaPremissas(aberto.caixaPremissas);
      setCaixa(aberto.caixa);
      setCaixaTocada(false);
      setAvisos(avisosDe(aberto));
      setErroDaPrevia(null);
      setFalha(null);
      setDesfazerTodos(null);
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
    else { setCenario(null); setProjecao(null); setResultado(null); setCaixa(null); setCaixaPremissas(null); setCarregando(false); }
  }, [abrir]);

  const carregarTudo = useCallback(() => {
    setErro(null);
    setCarregando(true);
    recarregarLista().catch((e: unknown) => { setErro(mensagemDe(e, "Não foi possível carregar os cenários.")); setCarregando(false); });
  }, [recarregarLista]);

  useEffect(() => {
    carregarTudo();
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
      setCaixa(cenario.caixa);
      setAvisos(avisosDe(cenario));
      setErroDaPrevia(null);
      return undefined;
    }
    if (!caixaPremissas) return undefined;
    let cancelado = false;
    setCalculando(true);
    const espera = window.setTimeout(() => {
      previaPlanejamentoProjecao({ anoBase, premissas, gastos, servicoPercentual, caixa: caixaValida ? caixaPremissas : undefined })
        .then((r) => { if (!cancelado) { setProjecao(r.projecao); setResultado(r.resultado); setCaixa(caixaValida ? r.caixa : null); setAvisos(avisosDe(r)); setErroDaPrevia(null); } })
        .catch((e: unknown) => { if (!cancelado) setErroDaPrevia(mensagemDe(e, "Não foi possível calcular a projeção.")); })
        .finally(() => { if (!cancelado) setCalculando(false); });
    }, ATRASO_DA_PREVIA_MS);
    return () => { cancelado = true; window.clearTimeout(espera); setCalculando(false); };
  }, [anoBase, premissas, gastos, servicoPercentual, caixaPremissas, caixaValida, cenario, sujo]);

  // O mix que não fecha bloqueia o salvar: a barra leva até a régua (aba Caixa), onde o motivo está escrito.
  function verOMix() {
    setSecao("caixa");
    window.requestAnimationFrame(() => {
      const regua = document.getElementById("plan-regua");
      regua?.scrollIntoView({ block: "start", behavior: "smooth" });
      regua?.focus({ preventScroll: true });
    });
  }

  function preencher(alvo: "premissas" | "gastos") {
    setSecao(alvo);
    const primeiro = projecao ? mesesSemCmv(projecao)[0] : undefined;
    if (alvo === "premissas" && primeiro !== undefined) focarCmvDepoisDeRenderizar(primeiro);
  }

  const confirmarDescarte = (texto: string, acao: string) => confirmar({ titulo: "Descartar as alterações não salvas?", texto, acao, perigo: true });

  async function trocarCenario(id: string) {
    if (id === cenario?.id || salvando) return;
    if (sujoRef.current && !(await confirmarDescarte("O que você mudou neste cenário se perde e o outro cenário abre.", "Descartar e abrir"))) return;
    void abrir(id);
  }

  async function descartar() {
    if (!cenario) return;
    if (sujoRef.current && !(await confirmarDescarte("A tela volta para a versão salva deste cenário. Não dá para desfazer.", "Descartar"))) return;
    void abrir(cenario.id);
  }

  async function novo() {
    if (sujoRef.current && !(await confirmarDescarte("O que você mudou neste cenário se perde antes de criar o novo.", "Descartar e criar"))) return;
    setDialogoNovo(true);
  }

  async function salvar() {
    if (!cenario || !caixaPremissas || !caixaValida) return;
    setSalvando(true);
    setFalha(null);
    try {
      const salvo = await updatePlanejamentoCenario(cenario.id, { nome: cenario.nome, anoBase, premissas, gastos, servicoPercentual, caixa: caixaPremissas, atualizadoEm: cenario.atualizadoEm });
      setCenario(salvo);
      setPremissas(salvo.premissas);
      setGastos(salvo.gastos);
      setServicoPercentual(salvo.servicoPercentual);
      setProjecao(salvo.projecao);
      setResultado(salvo.resultado);
      setCaixaPremissas(salvo.caixaPremissas);
      setCaixa(salvo.caixa);
      setAvisos(avisosDe(salvo));
      setLista((atual) => atual?.map((r) => (r.id === salvo.id ? { ...r, anoBase: salvo.anoBase, atualizadoEm: salvo.atualizadoEm } : r)) ?? atual);
      setErro(null);
      showNotice("success", "Cenário salvo.");
    } catch (e) {
      // Nada do que foi digitado é descartado: a falha fica na barra de salvar até a pessoa decidir.
      const conflito = e instanceof ApiError && e.status === 409;
      // Diante de um conflito o "Desfazer" da última troca em massa perde o sentido e só ocupa a tela.
      if (conflito) setDesfazerTodos(null);
      setFalha({ tipo: conflito ? "conflito" : "erro", mensagem: mensagemDe(e, "Não foi possível salvar o cenário.") });
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!cenario) return;
    const ok = await confirmar({ titulo: `Excluir o cenário "${cenario.nome}"?`, texto: "Premissas, gastos e caixa deste cenário somem. Isso não pode ser desfeito; para guardar uma versão, duplique antes.", acao: "Excluir cenário", perigo: true });
    if (!ok) return;
    try {
      await deletePlanejamentoCenario(cenario.id);
      showNotice("success", "Cenário excluído.");
      await recarregarLista();
    } catch (e) {
      showNotice("error", mensagemDe(e, "Não foi possível excluir o cenário."));
    }
  }

  async function duplicar(sufixo = "cópia") {
    if (!cenario) return;
    try {
      const copia = await createPlanejamentoCenario({ ano: cenario.ano, anoBase, nome: `${cenario.nome} (${sufixo})`.slice(0, 60), premissas, gastos, servicoPercentual, caixa: caixaPremissas ?? undefined });
      showNotice("success", `Cenário "${copia.nome}" criado.`);
      await recarregarLista(copia.id);
    } catch (e) {
      showNotice("error", mensagemDe(e, "Não foi possível duplicar o cenário."));
    }
  }

  // "+ Novo" some com a lista vazia: o estado vazio já tem o "Criar o primeiro cenário".
  const podeNovo = podeCriar && lista !== null && lista.length > 0;
  const acoes = [
    ...(podeNovo ? [{ label: "Novo cenário", icon: <Plus size={15} aria-hidden />, onClick: () => void novo(), disabled: salvando }] : []),
    ...(cenario && podeCriar ? [{ label: "Duplicar", icon: <Copy size={15} aria-hidden />, onClick: () => void duplicar(), disabled: salvando }] : []),
    ...(cenario && podeExcluir ? [{ label: "Excluir", icon: <Trash2 size={15} aria-hidden />, onClick: () => void excluir(), disabled: salvando, tone: "danger" as const }] : [])
  ];

  const opcoes = useMemo(() => (lista ?? []).map((r) => ({ value: r.id, label: `${r.ano} · ${r.nome}` })), [lista]);
  const anosBase = useMemo(() => {
    if (!cenario) return [];
    const anos = new Set([anoBase, ...Array.from({ length: 4 }, (_, i) => cenario.ano - 1 - i).filter((a) => a >= 2020)]);
    return [...anos].filter((a) => a > 0).sort((a, b) => b - a).map((a) => ({ value: String(a), label: String(a) }));
  }, [cenario, anoBase]);

  const faltaCmv = projecao?.meses.some((m) => m.projetado && m.cmvPercentual === null) ?? false;
  const secoes: Aba<Secao>[] = [
    { valor: "resultado", rotulo: "Resultado" },
    { valor: "premissas", rotulo: "Premissas", alerta: faltaCmv ? "falta o CMV de algum mês" : undefined },
    { valor: "gastos", rotulo: "Gastos" },
    { valor: "caixa", rotulo: "Caixa", alerta: caixaValida ? undefined : "o mix não soma 100%" }
  ];

  if (carregando && !cenario && !erro) return <Esqueleto rotulo="Carregando cenários…" />;

  const semBase = projecao !== null && projecao.total.meses.length === 0;

  return (
    <div className="plan plan-cenarios">
      <Notice notice={notice} />
      {erro && (
        <Alert tone="error" role="alert" title="Não deu para carregar">
          {erro}
          <span className="plan-salvar-acoes-alerta">
            <Button variant="secondary" onClick={() => (cenario ? void abrir(cenario.id) : carregarTudo())}><RefreshCw size={16} aria-hidden /> Tentar de novo</Button>
          </span>
        </Alert>
      )}

      <div className="plan-barra-cenario">
        <div className="plan-barra-campos">
          {lista && lista.length > 0 && (
            <Select label="Cenário" disabled={salvando} value={cenario?.id ?? ""} onChange={(e) => void trocarCenario(e.target.value)} options={opcoes} containerClassName="plan-filtro plan-filtro-largo" />
          )}
          {cenario && anosBase.length > 1 && podeEditar && (
            <Select label="Ano-base (real)" disabled={salvando} value={String(anoBase)} onChange={(e) => setAnoBase(Number(e.target.value))} options={anosBase} containerClassName="plan-filtro" />
          )}
          {cenario && !(anosBase.length > 1 && podeEditar) && <p className="plan-dado-fixo"><span>Ano-base</span><strong>{anoBase}</strong></p>}
        </div>
        {acoes.length > 0 && (
          <>
            <div className="plan-barra-acoes plan-acoes-largas">
              {podeNovo && <Button variant="secondary" disabled={salvando} onClick={() => void novo()}><Plus size={16} aria-hidden /> Novo</Button>}
              {cenario && podeCriar && <Button variant="secondary" disabled={salvando} onClick={() => void duplicar()}><Copy size={16} aria-hidden /> Duplicar</Button>}
              {cenario && podeExcluir && <Button variant="secondary" className="plan-botao-perigo" disabled={salvando} onClick={() => void excluir()}><Trash2 size={16} aria-hidden /> Excluir</Button>}
            </div>
            <div className="plan-acoes-menu">
              <RowMenu label="Ações do cenário" items={acoes} />
            </div>
          </>
        )}
      </div>

      {!cenario && !erro && (
        <EmptyState
          className="plan-vazio"
          title="Nenhum cenário ainda."
          description={podeCriar ? "Um cenário projeta o próximo ano a partir de um ano real: comece pelo Base e depois duplique para testar um conservador e um otimista." : "Peça a quem administra o sistema para criar um cenário."}
          action={podeCriar ? <Button onClick={() => setDialogoNovo(true)}><Plus size={16} aria-hidden /> Criar o primeiro cenário</Button> : undefined}
        />
      )}

      {cenario && (
        <div className="plan-conteudo" aria-busy={carregando}>
          <Abas id="plan-secao" rotulo="Partes do cenário" abas={secoes} valor={secao} aoMudar={setSecao} />

          {avisos.length > 0 && (
            <Alert tone="warning" title={avisos.length === 1 ? "Aviso do cálculo" : `${avisos.length} avisos do cálculo`}>
              <ul className="plan-lista-avisos">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
            </Alert>
          )}
          {erroDaPrevia && (
            <Alert tone="error" role="alert" title="A prévia não foi recalculada">
              {erroDaPrevia} Os números abaixo são da última conta que deu certo e ficam esmaecidos até a próxima; suas alterações continuam na tela.
            </Alert>
          )}

          {projecao && !semBase && (
            <Veredito
              ano={cenario.ano}
              anoBase={anoBase}
              nome={cenario.nome}
              projecao={projecao}
              resultado={resultado}
              caixa={caixa}
              calculando={calculando}
              previa={sujo}
              desatualizado={erroDaPrevia !== null}
              compacto={secao !== "resultado"}
              onVerResultado={() => setSecao("resultado")}
              onPreencher={preencher}
            />
          )}
          {semBase && (
            <EmptyState
              className="plan-vazio"
              title={`Nenhum mês de ${anoBase} serve de base.`}
              description={`A projeção parte de meses encerrados e completos de ${anoBase}, com vendas e clientes registrados. Troque o ano-base acima ou, se esse ano veio de planilha, peça a carga do histórico a quem administra o sistema.`}
            />
          )}

          {secao === "resultado" && (
            <PainelDaAba id="plan-secao" valor="resultado" className="plan-secao">
              {projecao && resultado && !semBase && <SecaoResultado projecao={projecao} resultado={resultado} caixa={caixa} ano={cenario.ano} anoBase={anoBase} onPreencher={preencher} />}
            </PainelDaAba>
          )}

          {secao === "premissas" && (
            <PainelDaAba id="plan-secao" valor="premissas" className="plan-secao">
              <CabecalhoDaSecao titulo={`Premissas de ${cenario.ano}`} descricao={`Percentuais sobre o mesmo mês de ${anoBase}: clientes do almoço 10 = 10% a mais que em ${anoBase}. “Todos os meses” preenche os 12 meses ao apertar Enter. O efeito nas vendas de cada mês aparece ao lado e nas barras, enquanto você digita.`} />
              <PremissasEditor premissas={premissas} desabilitado={!podeEditar || salvando} onMudar={setPremissas} projecao={projecao} onAvisoDeDesfazer={setDesfazerTodos} anoBase={anoBase} />
            </PainelDaAba>
          )}

          {secao === "gastos" && (
            <PainelDaAba id="plan-secao" valor="gastos" className="plan-secao">
              <CabecalhoDaSecao titulo={`Gastos de ${cenario.ano}`} descricao="Valor fixo por mês (R$) ou percentual das vendas. A folha é a total, com o serviço dentro: o serviço abate dela no resultado." />
              <GastosEditor anoBase={anoBase} gastos={gastos} servicoPercentual={servicoPercentual} desabilitado={!podeEditar || salvando} onMudarGastos={setGastos} onMudarServico={setServicoPercentual} projecao={projecao} resultado={resultado} realizado={realizadoDoAnoBase} />
            </PainelDaAba>
          )}

          {secao === "caixa" && caixaPremissas && (
            <PainelDaAba id="plan-secao" valor="caixa" className="plan-secao">
              <CabecalhoDaSecao
                titulo="Regime de caixa"
                descricao="Quando o dinheiro entra e sai: forma de pagamento e prazo das vendas, prazo das compras e o que vem do ano anterior. A competência continua sendo a base do cenário."
                controle={podeEditar && !valoresDePartida && <Button variant="secondary" disabled={salvando} onClick={() => setDialogoRealizadoCaixa(true)}><History size={16} aria-hidden /> Preencher com o realizado de {anoBase}</Button>}
              />
              {valoresDePartida && (
                <Alert tone="warning" title="Valores de partida são suposição" className="plan-aviso-partida">
                  O mix de pagamento e os prazos abaixo não vêm do Salão (o real tem muito mais crédito): enquanto não forem preenchidos, a régua e o caixa não valem como previsão.
                  {podeEditar && <Button className="plan-aviso-partida-botao" disabled={salvando} onClick={() => setDialogoRealizadoCaixa(true)}><History size={16} aria-hidden /> Preencher com o realizado de {anoBase}</Button>}
                </Alert>
              )}
              <CaixaEditor caixa={caixaPremissas} gastos={gastos} desabilitado={!podeEditar || salvando} onMudar={(c) => { setCaixaTocada(true); setCaixaPremissas(c); }} valoresDePartida={valoresDePartida} />
            </PainelDaAba>
          )}

          {caixaPremissas && (
            <RealizadoCaixaDialog
              aberto={dialogoRealizadoCaixa}
              anoBase={anoBase}
              anoDoCenario={cenario.ano}
              caixa={caixaPremissas}
              gastos={gastos}
              onFechar={() => setDialogoRealizadoCaixa(false)}
              onAplicar={(proximoCaixa, proximosGastos) => { setCaixaTocada(true); setCaixaPremissas(proximoCaixa); setGastos(proximosGastos); }}
            />
          )}
        </div>
      )}

      <BarraDeSalvar
        sujo={sujo}
        salvando={salvando}
        podeEditar={podeEditar}
        podeCriar={podeCriar}
        caixaValida={caixaValida}
        falha={falha}
        onSalvar={() => void salvar()}
        onDescartar={() => void descartar()}
        onSalvarComoCopia={() => void duplicar("minhas alterações")}
        onVerMix={verOMix}
        aviso={desfazerTodos && {
          texto: desfazerTodos.texto,
          onFechar: fecharDesfazer,
          onDesfazer: () => { setPremissas((atual) => desfazerColuna(atual, desfazerTodos)); setDesfazerTodos(null); }
        }}
      />

      {dialogoDeConfirmacao}
      <NovoCenarioDialog aberto={dialogoNovo} anoSugerido={cenario?.ano ?? anoAtual + 1} onFechar={() => setDialogoNovo(false)} onCriado={async (id) => { setDialogoNovo(false); showNotice("success", "Cenário criado."); await recarregarLista(id); }} />
    </div>
  );
}
