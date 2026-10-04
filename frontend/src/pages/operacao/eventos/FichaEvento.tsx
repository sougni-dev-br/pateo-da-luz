import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  deleteEventEdition, getEventSeries, mergeEventSeries, saveEventSeries,
  type EventArea, type EventEditionDetail, type EventOrigin, type EventSeriesDetail, type EventSeriesSummary,
} from "../../../api/client";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Alert, Button, Select, StatusBadge, Table, TextField, Textarea } from "../../../design-system";
import { AREA, MODALIDADE, ORIGEM, dataBr, diaDaSemana, diaDoEvento, diaMes, ehFimDeSemana, opcoes, reais, ticket } from "./formato";

type Props = {
  seriesId: string;
  todas: EventSeriesSummary[];
  podeEditar: boolean;
  podeExcluir: boolean;
  onVoltar: () => void;
  onAbrir: (seriesId: string) => void;
  onMudou: () => void;
};

type Ponto = "1º dia" | "Meio" | "Último dia" | "Dia único";
const PONTOS: Ponto[] = ["1º dia", "Meio", "Último dia", "Dia único"];
function pontoDoDia(dia: number, total: number): Ponto {
  if (total <= 1) return "Dia único";
  if (dia === 1) return "1º dia";
  return dia === total ? "Último dia" : "Meio";
}

// A ficha responde "como foi da outra vez": todas as edições, dia a dia, com os outros
// eventos que aconteceram junto (o faturamento é do restaurante, não só deste evento).
export function FichaEvento({ seriesId, todas, podeEditar, podeExcluir, onVoltar, onAbrir, onMudou }: Props) {
  const [ficha, setFicha] = useState<EventSeriesDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [juntarCom, setJuntarCom] = useState("");
  const [confirmarJuntar, setConfirmarJuntar] = useState(false);
  const [apagar, setApagar] = useState<EventEditionDetail | null>(null);

  // Ao pular de um evento para outro pelo "Junto com", a resposta do evento anterior pode chegar
  // depois: só a do evento aberto agora é usada.
  const aberto = useRef(seriesId);
  aberto.current = seriesId;
  const carregar = useCallback(() => {
    setErro(null);
    getEventSeries(seriesId)
      .then((f) => { if (aberto.current === seriesId) setFicha(f); })
      .catch((x) => { if (aberto.current === seriesId) setErro(x instanceof Error ? x.message : "Não foi possível abrir o evento."); });
  }, [seriesId]);
  useEffect(() => { setFicha(null); setEditando(false); setJuntarCom(""); carregar(); }, [carregar]);

  // Média de almoços por ponto do evento, juntando todas as edições com faturamento.
  const medias = useMemo(() => {
    const acc = new Map<Ponto, number[]>();
    for (const ed of ficha?.editions ?? []) {
      for (const d of ed.days) {
        if (d.realizado?.almocos == null) continue;
        const p = pontoDoDia(d.dia, d.totalDias);
        acc.set(p, [...(acc.get(p) ?? []), d.realizado.almocos]);
      }
    }
    return PONTOS.filter((p) => acc.has(p)).map((p) => {
      const v = acc.get(p)!;
      return { ponto: p, media: Math.round(v.reduce((a, b) => a + b, 0) / v.length), dias: v.length };
    });
  }, [ficha]);

  if (erro) return <div className="evt-ficha"><Button variant="secondary" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={onVoltar}>Voltar</Button><Alert tone="error">{erro}</Alert></div>;
  if (!ficha) return <p className="evt-carregando">Abrindo o evento…</p>;

  const alvoJuntar = todas.find((s) => s.id === juntarCom);

  return (
    <div className="evt-ficha">
      <Button variant="secondary" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={onVoltar}>Todos os eventos</Button>

      <header className="evt-ficha-topo">
        <div>
          <p className="evt-ficha-origem">{ORIGEM[ficha.origin]} · {AREA[ficha.area]}{ficha.organizer ? ` · ${ficha.organizer}` : ""}</p>
          <h2>{ficha.name}</h2>
          {ficha.notes && <p className="evt-ficha-notas">{ficha.notes}</p>}
        </div>
        {podeEditar && !editando && <Button variant="secondary" size="sm" onClick={() => setEditando(true)}>Editar</Button>}
      </header>

      {editando && <EditarSerie ficha={ficha} onCancelar={() => setEditando(false)} onSalvo={() => { setEditando(false); carregar(); onMudou(); }} />}

      <div className="evt-ficha-medias">
        <div><strong>{ficha.editions.length}</strong><span>{ficha.editions.length === 1 ? "edição" : "edições"}</span></div>
        {medias.map((m) => (
          <div key={m.ponto}><strong>{m.media}</strong><span>almoços em média · {m.ponto.toLowerCase()} ({m.dias} {m.dias === 1 ? "dia" : "dias"})</span></div>
        ))}
        {medias.length === 0 && <div><span>Nenhuma edição com faturamento registrado ainda.</span></div>}
      </div>

      {ficha.editions.map((ed) => (
        <section key={ed.id} className="evt-edicao">
          <header>
            <div>
              <h3>{ed.title}</h3>
              <p>
                {dataBr(ed.startDate)}{ed.endDate !== ed.startDate ? ` a ${dataBr(ed.endDate)}` : ""}
                {ed.announcedAudience ? ` · público anunciado ${ed.announcedAudience.toLocaleString("pt-BR")}` : ""}
                {ed.floor ? ` · ${ed.floor}` : ""}
                {ed.contact ? ` · contato: ${ed.contact}` : ""}
              </p>
              {ed.notes && <p className="evt-ficha-notas">{ed.notes}</p>}
            </div>
            <div className="evt-edicao-acoes">
              {ed.source === "PLANILHA" && <StatusBadge tone="neutral">planilha</StatusBadge>}
              {podeExcluir && (
                <Button variant="secondary" size="sm" iconOnly aria-label={`Apagar a edição ${ed.title}`} onClick={() => setApagar(ed)}><Trash2 size={15} /></Button>
              )}
            </div>
          </header>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Dia</Table.Th>
                <Table.Th align="right">Almoços</Table.Th>
                <Table.Th align="right">Jantares</Table.Th>
                <Table.Th align="right">Almoço (sem 10%)</Table.Th>
                <Table.Th align="right">Ticket</Table.Th>
                <Table.Th>Junto com</Table.Th>
                <Table.Th align="left" minWidth={240}>Comentário do dia</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {ed.days.map((d) => (
                <Table.Row key={d.date}>
                  <Table.Td>
                    <span className={`evt-ficha-dia${ehFimDeSemana(d.date) ? " evt-dia-fds" : ""}`}>
                      <strong>{diaMes(d.date)}</strong> {diaDaSemana(d.date)}
                      <small>{diaDoEvento(d.dia, d.totalDias)}{d.startTime && d.endTime ? ` · ${d.startTime}–${d.endTime}` : ""}</small>
                    </span>
                  </Table.Td>
                  <Table.Td align="right"><strong>{d.realizado?.almocos ?? "—"}</strong></Table.Td>
                  <Table.Td align="right">{d.realizado?.jantares ?? "—"}</Table.Td>
                  <Table.Td align="right">{reais(d.realizado?.valorAlmoco)}</Table.Td>
                  <Table.Td align="right">{ticket(d.realizado?.valorAlmoco ?? null, d.realizado?.almocos ?? null)}</Table.Td>
                  <Table.Td>
                    {d.outrosEventos.length === 0 ? <span className="evt-sem">só este</span> : d.outrosEventos.map((o) => (
                      <button key={o.seriesId} type="button" className="evt-link evt-link-pequeno" onClick={() => onAbrir(o.seriesId)}>{o.seriesName}</button>
                    ))}
                  </Table.Td>
                  <Table.Td>
                    <span className="evt-comentario">
                      {d.serviceMode && <em>{MODALIDADE[d.serviceMode]}{d.buffetPrice ? ` · ${d.buffetPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</em>}
                      {d.notes ?? (d.serviceMode ? null : <span className="evt-sem">—</span>)}
                    </span>
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </section>
      ))}

      {podeEditar && (
        <section className="evt-bloco evt-juntar">
          <h3 className="evt-secao">Juntar com outro evento</h3>
          <p className="evt-base">Use quando o mesmo evento aparece com dois nomes (por exemplo, a sigla num ano e o nome completo no outro). As edições daqui passam para o outro, e este some.</p>
          <div className="evt-form-linha">
            <Select label="Mesmo evento que" value={juntarCom} placeholder="Escolha o evento" onChange={(e) => setJuntarCom(e.target.value)}
              options={todas.filter((s) => s.id !== ficha.id).map((s) => ({ value: s.id, label: `${s.name}${s.ultimaEdicao ? ` (última: ${s.ultimaEdicao.slice(0, 4)})` : ""}` }))} />
            <Button variant="secondary" disabled={!juntarCom} onClick={() => setConfirmarJuntar(true)}>Juntar</Button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmarJuntar}
        onCancel={() => setConfirmarJuntar(false)}
        tone="warning"
        title="Juntar os dois eventos?"
        description={`As ${ficha.editions.length} edição(ões) de "${ficha.name}" passam para "${alvoJuntar?.name ?? ""}". Não dá para desfazer pela tela.`}
        confirmLabel="Juntar"
        onConfirm={async () => {
          try {
            const r = await mergeEventSeries(ficha.id, juntarCom);
            setConfirmarJuntar(false);
            onMudou();
            onAbrir(r.id);
          } catch (x) {
            setConfirmarJuntar(false);
            setErro(x instanceof Error ? x.message : "Não foi possível juntar.");
          }
        }}
      />
      <ConfirmDialog
        open={apagar !== null}
        onCancel={() => setApagar(null)}
        title="Apagar esta edição?"
        description={apagar ? `"${apagar.title}" (${dataBr(apagar.startDate)}) sai da agenda e da ficha. O faturamento e os comentários do dia continuam guardados.` : ""}
        confirmLabel="Apagar"
        tone="danger"
        onConfirm={async () => {
          if (!apagar) return;
          try {
            await deleteEventEdition(apagar.id);
            setApagar(null);
            carregar();
            onMudou();
          } catch (x) {
            setApagar(null);
            setErro(x instanceof Error ? x.message : "Não foi possível apagar.");
          }
        }}
      />
    </div>
  );
}

function EditarSerie({ ficha, onCancelar, onSalvo }: { ficha: EventSeriesDetail; onCancelar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(ficha.name);
  const [origem, setOrigem] = useState<EventOrigin>(ficha.origin);
  const [area, setArea] = useState<EventArea>(ficha.area);
  const [organizador, setOrganizador] = useState(ficha.organizer ?? "");
  const [notas, setNotas] = useState(ficha.notes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await saveEventSeries(ficha.id, { name: nome.trim(), origin: origem, area, organizer: organizador.trim() || null, notes: notas.trim() || null });
      onSalvo();
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="evt-bloco evt-form" onSubmit={salvar}>
      <TextField label="Nome do evento" value={nome} required maxLength={160} onChange={(e) => setNome(e.target.value)} />
      <div className="evt-form-linha">
        <Select label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value as EventOrigin)} options={opcoes(ORIGEM)} />
        <Select label="Área" value={area} onChange={(e) => setArea(e.target.value as EventArea)} options={opcoes(AREA)} />
        <TextField label="Organizador" value={organizador} maxLength={160} onChange={(e) => setOrganizador(e.target.value)} />
      </div>
      <Textarea label="O que já sabemos deste evento" value={notas} rows={3} maxLength={4000} onChange={(e) => setNotas(e.target.value)}
        placeholder="Com quem falar, o que funcionou, o que evitar…" />
      {erro && <Alert tone="error">{erro}</Alert>}
      <div className="evt-form-acoes">
        <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </div>
    </form>
  );
}
