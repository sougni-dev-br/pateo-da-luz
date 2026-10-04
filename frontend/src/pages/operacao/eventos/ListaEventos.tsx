import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { EventOrigin, EventSeriesSummary } from "../../../api/client";
import { EmptyState, Table } from "../../../design-system";
import { AREA, ORIGEM, dataBr } from "./formato";

type Props = {
  series: EventSeriesSummary[];
  onAbrir: (seriesId: string) => void;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ListaEventos({ series, onAbrir }: Props) {
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<EventOrigin | "">("");

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return series
      .filter((s) => (!origem || s.origin === origem) && (!termo || semAcento(s.name).includes(termo)))
      .sort((a, b) => (b.ultimaEdicao ?? "").localeCompare(a.ultimaEdicao ?? ""));
  }, [series, busca, origem]);

  return (
    <div className="evt-lista">
      <div className="evt-barra">
        <label className="evt-busca">
          <Search size={16} aria-hidden />
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar evento pelo nome" aria-label="Buscar evento pelo nome" />
        </label>
        <div className="evt-chips" role="group" aria-label="Filtrar por origem">
          <button type="button" className="evt-chip" aria-pressed={origem === ""} onClick={() => setOrigem("")}>Todos</button>
          {(Object.keys(ORIGEM) as EventOrigin[]).map((o) => (
            <button key={o} type="button" className="evt-chip" aria-pressed={origem === o} onClick={() => setOrigem(o)}>{ORIGEM[o]}</button>
          ))}
        </div>
      </div>
      <p className="evt-contagem">{filtradas.length} {filtradas.length === 1 ? "evento" : "eventos"} · mais recentes primeiro</p>

      {filtradas.length === 0 ? <EmptyState title="Nenhum evento encontrado" description="Tente outro nome ou tire o filtro." /> : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Evento</Table.Th>
              <Table.Th>Área</Table.Th>
              <Table.Th align="right">Edições</Table.Th>
              <Table.Th>Última</Table.Th>
              <Table.Th align="right">Almoços em média</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtradas.map((s) => (
              <Table.Row key={s.id} className="evt-linha-clicavel" onClick={() => onAbrir(s.id)}>
                <Table.Td>
                  <button type="button" className="evt-link" onClick={(e) => { e.stopPropagation(); onAbrir(s.id); }}>{s.name}</button>
                  {s.origin !== "CENTRO_CONVENCOES" && <small className="evt-origem-tag">{ORIGEM[s.origin]}</small>}
                </Table.Td>
                <Table.Td>{AREA[s.area]}</Table.Td>
                <Table.Td align="right">{s.edicoes}</Table.Td>
                <Table.Td>{s.ultimaEdicao ? dataBr(s.ultimaEdicao) : "—"}</Table.Td>
                <Table.Td align="right">
                  {s.mediaAlmocos !== null ? <><strong>{s.mediaAlmocos}</strong> <small className="evt-sem">({s.diasComMovimento} dias)</small></> : <span className="evt-sem">sem faturamento</span>}
                </Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
