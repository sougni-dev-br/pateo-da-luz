// Operação → Painel de eventos: os eventos do centro de convenções, do teatro e os grupos com
// pacote, com o histórico de cada um e a sugestão de buffet de cada dia.
import { useCallback, useEffect, useState } from "react";
import { getEventSeriesList, type EventSeriesSummary } from "../../../api/client";
import { useSession } from "../../../context/SessionContext";
import { Alert, Tabs } from "../../../design-system";
import { hasPermission } from "../../../lib/permissions";
import { Agenda } from "./Agenda";
import { ConfigEventos } from "./ConfigEventos";
import { FichaEvento } from "./FichaEvento";
import { ListaEventos } from "./ListaEventos";
import "./eventos.css";

const MODULO = "events";
const ABAS = [
  { value: "agenda", label: "Agenda do mês" },
  { value: "eventos", label: "Eventos e histórico" },
  { value: "config", label: "Configuração" },
];

export function PainelEventos() {
  const { user } = useSession();
  const podeCriar = hasPermission(user, MODULO, "create");
  const podeEditar = hasPermission(user, MODULO, "edit");
  const podeExcluir = hasPermission(user, MODULO, "delete");
  const podeAdministrar = hasPermission(user, MODULO, "admin");

  const [aba, setAba] = useState("agenda");
  const [series, setSeries] = useState<EventSeriesSummary[]>([]);
  const [serieAberta, setSerieAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregarSeries = useCallback(() => {
    getEventSeriesList().then(setSeries).catch((x) => setErro(x instanceof Error ? x.message : "Não foi possível carregar os eventos."));
  }, []);
  useEffect(() => { carregarSeries(); }, [carregarSeries]);

  const abrirEvento = useCallback((id: string) => {
    setSerieAberta(id);
    setAba("eventos");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="evt-pagina">
      <Tabs tabs={ABAS} value={aba} onChange={(v) => { setAba(v); if (v !== "eventos") setSerieAberta(null); }} />
      {erro && <Alert tone="error">{erro}</Alert>}
      {aba === "agenda" && <Agenda podeEditar={podeEditar} podeCriar={podeCriar} onAbrirEvento={abrirEvento} />}
      {aba === "eventos" && (serieAberta ? (
        <FichaEvento seriesId={serieAberta} todas={series} podeEditar={podeEditar} podeExcluir={podeExcluir}
          onVoltar={() => setSerieAberta(null)} onAbrir={abrirEvento} onMudou={carregarSeries} />
      ) : <ListaEventos series={series} onAbrir={abrirEvento} />)}
      {aba === "config" && <ConfigEventos podeAlterar={podeAdministrar} />}
    </div>
  );
}
