import { CalendarPlus, Check, MessageSquareText, Pencil, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ListaFerias, PeriodoFerias, PessoaFerias, ProgramacaoFerias } from "../../../api/client";
import { Button } from "../../../design-system";
import { PistaDaPessoa } from "./PistaDaPessoa";
import { type LinhaFerias, dataBr, plural, resumoProgramacao, textoPrazo } from "./feriasFormato";
import { ROTULO_DA_SITUACAO_DO_PEDIDO, compararPedido, diferencaEmPalavras, resumoDoPedido } from "./pedido";
import {
  type Ausencia, DIAS_NO_MES, type Eixo, ZOOMS, ausenciasDaLista, coberturaPorDia, criarEixo, diaDoX, mesesDoEixo, periodoAlvo,
  pxPorDiaDaEscala, quemEstaFora, rotulosDosMeses, setoresDaLista, sugerirInicio, trechosDeCobertura, xDoDia,
} from "./eixoDoTempo";

const MAX_DIAS = 30;
const AJUDA = "Arraste sobre a linha de uma pessoa para escolher os dias, ou clique na faixa tracejada (menos colegas fora). Arraste uma barra azul para mudar a data. Esc sai da tela cheia.";
/** Largura da coluna do nome (a mesma de --nome no CSS, na tela larga). */
const NOME_PX = 208;

export type AcoesDaLinha = {
  onProgramar: (pessoa: PessoaFerias, periodo: PeriodoFerias, inicio?: string, dias?: number) => void;
  onEditar: (pessoa: PessoaFerias, periodo: PeriodoFerias, g: ProgramacaoFerias) => void;
  onCancelar: (l: LinhaFerias, g: ProgramacaoFerias) => void;
  onConfirmar: (l: LinhaFerias, g: ProgramacaoFerias) => void;
  onDesfazer: (l: LinhaFerias, g: ProgramacaoFerias) => void;
  /** Soltou uma barra programada em outro dia: abre o formulário já nessa data para confirmar. */
  onMover: (pessoa: PessoaFerias, periodo: PeriodoFerias, g: ProgramacaoFerias, inicio: string) => void;
  /** Abre o pedido do colaborador (registrar ou ver) para o período. */
  onPedido: (pessoa: PessoaFerias, periodo: PeriodoFerias) => void;
};

type Props = AcoesDaLinha & {
  lista: ListaFerias;
  /** Pessoas que passam pelo filtro, na ordem de urgência. */
  pessoas: PessoaFerias[];
  ocupado: boolean;
  /** Pessoa com o formulário aberto e a prévia do que está digitado nele. */
  abertoDe: string | null;
  previa: { inicio: string; dias: number } | null;
  /** Renderiza o formulário (ou nada) logo abaixo da linha da pessoa. */
  formularioDe: (pessoa: PessoaFerias) => ReactNode;
};

export function LinhaDoTempo({ lista, pessoas, ocupado, abertoDe, previa, formularioDe, ...acoes }: Props) {
  const [zoomId, setZoomId] = useState<(typeof ZOOMS)[number]["id"]>("ano");
  const zoom = ZOOMS.find((z) => z.id === zoomId) ?? ZOOMS[0];
  const [selecionada, setSelecionada] = useState<{ employeeId: string; id: string } | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  // Largura da área rolável e da coluna do nome: a escala escolhida divide o que sobra em meses iguais.
  const [medidas, setMedidas] = useState({ visivel: 900, nome: NOME_PX, medido: false });
  const visivel = medidas.visivel;
  const [setor, setSetor] = useState("");

  const pxPorDia = pxPorDiaDaEscala(zoom, medidas.visivel - medidas.nome - 2);
  const eixo = useMemo(() => criarEixo(lista.hoje, lista.pessoas, pxPorDia), [lista, pxPorDia]);
  const ausencias = useMemo(() => ausenciasDaLista(lista), [lista]);
  const setores = useMemo(() => setoresDaLista(lista), [lista]);
  // A faixa de cobertura pode olhar um setor só; a sugestão e os avisos sempre pesam o setor da própria pessoa.
  const daFaixa = useMemo(() => (setor ? ausencias.filter((a) => a.setor === setor) : ausencias), [ausencias, setor]);
  const cobertura = useMemo(() => coberturaPorDia(eixo, daFaixa), [eixo, daFaixa]);
  const feriadosVisiveis = useMemo(() => Object.entries(lista.feriados).filter(([dia]) => dia >= eixo.inicio && xDoDia(eixo, dia) < eixo.largura), [lista.feriados, eixo]);
  const grupos = useMemo(() => new Set(pessoas.map((p) => p.empresa ?? "Sem empresa")).size > 1, [pessoas]);
  const meses = useMemo(() => mesesDoEixo(eixo), [eixo]);
  const rotulos = useMemo(() => rotulosDosMeses(meses), [meses]);

  // A escala abre no começo do mês de hoje (Trimestre = este mês e os dois seguintes); "hoje" fica marcado.
  const irParaHoje = useCallback((suave: boolean) => {
    const el = rolagem.current;
    if (!el) return;
    const left = Math.max(0, xDoDia(eixo, `${lista.hoje.slice(0, 8)}01`));
    if (typeof el.scrollTo === "function") el.scrollTo({ left, behavior: suave ? "smooth" : "auto" });
    else el.scrollLeft = left;
  }, [eixo, lista.hoje]);
  const andarMeses = (sentido: 1 | -1) => {
    const el = rolagem.current;
    const left = sentido * DIAS_NO_MES * eixo.pxPorDia;
    if (el && typeof el.scrollBy === "function") el.scrollBy({ left, behavior: "smooth" });
    else if (el) el.scrollLeft += left;
  };
  // Só ao montar, depois da primeira medida e ao trocar a escala: recarregar a lista (programar, cancelar) não pode tirar o gestor de onde estava.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `irParaHoje` muda a cada recarga; o que importa é o dia de hoje e a escala
  useLayoutEffect(() => { irParaHoje(false); }, [lista.hoje, zoom.id, medidas.medido]);

  useEffect(() => {
    const el = rolagem.current;
    if (!el) return;
    const medir = () => setMedidas((antes) => {
      const nome = el.querySelector(".fe-tl-canto")?.getBoundingClientRect().width || NOME_PX;
      return antes.medido && antes.visivel === el.clientWidth && antes.nome === nome ? antes : { visivel: el.clientWidth, nome, medido: true };
    });
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const estilo = { "--larg": `${eixo.largura}px`, "--visivel": `${visivel}px` } as React.CSSProperties;
  const xHoje = xDoDia(eixo, lista.hoje) + eixo.pxPorDia / 2;

  return (
    <div className="fe-tl-conjunto">
      <div className="fe-tl-barra-ferramentas">
        <Legenda />
        <div className="fe-tl-controles">
          <div className="fe-tl-zoom" role="group" aria-label="Escala da linha do tempo">
            {ZOOMS.map((z) => (
              <button key={z.id} type="button" aria-pressed={zoom.id === z.id} title={`${z.meses} meses na tela`} onClick={() => setZoomId(z.id)}>{z.rotulo}</button>
            ))}
          </div>
          <div className="fe-tl-zoom" role="group" aria-label="Andar pelos meses">
            <button type="button" aria-label="Mês anterior" title="Mês anterior" onClick={() => andarMeses(-1)}>‹</button>
            <button type="button" aria-label="Próximo mês" title="Próximo mês" onClick={() => andarMeses(1)}>›</button>
          </div>
          {setores.length > 1 && (
            <label className="fe-tl-setor">Cobertura de
              <select value={setor} onChange={(e) => setSetor(e.target.value)}>
                <option value="">toda a casa</option>
                {setores.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="fe-tl-ajuda" aria-label={AJUDA} title={AJUDA}>?</button>
          <Button size="sm" variant="secondary" onClick={() => irParaHoje(true)}>Ir para hoje</Button>
        </div>
      </div>
      <p className="fe-tl-dica">
        <Sparkles size={13} aria-hidden="true" />
        <span className="fe-tl-dica-mouse">Arraste sobre a linha de uma pessoa para escolher os dias, ou clique na faixa tracejada (menos colegas fora). Arraste uma barra azul para mudar a data.</span>
        <span className="fe-tl-dica-toque">Toque na linha de uma pessoa para escolher o início, ou na faixa tracejada (menos colegas fora). Toque numa barra para ver as opções e mudar a data.</span>
      </p>

      <div className="fe-tl" ref={rolagem} style={estilo}>
        <div className="fe-tl-quadro">
          <div className="fe-tl-cab">
            <div className="fe-tl-canto" />
            <div className="fe-tl-meses" aria-hidden="true">
              {meses.map((m, i) => (
                <div key={m.iso} className={`fe-tl-mes${m.viraAno ? " fe-tl-mes--ano" : ""}`} style={{ left: m.x, width: m.largura }}>
                  {m.largura >= 26 && <span>{rotulos[i].nome}{rotulos[i].ano && <b>{rotulos[i].ano}</b>}</span>}
                </div>
              ))}
              {feriadosVisiveis.map(([dia, nome]) => (
                <i key={dia} className="fe-tl-feriado" style={{ left: xDoDia(eixo, dia) + eixo.pxPorDia / 2 }} title={`${dataBr(dia)} · ${nome}: as férias não podem começar nesse dia nem nos 2 dias antes`} />
              ))}
              <span className="fe-tl-hoje-rotulo" style={{ left: xHoje }}>hoje</span>
            </div>
          </div>

          <FaixaDeCobertura eixo={eixo} cobertura={cobertura} ausencias={daFaixa} setor={setor} />

          <div className="fe-tl-corpo">
            <div className="fe-tl-grade" aria-hidden="true">
              {meses.map((m) => <i key={m.iso} className={m.viraAno ? "fe-tl-grade--ano" : undefined} style={{ left: m.x }} />)}
              <i className="fe-tl-hoje" style={{ left: xHoje }} />
            </div>
            <ul className="fe-tl-lista" role="list" aria-label="Férias por pessoa">
              {pessoas.map((pessoa, i) => (
                <Fragment key={pessoa.employeeId}>
                  {grupos && (i === 0 || (pessoas[i - 1].empresa ?? "Sem empresa") !== (pessoa.empresa ?? "Sem empresa")) && (
                    <li className="fe-tl-grupo"><span>{pessoa.empresa ?? "Sem empresa"}</span></li>
                  )}
                  <LinhaDaPessoa eixo={eixo} lista={lista} pessoa={pessoa} ausencias={ausencias} ocupado={ocupado}
                    aberto={abertoDe === pessoa.employeeId} previa={abertoDe === pessoa.employeeId ? previa : null}
                    selecionadaId={selecionada?.employeeId === pessoa.employeeId ? selecionada.id : null}
                    onSelecionar={(g) => setSelecionada((atual) => (atual?.id === g.id ? null : { employeeId: pessoa.employeeId, id: g.id }))}
                    fechar={() => setSelecionada(null)} formulario={formularioDe(pessoa)} {...acoes} />
                </Fragment>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinhaDaPessoa({ eixo, lista, pessoa, ausencias, ocupado, aberto, previa, selecionadaId, onSelecionar, fechar, formulario, ...acoes }: AcoesDaLinha & {
  eixo: Eixo; lista: ListaFerias; pessoa: PessoaFerias; ausencias: Ausencia[]; ocupado: boolean; aberto: boolean;
  previa: { inicio: string; dias: number } | null; selecionadaId: string | null;
  onSelecionar: (g: ProgramacaoFerias) => void; fechar: () => void; formulario: ReactNode;
}) {
  const alvo = useMemo(() => periodoAlvo(pessoa), [pessoa]);
  const dosOutros = useMemo(() => ausencias.filter((a) => a.employeeId !== pessoa.employeeId), [ausencias, pessoa.employeeId]);
  const saldo = alvo ? Math.min(MAX_DIAS, alvo.diasPendentes) : 0;
  const proprias = useMemo(() => ausencias.filter((a) => a.employeeId === pessoa.employeeId), [ausencias, pessoa.employeeId]);
  const sugestao = useMemo(
    () => (alvo && saldo > 0 ? sugerirInicio(eixo, alvo, lista.hoje, saldo, { feriados: lista.feriados, repousos: pessoa.repousoSemanal, setor: pessoa.setor, dosOutros, proprias }) : null),
    [alvo, dosOutros, proprias, eixo, lista.hoje, lista.feriados, pessoa.repousoSemanal, pessoa.setor, saldo]);

  const pior = pessoa.periodos.reduce<PeriodoFerias | null>((p, atual) => (atual.nivel !== "ok" && (!p || atual.nivel === "perigo") ? atual : p), null);
  const prazo = pior ?? alvo;
  const escolhida = selecionadaId ? pessoa.periodos.flatMap((p) => p.programacoes.map((g) => ({ p, g }))).find((x) => x.g.id === selecionadaId) : undefined;
  const linha = (periodo: PeriodoFerias): LinhaFerias => ({ pessoa, periodo });
  const guarda = (f: () => void) => () => { if (!ocupado) f(); };
  // O período que tem pedido (a ficha de três linhas) ou, sem pedido, o que dá para pedir: o mais antigo já maduro.
  const periodoComPedido = pessoa.periodos.find((p) => p.solicitacao) ?? null;
  const pedidoPeriodo = periodoComPedido ?? pessoa.periodos.find((p) => p.situacao !== "EM_AQUISICAO" && p.situacao !== "GOZADA" && !p.doHistorico) ?? null;
  const ficha = periodoComPedido ? { periodo: periodoComPedido, comparacao: compararPedido(periodoComPedido) as NonNullable<ReturnType<typeof compararPedido>> } : null;

  return (
    <li className={`fe-tl-linha fe-tl-linha--${pessoa.nivel}`}>
      <div className="fe-tl-nome">
        <h3>{pessoa.nome}</h3>
        {(pessoa.setor || pessoa.empresa) && <span className="fe-sub" title={[pessoa.setor, pessoa.empresa].filter(Boolean).join(" · ")}>{pessoa.setor ?? pessoa.empresa}</span>}
        {prazo && prazo.situacao !== "EM_AQUISICAO" && prazo.diasPendentes > 0 && <span className={`fe-tl-prazo fe-tl-prazo--${prazo.nivel}`}>{textoPrazo(prazo)}</span>}
        {ficha && (
          <ul className="fe-tl-ficha" aria-label={`Pedido, empresa e prazo de ${pessoa.nome}`}>
            <li className="fe-tl-ficha--pedido"><b>Pediu</b> {resumoDoPedido(ficha.periodo.solicitacao as NonNullable<PeriodoFerias["solicitacao"]>)}</li>
            <li className="fe-tl-ficha--empresa"><b>Empresa quer</b> {ficha.comparacao.programacao ? resumoProgramacao(ficha.comparacao.programacao) : "ainda sem data"}</li>
            <li className="fe-tl-ficha--limite"><b>Limite</b> começar até {dataBr(ficha.periodo.limiteInicioGozo)}</li>
            <li><span className={`fe-tl-situacao fe-tl-situacao--${ficha.comparacao.situacao.toLowerCase()}`}>{ROTULO_DA_SITUACAO_DO_PEDIDO[ficha.comparacao.situacao]}</span>
              {ficha.comparacao.situacao === "DIFERENTE" && diferencaEmPalavras(ficha.comparacao.diferencaEmDias) ? <span className="fe-sub"> · {diferencaEmPalavras(ficha.comparacao.diferencaEmDias)}</span> : null}
              {ficha.comparacao.passaDoPrazo && <span className="fe-tl-situacao fe-tl-situacao--prazo">pedido passa do prazo</span>}
            </li>
          </ul>
        )}
        {pedidoPeriodo && !aberto && (
          <button type="button" className="fe-tl-programar fe-tl-programar--pedido" aria-disabled={ocupado}
            aria-label={`${pedidoPeriodo.solicitacao ? "Pedido" : "Registrar pedido"} de férias de ${pessoa.nome}`}
            onClick={guarda(() => acoes.onPedido(pessoa, pedidoPeriodo))}>
            <MessageSquareText size={13} aria-hidden="true" /> {pedidoPeriodo.solicitacao ? "Pedido" : "Registrar pedido"}
          </button>
        )}
        {alvo && !aberto && (
          <button type="button" className="fe-tl-programar" aria-disabled={ocupado} aria-label={`Programar férias de ${pessoa.nome}`}
            onClick={guarda(() => acoes.onProgramar(pessoa, alvo, sugestao?.inicio, sugestao?.dias))}>
            <CalendarPlus size={13} aria-hidden="true" /> Programar
          </button>
        )}
      </div>
      <PistaDaPessoa eixo={eixo} feriados={lista.feriados} pessoa={pessoa} alvo={alvo} dosOutros={dosOutros} sugestao={sugestao} previa={previa} editando={aberto}
        selecionadaId={selecionadaId} onSelecionar={onSelecionar} ocupado={ocupado} onPedido={(periodo) => acoes.onPedido(pessoa, periodo)}
        onMover={(periodo, g, inicio) => acoes.onMover(pessoa, periodo, g, inicio)}
        onEscolher={(periodo, inicio, dias) => { if (!ocupado) acoes.onProgramar(pessoa, periodo, inicio, dias); }} />
      {(formulario || escolhida) && (
        <div className="fe-tl-extra">
          {formulario}
          {!formulario && escolhida && (
            <div className="fe-tl-detalhe">
              <p>
                <strong>{escolhida.g.status === "GOZADA" ? "Gozou" : "Programada"}:</strong> {resumoProgramacao(escolhida.g)}
                {escolhida.g.status === "PROGRAMADA" && (() => {
                  const fora = quemEstaFora(ausencias, escolhida.g.gozoInicio ?? "", escolhida.g.gozoFim ?? "", pessoa.employeeId);
                  return fora.length > 0 ? <span className="fe-sub"> · junto com {fora.join(", ")}</span> : null;
                })()}
              </p>
              <span className="fe-botoes">
                {escolhida.g.status === "PROGRAMADA" && escolhida.g.passouDaData && (
                  <Button size="sm" variant="secondary" leadingIcon={<Check size={14} />} aria-disabled={ocupado}
                    aria-label={`Confirmar que gozou, férias de ${pessoa.nome} (${resumoProgramacao(escolhida.g)})`}
                    onClick={guarda(() => { acoes.onConfirmar(linha(escolhida.p), escolhida.g); fechar(); })}>Confirmar que gozou</Button>
                )}
                {escolhida.g.status === "PROGRAMADA" && (
                  <>
                    <Button size="sm" variant="secondary" leadingIcon={<Pencil size={14} />} aria-disabled={ocupado}
                      aria-label={`Editar férias de ${pessoa.nome} (${resumoProgramacao(escolhida.g)})`}
                      onClick={guarda(() => { acoes.onEditar(pessoa, escolhida.p, escolhida.g); fechar(); })}>Editar</Button>
                    <Button size="sm" variant="secondary" leadingIcon={<Trash2 size={14} />} aria-disabled={ocupado}
                      aria-label={`Cancelar programação de ${pessoa.nome} (${resumoProgramacao(escolhida.g)})`}
                      onClick={guarda(() => { acoes.onCancelar(linha(escolhida.p), escolhida.g); fechar(); })}>Cancelar férias</Button>
                  </>
                )}
                {escolhida.g.status === "GOZADA" && (
                  <Button size="sm" variant="secondary" leadingIcon={<Undo2 size={14} />} aria-disabled={ocupado}
                    aria-label={`Desfazer férias gozadas de ${pessoa.nome} (${resumoProgramacao(escolhida.g)})`}
                    onClick={guarda(() => { acoes.onDesfazer(linha(escolhida.p), escolhida.g); fechar(); })}>Desfazer</Button>
                )}
                <Button size="sm" variant="icon" aria-label="Fechar opções" onClick={fechar}>×</Button>
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Quantas pessoas estão fora a cada dia: quanto mais escuro, mais difícil de cobrir a casa. */
function FaixaDeCobertura({ eixo, cobertura, ausencias, setor }: { eixo: Eixo; cobertura: number[]; ausencias: Ausencia[]; setor: string }) {
  const [dica, setDica] = useState<{ x: number; dia: string } | null>(null);
  const trechos = useMemo(() => trechosDeCobertura(cobertura), [cobertura]);
  const pico = cobertura.reduce((m, n) => Math.max(m, n), 0);
  const nomes = dica ? quemEstaFora(ausencias, dica.dia, dica.dia) : [];
  return (
    <div className="fe-tl-cob">
      <div className="fe-tl-canto fe-tl-canto--cob">
        <strong>Quem está fora</strong>
        <span className="fe-sub">{pico === 0 ? "ninguém programado" : `até ${pico} ao mesmo tempo`}{setor ? ` · ${setor}` : ""}</span>
      </div>
      <div className="fe-tl-faixa" onPointerMove={(e) => {
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        setDica({ x, dia: diaDoX(eixo, x) });
      }} onPointerLeave={() => setDica(null)}>
        {trechos.map((t) => (
          <i key={t.de} className={`fe-tl-calor fe-tl-calor--${Math.min(t.quantos, 4)}`}
            style={{ left: t.de * eixo.pxPorDia, width: (t.ate - t.de + 1) * eixo.pxPorDia }}>
            {(t.ate - t.de + 1) * eixo.pxPorDia >= 16 && t.quantos}
          </i>
        ))}
        {dica && (
          <div className="fe-tl-dica-dia" style={{ left: Math.min(dica.x + 12, eixo.largura - 190) }}>
            <strong>{dataBr(dica.dia)}</strong>
            <span>{nomes.length === 0 ? "Ninguém fora" : `${nomes.length} ${plural(nomes.length, "pessoa fora", "pessoas fora")}`}</span>
            {nomes.slice(0, 5).map((n) => <em key={n}>{n}</em>)}
            {nomes.length > 5 && <em>+{nomes.length - 5}</em>}
          </div>
        )}
      </div>
    </div>
  );
}

function Legenda() {
  const itens: Array<[string, string]> = [
    ["seguro", "No prazo"], ["atencao", "Menos de 90 dias"], ["urgente", "Menos de 30 dias"], ["estouro", "Passou do prazo"],
    ["programada", "Programada (a empresa quer)"], ["pedido", "Pedido do colaborador"], ["limite", "Prazo limite"], ["gozada", "Gozada"], ["sugestao", "Sugestão"], ["vedado", "Não pode começar"],
  ];
  return (
    <ul className="fe-tl-legenda" aria-label="Legenda das cores">
      {itens.map(([tom, rotulo]) => <li key={tom}><i className={`fe-tl-amostra fe-tl-amostra--${tom}`} aria-hidden="true" />{rotulo}</li>)}
    </ul>
  );
}

