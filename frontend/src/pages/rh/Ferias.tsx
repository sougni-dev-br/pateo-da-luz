// RH → Férias: um período aquisitivo por linha, com o prazo para começar as férias e o que
// já foi decidido. O período e o limite vêm calculados da data de registro (o mesmo
// critério do relatório da contabilidade); a tela só grava a programação. O filtro fica no
// endereço (?filtro=…): o link do Dashboard e o botão voltar abrem no lugar certo.
import { CalendarRange, List, Maximize2, Minimize2, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type ListaFerias, type PedidoFerias, type PeriodoFerias, type PessoaFerias, type ProgramacaoFerias, atualizarFerias, cancelarFerias, getFerias, marcarFeriasAvisado, marcarFeriasGozadas, programarFerias, removerSolicitacaoFerias, salvarSolicitacaoFerias } from "../../api/client";
import { Alert, Button, EmptyState } from "../../design-system";
import { FormularioFerias } from "./ferias/FormularioFerias";
import { type DadosDoPedido, PedidoDoColaborador } from "./ferias/PedidoDoColaborador";
import { ImpressaoFerias } from "./ferias/ImpressaoFerias";
import { ImpressaoTela } from "./ferias/ImpressaoTela";
import { LinhaDoTempo } from "./ferias/LinhaDoTempo";
import { LinhaPeriodo } from "./ferias/LinhaPeriodo";
import { PlanejamentoFerias } from "./ferias/PlanejamentoFerias";
import { DecidirHoje } from "./ferias/DecidirHoje";
import { ResumoDoQueFazer } from "./ferias/ResumoDoQueFazer";
import {
  FILTROS, type FiltroFerias, type LinhaFerias, contarPorFiltro, dataBr, linhasDaLista, pertenceAoFiltro, plural, resumoProgramacao, somaDias,
} from "./ferias/feriasFormato";
import { ausenciasDaLista, colegasFora } from "./ferias/eixoDoTempo";
import { resumoDoPedido } from "./ferias/pedido";
import { motivoInicioVedado, proximoInicioValido } from "./ferias/regrasFerias";
import "./ferias/ferias.css";
import "./ferias/linhaDoTempo.css";
import "./ferias/planejamento.css";

type Aberto = { chave: string; programacao?: ProgramacaoFerias; sugestao?: { inicio: string; dias: number; diasAbono?: number; ajustadoDe?: string; motivoDoPedido?: string }; /** Abre o pedido do colaborador em vez da programação. */ pedido?: boolean };
type Visao = "linha" | "lista";
type Previa = { inicio: string; dias: number; /** Desenho do pedido do colaborador (faixa no pé da linha), e não da programação. */ pedido?: boolean };
const chaveDe = (l: LinhaFerias) => `${l.pessoa.employeeId}|${l.periodo.aquisitivoInicio}`;
// Na linha do tempo quem já está todo programado também precisa aparecer (é ele que pesa na cobertura);
// na lista o que interessa é o que falta programar.
const FILTRO_PADRAO: Record<Visao, FiltroFerias> = { linha: "TODAS", lista: "PENDENTES" };
const visaoValida = (v: string | null): Visao => (v === "lista" ? "lista" : "linha");
const filtroValido = (v: string | null, visao: Visao): FiltroFerias => (FILTROS.find((f) => f.id === v)?.id ?? FILTRO_PADRAO[visao]);

export function Ferias() {
  const [params, setParams] = useSearchParams();
  const visao = visaoValida(params.get("visao"));
  const empresa = params.get("empresa") ?? "";
  const filtro = filtroValido(params.get("filtro"), visao);
  const [maisAberto, setMaisAberto] = useState(false);
  const [lista, setLista] = useState<ListaFerias | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const gatilho = useRef<HTMLElement | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const [imprimindoTela, setImprimindoTela] = useState(false);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [cheia, setCheia] = useState(false);
  const atualizarPrevia = useCallback((p: Previa | null) => {
    setPrevia((atual) => (atual?.inicio === p?.inicio && atual?.dias === p?.dias && atual?.pedido === p?.pedido ? atual : p));
  }, []);
  const atualizarPreviaDoPedido = useCallback((p: { inicio: string; dias: number } | null) => atualizarPrevia(p ? { ...p, pedido: true } : null), [atualizarPrevia]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setLista(await getFerias());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar as férias.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  // Tela cheia: o fundo não rola e Esc sai, a não ser que um formulário ou a impressão esteja aberto (eles usam o Esc).
  useEffect(() => {
    if (!cheia) return;
    document.body.classList.add("fe-sem-rolagem");
    return () => document.body.classList.remove("fe-sem-rolagem");
  }, [cheia]);
  useEffect(() => {
    if (!cheia || aberto || imprimindo || imprimindoTela) return;
    const sair = (e: KeyboardEvent) => { if (e.key === "Escape") setCheia(false); };
    window.addEventListener("keydown", sair);
    return () => window.removeEventListener("keydown", sair);
  }, [cheia, aberto, imprimindo, imprimindoTela]);

  const todasAsLinhas = useMemo(() => (lista ? linhasDaLista(lista) : []), [lista]);
  const empresas = useMemo(() => [...new Set(todasAsLinhas.flatMap((l) => (l.pessoa.empresa ? [l.pessoa.empresa] : [])))].sort((a, b) => a.localeCompare(b, "pt-BR")), [todasAsLinhas]);
  // Na linha do tempo as empresas ficam agrupadas; dentro de cada uma, os mais urgentes primeiro.
  const linhas = useMemo(() => {
    const dasEmpresa = empresa ? todasAsLinhas.filter((l) => l.pessoa.empresa === empresa) : todasAsLinhas;
    return visao === "linha" ? [...dasEmpresa].sort((a, b) => (a.pessoa.empresa ?? "").localeCompare(b.pessoa.empresa ?? "", "pt-BR")) : dasEmpresa;
  }, [todasAsLinhas, empresa, visao]);
  const contagem = useMemo(() => contarPorFiltro(linhas), [linhas]);
  const visiveis = linhas.filter((l) => pertenceAoFiltro(l.periodo, filtro));
  const rotuloDoFiltro = FILTROS.find((f) => f.id === filtro)?.rotulo ?? "";

  // O botão que abriu o formulário (ou fez a ação) pode ter sumido da tela: sem ele o foco
  // cairia no <body>. Cai no título da página, que o leitor de tela lê e de onde o teclado segue.
  const devolverFoco = () => setTimeout(() => {
    const alvo = gatilho.current?.isConnected && gatilho.current.getAttribute("aria-disabled") !== "true" ? gatilho.current : titulo.current;
    alvo?.focus();
  }, 0);
  // Endereço enxuto: só vai o que foge do padrão da visão.
  const gravarParams = (v: Visao, f: FiltroFerias, empresaEscolhida = empresa) => {
    const novo: Record<string, string> = {};
    if (v !== "linha") novo.visao = v;
    if (f !== FILTRO_PADRAO[v]) novo.filtro = f;
    if (empresaEscolhida) novo.empresa = empresaEscolhida;
    setParams(novo, { replace: true });
  };
  const escolherFiltro = (id: FiltroFerias) => gravarParams(visao, id);
  const escolherEmpresa = (nome: string) => gravarParams(visao, filtro, nome);
  const escolherVisao = (v: Visao) => gravarParams(v, filtroValido(params.get("filtro"), v));
  const fechar = () => { setAberto(null); setErroForm(null); devolverFoco(); };
  const abrir = (proximo: Aberto) => {
    gatilho.current = document.activeElement as HTMLElement | null;
    setErroForm(null);
    setAviso(null);
    setAberto(proximo);
  };

  // Roda uma gravação e recarrega; a recusa do servidor aparece no lugar certo e o sucesso é dito em voz alta.
  const executar = async (acao: () => Promise<unknown>, noForm: boolean, sucesso: string) => {
    if (!noForm) gatilho.current = document.activeElement as HTMLElement | null;
    setSalvando(true);
    setErroForm(null);
    setErro(null);
    setAviso(null);
    try {
      await acao();
      setAberto(null);
      await carregar();
      setAviso(sucesso);
      devolverFoco();
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : "Não consegui gravar.";
      if (noForm) setErroForm(mensagem); else setErro(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  const salvar = (linha: LinhaFerias, pedido: PedidoFerias, programacao?: ProgramacaoFerias) =>
    executar(() => (programacao
      ? atualizarFerias(programacao.id, { gozoInicio: pedido.gozoInicio, dias: pedido.dias, diasAbono: pedido.diasAbono, observacao: pedido.observacao ?? "" })
      : programarFerias(linha.pessoa.employeeId, pedido)), true,
    `Férias de ${linha.pessoa.nome} ${programacao ? "atualizadas" : "programadas"}: ${dataBr(pedido.gozoInicio)} (${pedido.dias} ${plural(pedido.dias, "dia", "dias")}).`);

  const confirmarGozo = (l: LinhaFerias, g: ProgramacaoFerias) =>
    executar(() => atualizarFerias(g.id, { status: "GOZADA" }), false, `Férias de ${l.pessoa.nome} marcadas como gozadas.`);
  const marcarAvisado = (programacaoId: string, avisado: boolean, nome: string) =>
    executar(() => marcarFeriasAvisado(programacaoId, avisado), false, avisado ? `Aviso de ${nome} registrado.` : `Aviso de ${nome} desfeito.`);
  const jaGozou = (l: LinhaFerias) => {
    if (window.confirm(`Marcar o período ${dataBr(l.periodo.aquisitivoInicio)} a ${dataBr(l.periodo.aquisitivoFim)} de ${l.pessoa.nome} como já gozado? Fica sem datas e dá para desfazer depois.`)) {
      void executar(() => marcarFeriasGozadas(l.pessoa.employeeId, l.periodo.aquisitivoInicio), false, `Período de ${l.pessoa.nome} marcado como já gozado.`);
    }
  };
  const cancelar = (l: LinhaFerias, g: ProgramacaoFerias) => {
    if (window.confirm(`Cancelar as férias de ${l.pessoa.nome} (${resumoProgramacao(g)})?`)) {
      void executar(() => cancelarFerias(g.id), false, `Férias de ${l.pessoa.nome} canceladas. O período voltou para "A programar".`);
    }
  };
  const desfazer = (l: LinhaFerias, g: ProgramacaoFerias) => {
    if (window.confirm(`Desfazer o registro de férias gozadas de ${l.pessoa.nome} (${resumoProgramacao(g)})? O período volta a constar como pendente.`)) {
      void executar(() => cancelarFerias(g.id), false, `Registro desfeito: o período de ${l.pessoa.nome} voltou para "A programar".`);
    }
  };

  const salvarPedido = (l: LinhaFerias, dados: DadosDoPedido) =>
    executar(() => salvarSolicitacaoFerias({ employeeId: l.pessoa.employeeId, aquisitivoInicio: l.periodo.aquisitivoInicio, ...dados }), true,
      `Pedido de ${l.pessoa.nome} registrado: ${dataBr(dados.inicio)} (${dados.dias} ${plural(dados.dias, "dia", "dias")}).`);
  const retirarPedido = (l: LinhaFerias) => {
    const pedido = l.periodo.solicitacao;
    if (pedido && window.confirm(`Retirar o pedido de ${l.pessoa.nome} (${resumoDoPedido(pedido)})? A programação não muda.`)) {
      void executar(() => removerSolicitacaoFerias(pedido.id), true, `Pedido de ${l.pessoa.nome} retirado.`);
    }
  };
  const abrirPedido = (pessoa: PessoaFerias, periodo: PeriodoFerias) => abrir({ chave: `${pessoa.employeeId}|${periodo.aquisitivoInicio}`, pedido: true });

  const ausencias = useMemo(() => (lista ? ausenciasDaLista(lista) : []), [lista]);
  const conflitosDe = (pessoa: PessoaFerias) => (inicio: string, dias: number) =>
    ({ ...colegasFora(ausencias, inicio, somaDias(inicio, dias - 1), pessoa.employeeId, pessoa.setor), setor: pessoa.setor });
  const pessoasVisiveis = useMemo(() => {
    const vistos = new Set<string>();
    return visiveis.flatMap((l) => (vistos.has(l.pessoa.employeeId) ? [] : (vistos.add(l.pessoa.employeeId), [l.pessoa])));
  }, [visiveis]);

  // O resumo olha todas as pessoas da empresa escolhida, não só as do filtro de situação: quem está completando o período não aparece em "A programar".
  const pessoasDoResumo = useMemo(() => (lista ? lista.pessoas.filter((p) => !empresa || (p.empresa ?? "Sem empresa") === empresa) : []), [lista, empresa]);

  const regrasDa = (pessoa: PessoaFerias) => (lista ? { hoje: lista.hoje, feriados: lista.feriados, repousos: pessoa.repousoSemanal, repousoPelaEscala: pessoa.repousoPelaEscala } : undefined);
  const formulario = (l: LinhaFerias, ab: Aberto) => (ab.pedido ? (
    <PedidoDoColaborador key={`pedido-${l.periodo.solicitacao?.id ?? "novo"}`} nome={l.pessoa.nome} periodo={l.periodo} regras={regrasDa(l.pessoa)} conflitos={conflitosDe(l.pessoa)}
      onPrevia={atualizarPreviaDoPedido} salvando={salvando} erro={erroForm} onCancelar={fechar}
      onSalvar={(dados) => void salvarPedido(l, dados)}
      onRetirar={l.periodo.solicitacao ? () => retirarPedido(l) : undefined}
      onAtender={(dados) => abrir({ chave: chaveDe(l), sugestao: { inicio: dados.inicio, dias: dados.dias, diasAbono: dados.diasAbono } })} />
  ) : (
    <FormularioFerias key={`${ab.programacao?.id ?? "nova"}-${ab.sugestao?.inicio ?? ""}`} nome={l.pessoa.nome} periodo={l.periodo} inicial={ab.programacao}
      sugestao={ab.sugestao} regras={lista ? { hoje: lista.hoje, feriados: lista.feriados, repousos: l.pessoa.repousoSemanal, repousoPelaEscala: l.pessoa.repousoPelaEscala } : undefined} conflitos={conflitosDe(l.pessoa)} onPrevia={atualizarPrevia}
      salvando={salvando} erro={erroForm} onSalvar={(pedido) => void salvar(l, pedido, ab.programacao)} onCancelar={fechar} />
  ));
  const formularioDaPessoa = (pessoa: PessoaFerias) => {
    if (!aberto?.chave.startsWith(`${pessoa.employeeId}|`)) return null;
    const periodo = pessoa.periodos.find((p) => `${pessoa.employeeId}|${p.aquisitivoInicio}` === aberto.chave);
    return periodo ? formulario({ pessoa, periodo }, aberto) : null;
  };
  // Quem clica ou arrasta num dia vedado (sábado, domingo, feriado, 2 dias antes) cai no próximo dia permitido, e o formulário avisa.
  const programarPelaLinha = (pessoa: PessoaFerias, periodo: PeriodoFerias, inicio?: string, dias?: number, extra?: { diasAbono?: number; motivoDoPedido?: string }) => {
    const feriados = lista?.feriados ?? {};
    const ajustado = inicio && motivoInicioVedado(inicio, feriados, pessoa.repousoSemanal) ? proximoInicioValido(inicio, feriados, pessoa.repousoSemanal) : inicio;
    abrir({
      chave: `${pessoa.employeeId}|${periodo.aquisitivoInicio}`,
      sugestao: ajustado && dias ? { inicio: ajustado, dias, diasAbono: extra?.diasAbono || undefined, motivoDoPedido: extra?.motivoDoPedido, ajustadoDe: ajustado !== inicio ? inicio : undefined } : undefined,
    });
  };

  // Soltou a barra em outro dia: abre a edição já nessa data (com os avisos de dia vedado, colegas e prazo) para confirmar.
  const moverBarra = (pessoa: PessoaFerias, periodo: PeriodoFerias, g: ProgramacaoFerias, inicio: string) => {
    const feriados = lista?.feriados ?? {};
    const ajustado = motivoInicioVedado(inicio, feriados, pessoa.repousoSemanal) ? proximoInicioValido(inicio, feriados, pessoa.repousoSemanal) : inicio;
    abrir({ chave: `${pessoa.employeeId}|${periodo.aquisitivoInicio}`, programacao: g, sugestao: { inicio: ajustado, dias: g.dias, ajustadoDe: ajustado !== inicio ? inicio : undefined } });
  };

  const vencidas = lista?.resumo.vencidas ?? 0;
  const aVencer = lista?.resumo.aVencer ?? 0;
  // Na tela cheia o espaço é do gráfico: avisos, planejamento e filtros ficam recolhidos atrás desta linha.
  const resumoDoCabecalho = [
    `${contagem.PENDENTES} a programar`,
    `${contagem.PROGRAMADAS} programadas`,
    vencidas > 0 ? `${vencidas} ${plural(vencidas, "fora do prazo", "fora do prazo")}` : null,
    aVencer > 0 ? `${aVencer} ${plural(aVencer, "perto do limite", "perto do limite")}` : null,
    empresa ? empresa : null,
    `exibindo: ${rotuloDoFiltro}`,
  ].filter(Boolean).join(" · ") + " — avisos, planejamento e filtros";

  // Do topo: se o filtro de situação esconde o período, volta para "Todas" para a linha (e o formulário) aparecer.
  const programarDoTopo = (pessoa: PessoaFerias, periodo: PeriodoFerias) => {
    if (!pertenceAoFiltro(periodo, filtro)) gravarParams(visao, "TODAS");
    programarPelaLinha(pessoa, periodo);
  };

  // Avisos, planejamento e filtros: um bloco só, que a tela cheia recolhe atrás da linha-resumo.
  const blocoSuperior = (
    <>
      {lista && pessoasDoResumo.length > 0 && <DecidirHoje pessoas={pessoasDoResumo} hoje={lista.hoje} onProgramar={programarDoTopo} />}
      {lista && lista.semDataDeAdmissao.length > 0 && (
        <Alert tone="info" role={undefined}>Sem data de admissão no cadastro (não entram no cálculo): {lista.semDataDeAdmissao.map((p) => p.nome).join(", ")}.</Alert>
      )}
      <div className="fe-faixa">
        {lista && empresas.length > 1 && (
        <label className="fe-empresa">Empresa
          <select value={empresa} onChange={(e) => escolherEmpresa(e.target.value)}>
            <option value="">Todas</option>
            {empresas.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
          </select>
        </label>
      )}
        <button type="button" className="fe-mais-botao" aria-expanded={maisAberto} aria-controls="fe-mais-corpo" onClick={() => setMaisAberto((v) => !v)}>
          {maisAberto ? "Esconder detalhes" : "Mais detalhes"} <span>planejamento, resumo e situação dos períodos</span>
        </button>
      </div>
      {(
        <div className={`fe-mais${maisAberto ? "" : " fe-mais--fechado"}`} id="fe-mais-corpo">
          <div className="fe-mais-corpo">
      {(vencidas > 0 || aVencer > 0) && (
        <Alert tone={vencidas > 0 ? "error" : "warning"} role={undefined}>
          {vencidas > 0 && <>{vencidas} {plural(vencidas, "período vencido ou programado", "períodos vencidos ou programados")} fora do prazo: férias pagas em dobro. </>}
          {aVencer > 0 && <>{aVencer} {plural(aVencer, "período chega", "períodos chegam")} ao limite em até 90 dias sem datas.</>}
        </Alert>
      )}

      {lista && todasAsLinhas.length > 0 && <PlanejamentoFerias lista={lista} ocupado={salvando} onAvisado={(id, avisado, nome) => void marcarAvisado(id, avisado, nome)} />}

      {lista && pessoasDoResumo.length > 0 && <ResumoDoQueFazer pessoas={pessoasDoResumo} hoje={lista.hoje} classe="fe-resumo" />}

      {lista && linhas.length > 0 && (
        <div className="fe-filtros-bloco">
          <p className="fe-filtros-titulo">Períodos por situação <span>(cada pessoa pode ter mais de um período; clique para filtrar)</span></p>
          <div className="fe-filtros" role="group" aria-label="Filtrar por situação">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" className={`fe-filtro fe-filtro--${f.tom}`} aria-pressed={filtro === f.id} onClick={() => escolherFiltro(f.id)}>
                <strong>{contagem[f.id]}</strong>
                <span className="fe-filtro-texto">{f.rotulo}<small>{f.ajuda}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
        </div>
        </div>
      )}
    </>
  );

  return (
    <section className={`panel fe-tela${cheia ? " fe-tela--cheia" : ""}`} aria-labelledby="fe-titulo">
      <div className="fe-topo">
        <div>
          <h2 id="fe-titulo" ref={titulo} tabIndex={-1}>Períodos de férias</h2>
          <p>Funcionários CLT ativos, dos últimos 12 meses em diante. “Começar até” é o último dia para as férias começarem sem vencer.</p>
        </div>
        <div className="fe-topo-acoes">
          <div className="fe-visao" role="group" aria-label="Forma de ver as férias">
            <button type="button" aria-pressed={visao === "linha"} onClick={() => escolherVisao("linha")}><CalendarRange size={14} aria-hidden="true" /> Linha do tempo</button>
            <button type="button" aria-pressed={visao === "lista"} onClick={() => escolherVisao("lista")}><List size={14} aria-hidden="true" /> Lista</button>
          </div>
          <Button variant="secondary" size="sm" leadingIcon={cheia ? <Minimize2 size={14} /> : <Maximize2 size={14} />} aria-pressed={cheia}
            onClick={() => { setCheia((v) => !v); }}>
            {cheia ? "Sair da tela cheia" : "Tela cheia"}
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Printer size={14} />} aria-disabled={!lista || visiveis.length === 0}
            onClick={() => { if (lista && visiveis.length > 0) { gatilho.current = document.activeElement as HTMLElement | null; setImprimindoTela(true); } }}>
            Imprimir tela
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<Printer size={14} />} aria-disabled={!lista || linhas.length === 0}
            onClick={() => { if (lista && linhas.length > 0) { gatilho.current = document.activeElement as HTMLElement | null; setImprimindo(true); } }}>
            Folhas por empresa
          </Button>
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} aria-disabled={carregando} onClick={() => { if (!carregando) void carregar(); }}>
            {carregando && lista ? "Atualizando…" : "Atualizar"}
          </Button>
        </div>
      </div>

      {erro && <Alert tone="error" role="alert">{erro}</Alert>}

      {/* Única região viva do aviso de sucesso: o Alert de dentro não é uma segunda. */}
      <div role="status" aria-live="polite" className="fe-aviso">
        {aviso && <Alert tone="success" role={undefined}>{aviso}</Alert>}
      </div>

      {cheia ? (
        <details className="fe-cabeca">
          <summary className={vencidas > 0 || aVencer > 0 ? "fe-cabeca--atencao" : undefined}>{resumoDoCabecalho}</summary>
          <div className="fe-cabeca-corpo">{blocoSuperior}</div>
        </details>
      ) : blocoSuperior}
      <p className="fe-sr" role="status">{lista && linhas.length > 0 ? `${visiveis.length} ${plural(visiveis.length, "período", "períodos")} em “${rotuloDoFiltro}”.` : ""}</p>

      {carregando && !lista && <p className="fe-ajuda" role="status">Carregando férias…</p>}
      {lista && linhas.length === 0 && (
        <EmptyState title="Nenhum período de férias" description="Nenhum funcionário CLT ativo com data de admissão no cadastro." />
      )}
      {lista && linhas.length > 0 && visiveis.length === 0 && (
        <EmptyState title="Nada neste filtro" description="Troque o filtro acima para ver os outros períodos." />
      )}

      {visiveis.length > 0 && visao === "linha" && lista && (
        <LinhaDoTempo lista={lista} pessoas={pessoasVisiveis} ocupado={salvando} abertoDe={aberto ? aberto.chave.split("|")[0] : null} previa={previa}
          formularioDe={formularioDaPessoa}
          onProgramar={programarPelaLinha}
          onEditar={(pessoa, periodo, g) => abrir({ chave: `${pessoa.employeeId}|${periodo.aquisitivoInicio}`, programacao: g })}
          onCancelar={cancelar} onConfirmar={(l, g) => void confirmarGozo(l, g)} onDesfazer={desfazer} onMover={moverBarra} onPedido={abrirPedido} />
      )}
      {visiveis.length > 0 && visao === "lista" && (
        <ul className="fe-lista" role="list" aria-label="Períodos de férias">
          {visiveis.map((l) => {
            const chave = chaveDe(l);
            return (
              <LinhaPeriodo key={chave} linha={l} ocupado={salvando} onPedido={() => abrirPedido(l.pessoa, l.periodo)}
                onProgramar={() => abrir({ chave })}
                onJaGozou={() => jaGozou(l)}
                onEditar={(g) => abrir({ chave, programacao: g })}
                onCancelar={(g) => cancelar(l, g)}
                onConfirmar={(g) => void confirmarGozo(l, g)}
                onDesfazer={(g) => desfazer(l, g)}
                formulario={aberto?.chave === chave && formulario(l, aberto)} />
            );
          })}
        </ul>
      )}
      {imprimindoTela && lista && (
        <ImpressaoTela lista={lista} visao={visao} pessoas={pessoasVisiveis} pessoasDoResumo={pessoasDoResumo} linhas={visiveis} filtroRotulo={rotuloDoFiltro} empresaDaTela={empresa} ausencias={ausencias}
          onClose={() => { setImprimindoTela(false); devolverFoco(); }} />
      )}
      {imprimindo && lista && (
        <ImpressaoFerias lista={lista} onClose={() => { setImprimindo(false); devolverFoco(); }} />
      )}
    </section>
  );
}
