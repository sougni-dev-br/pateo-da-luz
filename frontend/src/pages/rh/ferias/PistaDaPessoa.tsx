import { Check, Flag } from "lucide-react";
import { useRef, useState } from "react";
import type { PessoaFerias, PeriodoFerias, ProgramacaoFerias } from "../../../api/client";
import { type Ausencia, type Eixo, type Sugestao, diasEntre, diaDoX, quemEstaFora, retangulo, trechosVedados, zonasDaJanela } from "./eixoDoTempo";
import { dataBr, fimEVolta, plural, somaDias } from "./feriasFormato";
import { ROTULO_DA_SITUACAO_DO_PEDIDO, compararPedido, resumoDoPedido } from "./pedido";
import { type Feriados, motivoInicioVedado } from "./regrasFerias";

const MAX_DIAS = 30;
const MIN_DIAS_GOZO = 5;

/** O que está sendo desenhado por cima da linha: o arrasto, a prévia do formulário, a sugestão ou a barra sendo movida. */
export type Fantasma = { tipo: "arrasto" | "previa" | "sugestao" | "mover" | "pedido"; inicio: string; dias: number; origem?: "pedido" | "calculada"; motivoDoPedido?: string };

type Movendo = { g: ProgramacaoFerias; periodo: PeriodoFerias; /** dias entre o início da barra e o ponto que foi agarrado */ offset: number; inicio: string };

type Props = {
  eixo: Eixo;
  feriados: Feriados;
  pessoa: PessoaFerias;
  /** O período em que um clique programa (o mais antigo com dias a programar); null se não há o que programar. */
  alvo: PeriodoFerias | null;
  /** Ausências dos colegas (sem a própria pessoa). */
  dosOutros: Ausencia[];
  sugestao: Sugestao | null;
  /** Prévia do formulário aberto nesta pessoa, se houver. */
  previa: { inicio: string; dias: number; pedido?: boolean } | null;
  /** Formulário aberto nesta pessoa: some a sugestão para não competir com a prévia. */
  editando: boolean;
  /** Ocupado gravando: nada de começar arrasto novo. */
  ocupado: boolean;
  selecionadaId: string | null;
  onEscolher: (periodo: PeriodoFerias, inicio: string, dias: number, extra?: { diasAbono?: number; motivoDoPedido?: string }) => void;
  onSelecionar: (programacao: ProgramacaoFerias) => void;
  /** Soltou uma barra programada em outro dia. */
  onMover: (periodo: PeriodoFerias, programacao: ProgramacaoFerias, inicio: string) => void;
  /** Clicou na faixa do pedido do colaborador. */
  onPedido: (periodo: PeriodoFerias) => void;
};

const rotuloBarra = (nome: string, g: ProgramacaoFerias) =>
  `${g.status === "GOZADA" ? "Férias gozadas" : "Férias programadas"} de ${nome}: ${dataBr(g.gozoInicio)} a ${dataBr(g.gozoFim)}, ${g.dias} ${plural(g.dias, "dia", "dias")}`;

export function PistaDaPessoa({ eixo, feriados, pessoa, alvo, dosOutros, sugestao, previa, editando, ocupado, selecionadaId, onEscolher, onSelecionar, onMover, onPedido }: Props) {
  const [arrasto, setArrasto] = useState<{ de: string; ate: string } | null>(null);
  const [movendo, setMovendo] = useState<Movendo | null>(null);
  const pista = useRef<HTMLDivElement>(null);
  const arrastouBarra = useRef(false);
  const saldo = alvo ? Math.min(MAX_DIAS, alvo.diasPendentes) : 0;

  const intervaloDoArrasto = (a: { de: string; ate: string }) => {
    const [inicio, fim] = a.de <= a.ate ? [a.de, a.ate] : [a.ate, a.de];
    const dias = a.de === a.ate ? saldo : Math.min(saldo, diasEntre(inicio, fim) + 1);
    return { inicio, dias };
  };

  const fantasma: Fantasma | null = movendo
    ? { tipo: "mover", inicio: movendo.inicio, dias: movendo.g.dias }
    : arrasto ? { tipo: "arrasto", ...intervaloDoArrasto(arrasto) }
      : previa ? { tipo: previa.pedido ? "pedido" : "previa", inicio: previa.inicio, dias: previa.dias }
        : sugestao && !editando ? { tipo: "sugestao", inicio: sugestao.inicio, dias: sugestao.dias, origem: sugestao.origem, motivoDoPedido: sugestao.motivoDoPedido } : null;
  const periodoDoFantasma = movendo ? movendo.periodo : alvo;

  const diaDoPonteiro = (clientX: number) => diaDoX(eixo, clientX - (pista.current?.getBoundingClientRect().left ?? 0));
  const podeArrastar = alvo !== null && saldo > 0 && !ocupado;

  const comecarMover = (e: React.PointerEvent<HTMLButtonElement>, periodo: PeriodoFerias, g: ProgramacaoFerias) => {
    e.stopPropagation(); // a barra não começa um arrasto de datas novo
    if (e.button !== 0 || ocupado || g.status !== "PROGRAMADA" || !g.gozoInicio) return;
    arrastouBarra.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    setMovendo({ g, periodo, offset: diasEntre(g.gozoInicio, diaDoPonteiro(e.clientX)), inicio: g.gozoInicio });
  };
  const andarComBarra = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!movendo) return;
    if (e.buttons === 0 && e.pointerType === "mouse") { setMovendo(null); return; }
    const inicio = somaDias(diaDoPonteiro(e.clientX), -movendo.offset);
    if (inicio === movendo.inicio) return;
    arrastouBarra.current = true;
    setMovendo({ ...movendo, inicio });
  };
  const soltarBarra = () => {
    if (!movendo) return;
    const { periodo, g, inicio } = movendo;
    setMovendo(null);
    if (arrastouBarra.current && g.gozoInicio && inicio !== g.gozoInicio) onMover(periodo, g, inicio);
  };

  return (
    <div
      ref={pista}
      className={`fe-tl-pista${podeArrastar ? " fe-tl-pista--ativa" : ""}`}
      onPointerDown={(e) => {
        if (!podeArrastar || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const d = diaDoPonteiro(e.clientX);
        setArrasto({ de: d, ate: d });
      }}
      onPointerMove={(e) => {
        if (!arrasto) return;
        // Soltou o botão fora da janela: o arrasto acabou, não fica um fantasma preso.
        if (e.buttons === 0 && e.pointerType === "mouse") setArrasto(null);
        else setArrasto({ de: arrasto.de, ate: diaDoPonteiro(e.clientX) });
      }}
      onPointerUp={() => {
        if (!arrasto || !alvo) return;
        const { inicio, dias } = intervaloDoArrasto(arrasto);
        setArrasto(null);
        onEscolher(alvo, inicio, dias);
      }}
      onPointerCancel={() => setArrasto(null)}
      onLostPointerCapture={() => setArrasto(null)}
    >
      {/* No zoom "Ano" os tracinhos viram uma cerca contínua; aparecem nas escalas maiores ou enquanto se escolhe uma data. */}
      {(eixo.pxPorDia >= 4 || fantasma !== null) && <FaixaDeVedados eixo={eixo} feriados={feriados} repousos={pessoa.repousoSemanal} />}
      {pessoa.periodos.map((p) => <JanelaDoPeriodo key={p.aquisitivoInicio} eixo={eixo} periodo={p} />)}
      {pessoa.periodos.flatMap((p) => p.programacoes.map((g) => (
        <BarraDeFerias key={g.id} eixo={eixo} nome={pessoa.nome} programacao={g} foraDoPrazo={p.foraDoPrazo && g.status === "PROGRAMADA" && g.gozoFim !== null && g.gozoFim > p.fimConcessivo}
          selecionada={selecionadaId === g.id} movendo={movendo?.g.id === g.id}
          onSelecionar={() => { if (arrastouBarra.current) { arrastouBarra.current = false; return; } onSelecionar(g); }}
          onPointerDown={(e) => comecarMover(e, p, g)} onPointerMove={andarComBarra} onPointerUp={soltarBarra}
          onLostPointerCapture={() => setMovendo(null)} />
      )))}
      {pessoa.periodos.map((p) => p.solicitacao && (
        <PedidoNaPista key={`pedido-${p.aquisitivoInicio}`} eixo={eixo} nome={pessoa.nome} periodo={p} escondido={fantasma?.tipo === "pedido"} onAbrir={() => onPedido(p)} />
      ))}
      {fantasma && periodoDoFantasma && (
        <FantasmaDeFerias eixo={eixo} feriados={feriados} repousos={pessoa.repousoSemanal} fantasma={fantasma} alvo={periodoDoFantasma}
          colegas={quemEstaFora(dosOutros, fantasma.inicio, somaDias(fantasma.inicio, fantasma.dias - 1)).length}
          onUsar={fantasma.tipo === "sugestao" && alvo ? () => onEscolher(alvo, fantasma.inicio, fantasma.dias, { diasAbono: sugestao?.diasAbono, motivoDoPedido: fantasma.motivoDoPedido }) : undefined} />
      )}
    </div>
  );
}

/** Tracinho no pé da linha nos dias em que, para esta pessoa, as férias não podem começar. */
function FaixaDeVedados({ eixo, feriados, repousos }: { eixo: Eixo; feriados: Feriados; repousos: number[] }) {
  const trechos = trechosVedados(eixo, feriados, repousos);
  return (
    <>
      {trechos.map((t) => (
        <i key={t.de} className="fe-tl-vedado" aria-hidden="true" style={{ left: t.de * eixo.pxPorDia, width: (t.ate - t.de + 1) * eixo.pxPorDia }} />
      ))}
    </>
  );
}

function JanelaDoPeriodo({ eixo, periodo: p }: { eixo: Eixo; periodo: PeriodoFerias }) {
  if (p.situacao === "EM_AQUISICAO") {
    const r = retangulo(eixo, p.aquisitivoInicio, p.aquisitivoFim);
    if (!r) return null;
    return (
      <div className="fe-tl-aquisicao" style={{ left: r.x, width: r.largura }} title={`Ganhando o direito: ${dataBr(p.aquisitivoInicio)} a ${dataBr(p.aquisitivoFim)}`}>
        <span>{p.diasParaCompletar !== null ? `direito em ${p.diasParaCompletar} ${plural(p.diasParaCompletar, "dia", "dias")}` : "ganhando o direito"}</span>
      </div>
    );
  }
  if (p.situacao === "GOZADA") return null;
  const limite = p.diasPendentes > 0 && !p.doHistorico ? retangulo(eixo, p.limiteInicioGozo, p.limiteInicioGozo) : null;
  return (
    <>
      {zonasDaJanela(p).map((z) => {
        const r = retangulo(eixo, z.inicio, z.fim);
        return r && <div key={z.tom} className={`fe-tl-zona fe-tl-zona--${z.tom}`} style={{ left: r.x, width: r.largura }}
          title={TITULO_ZONA[z.tom](p)} />;
      })}
      {limite && (
        <span className="fe-tl-limite" style={{ left: limite.x + limite.largura }} title={`Último dia para começar sem vencer: ${dataBr(p.limiteInicioGozo)}`}>
          <Flag size={12} aria-hidden="true" />
        </span>
      )}
      {limite && (
        <span className="fe-tl-limite-tag" style={{ left: limite.x + limite.largura }} aria-hidden="true">limite {dataBr(p.limiteInicioGozo).slice(0, 5)}</span>
      )}
    </>
  );
}

const TITULO_ZONA: Record<string, (p: PeriodoFerias) => string> = {
  seguro: () => "No prazo, com folga",
  atencao: () => "Atenção: menos de 90 dias para o limite",
  urgente: () => "Urgente: menos de 30 dias para o limite",
  estouro: (p) => `Começar aqui passa do prazo (${dataBr(p.fimConcessivo)}): férias pagas em dobro`,
  neutro: (p) => `Janela para gozar: até ${dataBr(p.fimConcessivo)}`,
};

type BarraProps = {
  eixo: Eixo; nome: string; programacao: ProgramacaoFerias; foraDoPrazo: boolean; selecionada: boolean; movendo: boolean;
  onSelecionar: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onLostPointerCapture: () => void;
};

function BarraDeFerias({ eixo, nome, programacao: g, foraDoPrazo, selecionada, movendo, onSelecionar, onPointerDown, onPointerMove, onPointerUp, onLostPointerCapture }: BarraProps) {
  if (!g.gozoInicio || !g.gozoFim) return null;
  const r = retangulo(eixo, g.gozoInicio, g.gozoFim);
  if (!r) return null;
  const gozada = g.status === "GOZADA";
  return (
    <button type="button" aria-pressed={selecionada} aria-label={`${rotuloBarra(nome, g)}. Abrir opções`}
      title={`${rotuloBarra(nome, g)}${gozada ? "" : ". Arraste para mudar a data"}`}
      className={`fe-tl-barra fe-tl-barra--${gozada ? "gozada" : "programada"}${foraDoPrazo ? " fe-tl-barra--risco" : ""}${movendo ? " fe-tl-barra--movendo" : ""}`}
      style={{ left: r.x, width: Math.max(r.largura, 8) }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onLostPointerCapture={onLostPointerCapture} onClick={onSelecionar}>
      {gozada && <Check size={12} aria-hidden="true" />}
      {r.largura >= 44 && <span>{g.dias}d</span>}
    </button>
  );
}

type FantasmaProps = {
  eixo: Eixo; feriados: Feriados; repousos: number[]; fantasma: Fantasma; alvo: PeriodoFerias; colegas: number; onUsar?: () => void;
};

function FantasmaDeFerias({ eixo, feriados, repousos, fantasma, alvo, colegas, onUsar }: FantasmaProps) {
  const datas = fimEVolta(fantasma.inicio, fantasma.dias);
  if (!datas) return null;
  const r = retangulo(eixo, fantasma.inicio, datas.fim);
  if (!r) return null;
  const passaDoPrazo = datas.fim > alvo.fimConcessivo;
  const curto = fantasma.tipo !== "mover" && fantasma.tipo !== "pedido" && fantasma.dias < MIN_DIAS_GOZO && fantasma.dias < alvo.diasPendentes;
  const rotulo = fantasma.tipo === "sugestao" ? (fantasma.origem === "pedido" ? "Pedido" : fantasma.motivoDoPedido ? "Alternativa" : "Sugestão") : fantasma.tipo === "pedido" ? `Pedido · ${fantasma.dias}d` : `${fantasma.dias} ${plural(fantasma.dias, "dia", "dias")}`;
  const comData = r.largura >= 190;
  const largo = r.largura >= 84;
  const vedado = fantasma.tipo === "sugestao" ? null : motivoInicioVedado(fantasma.inicio, feriados, repousos);
  const aviso = [
    vedado && `não pode começar aqui: ${vedado}`,
    passaDoPrazo && "termina depois do prazo: pagas em dobro",
    curto && `cada parte tem no mínimo ${MIN_DIAS_GOZO} dias`,
    colegas > 0 && `${colegas} ${plural(colegas, "colega fora", "colegas fora")} nesse período`,
  ].filter(Boolean).join(" · ");
  const classe = `fe-tl-fantasma fe-tl-fantasma--${fantasma.tipo}${passaDoPrazo || curto || vedado ? " fe-tl-fantasma--risco" : ""}`;
  const titulo = `${rotulo}: ${dataBr(fantasma.inicio)} a ${dataBr(datas.fim)}${fantasma.origem === "pedido" ? " — é o que o colaborador pediu e serve" : ""}${fantasma.motivoDoPedido ? ` — o pedido não serve: ${fantasma.motivoDoPedido}` : ""}${aviso ? ` — ${aviso}` : ""}`;
  const conteudo = (
    <>
      {largo && <span>{comData ? `${rotulo} · ${dataBr(fantasma.inicio)}` : rotulo}</span>}
      {colegas > 0 && <em aria-hidden="true">{colegas}</em>}
    </>
  );
  // A sugestão é clicável (o teclado usa o botão "Programar" da coluna do nome, que leva às mesmas datas).
  return onUsar
    ? <button type="button" tabIndex={-1} className={classe} style={{ left: r.x, width: r.largura }} title={`${titulo}. Clique para usar`}
      onPointerDown={(e) => e.stopPropagation()} onClick={onUsar}>{conteudo}</button>
    : <div className={classe} style={{ left: r.x, width: r.largura }} title={titulo}>{conteudo}</div>;
}

/** O que o colaborador pediu: uma faixa tracejada no pé da linha, ao lado da programação (a barra azul). */
function PedidoNaPista({ eixo, nome, periodo, escondido, onAbrir }: { eixo: Eixo; nome: string; periodo: PeriodoFerias; escondido: boolean; onAbrir: () => void }) {
  const pedido = periodo.solicitacao;
  if (!pedido || escondido) return null;
  const r = retangulo(eixo, pedido.inicio, pedido.fim);
  if (!r) return null;
  const comparacao = compararPedido(periodo);
  const texto = `Pedido de ${nome}: ${resumoDoPedido(pedido)}${comparacao ? ` — ${ROTULO_DA_SITUACAO_DO_PEDIDO[comparacao.situacao].toLowerCase()}` : ""}`;
  return (
    <button type="button" className={`fe-tl-pedido fe-tl-pedido--${(comparacao?.situacao ?? "AGUARDANDO").toLowerCase()}`} style={{ left: r.x, width: Math.max(r.largura, 8) }}
      aria-label={`${texto}. Abrir o pedido`} title={texto} onPointerDown={(e) => e.stopPropagation()} onClick={onAbrir}>
      {r.largura >= 74 && <span>Pediu {dataBr(pedido.inicio).slice(0, 5)}–{dataBr(pedido.fim).slice(0, 5)}</span>}
    </button>
  );
}
