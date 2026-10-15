// RH → Férias: um período aquisitivo por linha, com o prazo para começar as férias e o que
// já foi decidido. O período e o limite vêm calculados da data de registro (o mesmo
// critério do relatório da contabilidade); a tela só grava a programação. O filtro fica no
// endereço (?filtro=…): o link do Dashboard e o botão voltar abrem no lugar certo.
import { Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type ListaFerias, type PedidoFerias, type ProgramacaoFerias, atualizarFerias, cancelarFerias, getFerias, marcarFeriasGozadas, programarFerias } from "../../api/client";
import { Alert, Button, EmptyState } from "../../design-system";
import { FormularioFerias } from "./ferias/FormularioFerias";
import { ImpressaoFerias } from "./ferias/ImpressaoFerias";
import { LinhaPeriodo } from "./ferias/LinhaPeriodo";
import {
  FILTROS, type FiltroFerias, type LinhaFerias, contarPorFiltro, dataBr, linhasDaLista, pertenceAoFiltro, plural, resumoProgramacao,
} from "./ferias/feriasFormato";
import "./ferias/ferias.css";

type Aberto = { chave: string; programacao?: ProgramacaoFerias };
const chaveDe = (l: LinhaFerias) => `${l.pessoa.employeeId}|${l.periodo.aquisitivoInicio}`;
const FILTRO_PADRAO: FiltroFerias = "PENDENTES";
const filtroValido = (v: string | null): FiltroFerias => (FILTROS.find((f) => f.id === v)?.id ?? FILTRO_PADRAO);

export function Ferias() {
  const [params, setParams] = useSearchParams();
  const filtro = filtroValido(params.get("filtro"));
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

  const linhas = useMemo(() => (lista ? linhasDaLista(lista) : []), [lista]);
  const contagem = useMemo(() => contarPorFiltro(linhas), [linhas]);
  const visiveis = linhas.filter((l) => pertenceAoFiltro(l.periodo, filtro));
  const rotuloDoFiltro = FILTROS.find((f) => f.id === filtro)?.rotulo ?? "";

  // O botão que abriu o formulário (ou fez a ação) pode ter sumido da tela: sem ele o foco
  // cairia no <body>. Cai no título da página, que o leitor de tela lê e de onde o teclado segue.
  const devolverFoco = () => setTimeout(() => {
    const alvo = gatilho.current?.isConnected && gatilho.current.getAttribute("aria-disabled") !== "true" ? gatilho.current : titulo.current;
    alvo?.focus();
  }, 0);
  const escolherFiltro = (id: FiltroFerias) => setParams(id === FILTRO_PADRAO ? {} : { filtro: id }, { replace: true });
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

  const vencidas = lista?.resumo.vencidas ?? 0;
  const aVencer = lista?.resumo.aVencer ?? 0;

  return (
    <section className="panel fe-tela" aria-labelledby="fe-titulo">
      <div className="fe-topo">
        <div>
          <h2 id="fe-titulo" ref={titulo} tabIndex={-1}>Períodos de férias</h2>
          <p>Funcionários CLT ativos, dos últimos 12 meses em diante. “Começar até” é o último dia para as férias começarem sem vencer.</p>
        </div>
        <div className="fe-topo-acoes">
          <Button variant="secondary" size="sm" leadingIcon={<Printer size={14} />} aria-disabled={!lista || linhas.length === 0}
            onClick={() => { if (lista && linhas.length > 0) { gatilho.current = document.activeElement as HTMLElement | null; setImprimindo(true); } }}>
            Imprimir
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

      {(vencidas > 0 || aVencer > 0) && (
        <Alert tone={vencidas > 0 ? "error" : "warning"} role={undefined}>
          {vencidas > 0 && <>{vencidas} {plural(vencidas, "período vencido ou programado", "períodos vencidos ou programados")} fora do prazo: férias pagas em dobro. </>}
          {aVencer > 0 && <>{aVencer} {plural(aVencer, "período chega", "períodos chegam")} ao limite em até 90 dias sem datas.</>}
        </Alert>
      )}
      {lista && lista.semDataDeAdmissao.length > 0 && (
        <Alert tone="info" role={undefined}>Sem data de admissão no cadastro (não entram no cálculo): {lista.semDataDeAdmissao.map((p) => p.nome).join(", ")}.</Alert>
      )}

      {lista && linhas.length > 0 && (
        <div className="fe-filtros" role="group" aria-label="Filtrar por situação">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className={`fe-filtro fe-filtro--${f.tom}`} aria-pressed={filtro === f.id} onClick={() => escolherFiltro(f.id)}>
              <strong>{contagem[f.id]}</strong> {f.rotulo}
            </button>
          ))}
        </div>
      )}
      <p className="fe-sr" role="status">{lista && linhas.length > 0 ? `${visiveis.length} ${plural(visiveis.length, "período", "períodos")} em “${rotuloDoFiltro}”.` : ""}</p>

      {carregando && !lista && <p className="fe-ajuda" role="status">Carregando férias…</p>}
      {lista && linhas.length === 0 && (
        <EmptyState title="Nenhum período de férias" description="Nenhum funcionário CLT ativo com data de admissão no cadastro." />
      )}
      {lista && linhas.length > 0 && visiveis.length === 0 && (
        <EmptyState title="Nada neste filtro" description="Troque o filtro acima para ver os outros períodos." />
      )}

      {visiveis.length > 0 && (
        <ul className="fe-lista" role="list" aria-label="Períodos de férias">
          {visiveis.map((l) => {
            const chave = chaveDe(l);
            return (
              <LinhaPeriodo key={chave} linha={l} ocupado={salvando}
                onProgramar={() => abrir({ chave })}
                onJaGozou={() => jaGozou(l)}
                onEditar={(g) => abrir({ chave, programacao: g })}
                onCancelar={(g) => cancelar(l, g)}
                onConfirmar={(g) => void confirmarGozo(l, g)}
                onDesfazer={(g) => desfazer(l, g)}
                formulario={aberto?.chave === chave && (
                  <FormularioFerias key={aberto.programacao?.id ?? "nova"} nome={l.pessoa.nome} periodo={l.periodo} inicial={aberto.programacao}
                    salvando={salvando} erro={erroForm} onSalvar={(pedido) => void salvar(l, pedido, aberto.programacao)} onCancelar={fechar} />
                )} />
            );
          })}
        </ul>
      )}
      {imprimindo && lista && (
        <ImpressaoFerias lista={lista} onClose={() => { setImprimindo(false); devolverFoco(); }} />
      )}
    </section>
  );
}
