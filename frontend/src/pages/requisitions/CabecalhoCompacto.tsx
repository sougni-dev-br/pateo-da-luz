import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { InventorySector } from "../../api/client";
import { hojeLocalIso } from "../../lib/datas";
import type { DadosDoCabecalho } from "./rascunho";

export const TURNOS: Record<string, string> = { MORNING: "Manhã", AFTERNOON: "Tarde", NIGHT: "Noite" };
export const MOTIVOS: Record<string, string> = { DAILY_PRODUCTION: "Produção do dia", PREP: "Pré-preparo", EVENT: "Evento", OTHER: "Outro" };

type Props = {
  valor: DadosDoCabecalho;
  setores: InventorySector[];
  onMudar: (proximo: DadosDoCabecalho) => void;
};

function rotuloDaData(iso: string): string {
  if (iso === hojeLocalIso()) return "Hoje";
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}` : iso;
}

/**
 * Quase toda requisição é de hoje, no turno em que se está, pela produção do dia: então o cabeçalho
 * vira uma linha que se lê de relance e só abre quando algo precisa mudar. A lista sobe para a primeira dobra.
 */
export function CabecalhoCompacto({ valor, setores, onMudar }: Props) {
  const [aberto, setAberto] = useState(false);
  const setor = setores.find((s) => s.id === valor.sectorId)?.name ?? "Todos os setores";
  const motivo = valor.reason === "OTHER" && valor.reasonNotes ? valor.reasonNotes : MOTIVOS[valor.reason] ?? valor.reason;

  return (
    <section className="rq-cabecalho" aria-label="Dados da requisição">
      <button type="button" className="rq-cabecalho-resumo" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <CalendarDays size={18} aria-hidden />
        <span className="rq-cabecalho-texto">
          <strong>{rotuloDaData(valor.date)} · {TURNOS[valor.shift] ?? valor.shift}</strong>
          <small>{setor} · {motivo}</small>
        </span>
        <span className="rq-cabecalho-alterar">{aberto ? "Fechar" : "Alterar"} <ChevronDown size={16} aria-hidden className={aberto ? "is-aberto" : undefined} /></span>
      </button>

      {aberto && (
        <div className="rq-cabecalho-campos">
          <label className="req-field"><span>Data</span>
            <input type="date" value={valor.date} max={hojeLocalIso()} onChange={(e) => onMudar({ ...valor, date: e.target.value })} />
          </label>
          <div className="req-field"><span>Turno</span>
            <div className="rq-segmentos rq-segmentos-largo" role="group" aria-label="Turno">
              {Object.entries(TURNOS).map(([chave, rotulo]) => (
                <button key={chave} type="button" aria-pressed={valor.shift === chave} className={valor.shift === chave ? "is-ativo" : undefined} onClick={() => onMudar({ ...valor, shift: chave })}>{rotulo}</button>
              ))}
            </div>
          </div>
          <label className="req-field"><span>Setor que pediu</span>
            <select value={valor.sectorId} onChange={(e) => onMudar({ ...valor, sectorId: e.target.value })}>
              <option value="">Todos os setores</option>
              {setores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="req-field"><span>Motivo</span>
            <select value={valor.reason} onChange={(e) => onMudar({ ...valor, reason: e.target.value })}>
              {Object.entries(MOTIVOS).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
            </select>
          </label>
          {valor.reason === "OTHER" && (
            <label className="req-field req-field-wide"><span>Qual o motivo?</span>
              <input value={valor.reasonNotes} placeholder="Descreva o motivo" onChange={(e) => onMudar({ ...valor, reasonNotes: e.target.value })} />
            </label>
          )}
          <label className="req-field req-field-wide"><span>Observações</span>
            <input value={valor.notes} placeholder="Opcional" onChange={(e) => onMudar({ ...valor, notes: e.target.value })} />
          </label>
        </div>
      )}
    </section>
  );
}
