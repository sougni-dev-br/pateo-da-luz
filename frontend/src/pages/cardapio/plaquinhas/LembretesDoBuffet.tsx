import { BellRing, Plus, Repeat } from "lucide-react";
import type { BuffetPlateItem, BuffetUsageReport } from "../../../api/client";
import { dataCurtaIso } from "./acompanhamento";

const MAX_ESQUECIDOS = 6;

type Props = {
  relatorio: BuffetUsageReport | null;
  porId: Map<string, BuffetPlateItem>;
  naFolha: Map<string, number>;
  onAdicionar: (itemId: string) => void;
  /** "buffet", "coffee break"… para a frase do aviso. */
  rotuloTipo?: string;
};

// O alerta na hora de montar a folha: o que a cozinha costumava fazer e parou, e o que da
// folha de hoje já saiu demais. Some quando não há nada a dizer.
export function LembretesDoBuffet({ relatorio, porId, naFolha, onAdicionar, rotuloTipo = "buffet" }: Props) {
  if (!relatorio) return null;
  const esquecidos = relatorio.forgotten.filter((f) => !naFolha.has(f.itemId) && porId.get(f.itemId)?.isActive).slice(0, MAX_ESQUECIDOS);
  const porDias = new Map(relatorio.ranking.map((r) => [r.itemId, r.days]));
  const repetindo = relatorio.repeating.filter((id) => naFolha.has(id) && porId.has(id));
  if (!esquecidos.length && !repetindo.length) return null;
  const total = relatorio.period.servedDays;

  return (
    <section className="plq-bloco plq-lembretes" aria-label="Lembretes do acompanhamento">
      {esquecidos.length > 0 && (
        <div className="plq-lembrete">
          <p className="plq-lembrete-titulo"><BellRing size={15} aria-hidden="true" /> Faz tempo que não sai</p>
          <div className="plq-lembrete-chips">
            {esquecidos.map((f) => (
              <button key={f.itemId} type="button" className="plq-chip plq-chip--lembrete" onClick={() => onAdicionar(f.itemId)}
                title={`Saiu em ${f.daysInHistory} dias nos últimos 3 meses. Último: ${dataCurtaIso(f.lastDay)}. Toque para pôr na folha.`}>
                <Plus size={13} aria-hidden="true" /> {porId.get(f.itemId)?.namePt} <small>há {f.daysSince} dias</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {repetindo.length > 0 && (
        <div className="plq-lembrete plq-lembrete--repete">
          <p className="plq-lembrete-titulo"><Repeat size={15} aria-hidden="true" /> Saindo demais</p>
          <ul>
            {repetindo.map((id) => (
              <li key={id}><strong>{porId.get(id)?.namePt}</strong> saiu em {porDias.get(id)} dos {total} dias de {rotuloTipo} dos últimos {relatorio.period.windowDays} dias.</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
