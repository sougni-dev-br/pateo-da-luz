import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, MessageSquareText } from "lucide-react";
import { getEventsAgenda, type AgendaDay, type EventSettings, type EventSize } from "../../../api/client";
import { Alert, Button, EmptyState, Switch } from "../../../design-system";
import { DiaDialog } from "./DiaDialog";
import { NovaEdicaoDialog } from "./NovaEdicaoDialog";
import { MESES, MODALIDADE, TAMANHO, centavos, diaDaSemana, diaDoEvento, ehFimDeSemana, hojeIso, reais } from "./formato";

type Props = {
  podeEditar: boolean;
  podeCriar: boolean;
  onAbrirEvento: (seriesId: string) => void;
};

function tamanhoReal(almocos: number, limites: EventSettings): EventSize {
  if (almocos <= limites.smallMaxLunch) return "PEQUENO";
  return almocos > limites.largeMinLunch ? "GRANDE" : "MEDIO";
}

export function TamanhoPill({ tamanho, apagado = false }: { tamanho: EventSize; apagado?: boolean }) {
  return (
    <span className={`evt-tam evt-tam-${TAMANHO[tamanho].curto}${apagado ? " evt-tam-apagado" : ""}`} title={`Buffet ${TAMANHO[tamanho].nome}`}>
      {TAMANHO[tamanho].curto}
    </span>
  );
}

export function Agenda({ podeEditar, podeCriar, onAbrirEvento }: Props) {
  const hoje = hojeIso();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)));
  const [dias, setDias] = useState<AgendaDay[]>([]);
  const [limites, setLimites] = useState<EventSettings | null>(null);
  const [soComEvento, setSoComEvento] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [diaAberto, setDiaAberto] = useState<AgendaDay | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);

  // Clicar rápido em "próximo mês" dispara vários pedidos; só a resposta do último vale,
  // senão o cabeçalho mostra um mês e a lista outro (e o salvar vai para a data errada).
  const ultimoPedido = useRef(0);
  const carregar = useCallback(() => {
    const pedido = ++ultimoPedido.current;
    setCarregando(true);
    setErro(null);
    return getEventsAgenda(ano, mes)
      .then((r) => { if (pedido === ultimoPedido.current) { setDias(r.dias); setLimites(r.limites); } })
      .catch((x) => { if (pedido === ultimoPedido.current) setErro(x instanceof Error ? x.message : "Não foi possível carregar a agenda."); })
      .finally(() => { if (pedido === ultimoPedido.current) setCarregando(false); });
  }, [ano, mes]);

  useEffect(() => { void carregar(); }, [carregar]);

  function andar(delta: number) {
    const total = ano * 12 + (mes - 1) + delta;
    setAno(Math.floor(total / 12));
    setMes((total % 12) + 1);
  }

  const visiveis = useMemo(
    // Dia marcado na Escala também aparece: a gerência já sabe que há evento, mesmo sem ter lançado.
    () => dias.filter((d) => !soComEvento || d.eventos.length > 0 || d.escala || d.decisao?.notes || d.date === hoje),
    [dias, soComEvento, hoje],
  );

  const resumo = useMemo(() => {
    const comEvento = dias.filter((d) => d.eventos.length > 0);
    const porTamanho = { PEQUENO: 0, MEDIO: 0, GRANDE: 0 } as Record<EventSize, number>;
    const realizados = { PEQUENO: 0, MEDIO: 0, GRANDE: 0 } as Record<EventSize, number>;
    let divergem = 0;
    let comparados = 0;
    let acertos = 0;
    for (const d of comEvento) {
      if (d.date >= hoje) {
        if (!d.previsao) continue;
        porTamanho[d.previsao.tamanho]++;
        if (d.escala && d.escala !== d.previsao.tamanho) divergem++;
        continue;
      }
      const almocos = d.realizado?.almocos;
      if (almocos == null || !limites) continue;
      const real = tamanhoReal(almocos, limites);
      realizados[real]++;
      // A aposta feita na época (congelada ao salvar o dia) vale mais que a previsão de hoje,
      // que já enxerga edições que vieram depois.
      const previsto = d.decisao?.forecastSize ?? d.previsao?.tamanho;
      if (previsto) { comparados++; if (previsto === real) acertos++; }
    }
    return { comEvento: comEvento.length, porTamanho, divergem, realizados, comparados, acertos };
  }, [dias, hoje, limites]);
  const temFuturo = dias.some((d) => d.date >= hoje);
  const temPassado = resumo.comparados > 0 || Object.values(resumo.realizados).some((n) => n > 0);

  return (
    <div className="evt-agenda">
      <div className="evt-barra">
        <div className="evt-mes">
          <Button variant="secondary" size="sm" iconOnly aria-label="Mês anterior" onClick={() => andar(-1)}><ChevronLeft size={16} /></Button>
          <h2 className="evt-mes-nome">{MESES[mes - 1]} <span>{ano}</span></h2>
          <Button variant="secondary" size="sm" iconOnly aria-label="Próximo mês" onClick={() => andar(1)}><ChevronRight size={16} /></Button>
          {(ano !== Number(hoje.slice(0, 4)) || mes !== Number(hoje.slice(5, 7))) && (
            <Button variant="secondary" size="sm" onClick={() => { setAno(Number(hoje.slice(0, 4))); setMes(Number(hoje.slice(5, 7))); }}>Hoje</Button>
          )}
        </div>
        <div className="evt-barra-acoes">
          <label className="evt-toggle">
            <Switch checked={soComEvento} onChange={setSoComEvento} />
            Só dias com evento
          </label>
          {podeCriar && (
            <Button size="sm" leadingIcon={<CalendarPlus size={16} />} onClick={() => setNovaAberta(true)}>Lançar evento da circular</Button>
          )}
        </div>
      </div>

      <div className="evt-resumo" aria-live="polite">
        <div><strong>{resumo.comEvento}</strong><span>dias com evento no mês</span></div>
        {temFuturo && (
          <div className="evt-resumo-tamanhos">
            <span><TamanhoPill tamanho="GRANDE" /> {resumo.porTamanho.GRANDE}</span>
            <span><TamanhoPill tamanho="MEDIO" /> {resumo.porTamanho.MEDIO}</span>
            <span><TamanhoPill tamanho="PEQUENO" /> {resumo.porTamanho.PEQUENO}</span>
            <small>buffet sugerido daqui para frente{limites ? ` (P até ${limites.smallMaxLunch} almoços, G acima de ${limites.largeMinLunch})` : ""}</small>
          </div>
        )}
        {temPassado && (
          <div className="evt-resumo-tamanhos">
            <span><TamanhoPill tamanho="GRANDE" /> {resumo.realizados.GRANDE}</span>
            <span><TamanhoPill tamanho="MEDIO" /> {resumo.realizados.MEDIO}</span>
            <span><TamanhoPill tamanho="PEQUENO" /> {resumo.realizados.PEQUENO}</span>
            <small>tamanho que os dias com evento tiveram de fato</small>
          </div>
        )}
        {resumo.comparados > 0 && (
          <div><strong>{resumo.acertos} de {resumo.comparados}</strong><span>dias em que a previsão acertou o tamanho</span></div>
        )}
        {resumo.divergem > 0 && (
          <div className="evt-resumo-alerta"><strong>{resumo.divergem}</strong><span>{resumo.divergem === 1 ? "dia com a Escala diferente da sugestão" : "dias com a Escala diferente da sugestão"}</span></div>
        )}
      </div>

      {erro && <Alert tone="error">{erro}</Alert>}
      {carregando && dias.length === 0 ? <p className="evt-carregando">Carregando a agenda…</p> : visiveis.length === 0 ? (
        <EmptyState title="Nenhum evento lançado neste mês" description="Quando a circular do centro de convenções chegar, lance os eventos para ver a sugestão de buffet de cada dia." />
      ) : (
        <ol className={`evt-dias${carregando ? " evt-recarregando" : ""}`}>
          {visiveis.map((d) => <LinhaDoDia key={d.date} dia={d} hoje={hoje} onAbrir={() => setDiaAberto(d)} />)}
        </ol>
      )}

      <DiaDialog dia={diaAberto} podeEditar={podeEditar} onFechar={() => setDiaAberto(null)}
        onSalvo={() => { setDiaAberto(null); void carregar(); }} onAbrirEvento={(id) => { setDiaAberto(null); onAbrirEvento(id); }} />
      <NovaEdicaoDialog aberto={novaAberta} mesSugerido={{ ano, mes }} onFechar={() => setNovaAberta(false)}
        onCriada={() => { setNovaAberta(false); void carregar(); }} />
    </div>
  );
}

function LinhaDoDia({ dia, hoje, onAbrir }: { dia: AgendaDay; hoje: string; onAbrir: () => void }) {
  const passado = dia.date < hoje;
  const sugerido = dia.previsao?.tamanho ?? null;
  const diverge = !passado && sugerido && dia.escala && dia.escala !== sugerido;
  const r = dia.realizado;
  const classes = ["evt-dia", dia.date === hoje && "evt-dia-hoje", passado && "evt-dia-passado", ehFimDeSemana(dia.date) && "evt-dia-fds"].filter(Boolean).join(" ");

  return (
    <li className={classes}>
      <button type="button" className="evt-dia-botao" onClick={onAbrir} aria-label={`Abrir o dia ${dia.date.split("-").reverse().join("/")}`}>
        <span className="evt-data">
          <strong>{dia.date.slice(8)}</strong>
          <small>{diaDaSemana(dia.date)}</small>
        </span>

        <span className="evt-eventos">
          {dia.eventos.length === 0 ? <span className="evt-sem">Sem evento lançado</span> : dia.eventos.map((e) => (
            <span key={e.editionId} className="evt-evento">
              <span className="evt-evento-nome">{e.seriesName}</span>
              <span className="evt-evento-meta">
                {diaDoEvento(e.dia, e.totalDias)}
                {e.startTime && e.endTime ? ` · ${e.startTime}–${e.endTime}` : ""}
                {e.origin !== "CENTRO_CONVENCOES" && <em>{e.origin === "TEATRO" ? "teatro" : "grupo"}</em>}
              </span>
            </span>
          ))}
        </span>

        <span className="evt-previsao">
          {dia.previsao ? (
            <>
              <span className="evt-previsao-num">
                <TamanhoPill tamanho={dia.previsao.tamanho} apagado={passado} />
                <span><strong>~{dia.previsao.almoco}</strong> almoços</span>
              </span>
              <small>{dia.previsao.minimo}–{dia.previsao.maximo}{dia.previsao.poucaBase ? " · pouca base" : ""}</small>
            </>
          ) : dia.eventos.length > 0 ? <small className="evt-sem">sem histórico</small> : null}
        </span>

        <span className="evt-escala">
          {dia.escala ? (
            <span className={diverge ? "evt-escala-diverge" : undefined} title={diverge ? "A marcação da Escala é diferente da sugestão" : "Marcação da Escala"}>
              Escala <TamanhoPill tamanho={dia.escala} />
            </span>
          ) : passado ? null : <small className="evt-sem">Escala sem marcação</small>}
        </span>

        <span className="evt-realizado">
          {r && r.almocos !== null ? (
            <>
              <span><strong>{r.almocos}</strong> almoços · {r.jantares ?? 0} jantares</span>
              <small>{reais(r.valorAlmoco)} no almoço{r.fonte === "PLANILHA" ? " · planilha" : ""}</small>
            </>
          ) : passado ? <small className="evt-sem">sem faturamento</small> : null}
        </span>

        <span className="evt-decisao">
          {/* O preço que o PDV cobrou vale mais que o anotado à mão. */}
          {dia.modalidadePdv ? (
            <span title={dia.buffetCobrado ? `Buffet cobrado no PDV: ${dia.buffetCobrado.principal.vendidos} vendidos` : "Nenhum buffet vendido no PDV"}>
              {MODALIDADE[dia.modalidadePdv]}{dia.buffetCobrado ? ` ${centavos(dia.buffetCobrado.principal.preco)}` : ""} <small className="evt-pdv">PDV</small>
            </span>
          ) : dia.decisao?.serviceMode ? (
            <span>{MODALIDADE[dia.decisao.serviceMode]}{dia.decisao.buffetPrice ? ` · ${centavos(dia.decisao.buffetPrice)}` : ""}</span>
          ) : null}
          {dia.decisao?.notes && <MessageSquareText size={15} aria-label="Tem comentário" />}
        </span>
      </button>
    </li>
  );
}
