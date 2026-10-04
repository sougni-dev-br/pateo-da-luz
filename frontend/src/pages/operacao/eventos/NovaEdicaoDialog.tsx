import { useEffect, useState, type FormEvent } from "react";
import { createEventEdition, matchEventSeries, type EventOrigin } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Select, TextField, Textarea } from "../../../design-system";
import { ORIGEM, opcoes } from "./formato";

type Sugestao = { id: string; name: string; origin: EventOrigin; exato: boolean };

type Props = {
  aberto: boolean;
  mesSugerido: { ano: number; mes: number };
  onFechar: () => void;
  onCriada: () => void;
};

// Lançar um evento da circular. O nome é casado com os eventos já conhecidos para que a
// edição nova entre na mesma ficha das anteriores ("como foi no ano passado").
export function NovaEdicaoDialog({ aberto, mesSugerido, onFechar, onCriada }: Props) {
  const [titulo, setTitulo] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [publico, setPublico] = useState("");
  const [andar, setAndar] = useState("");
  const [contato, setContato] = useState("");
  const [notas, setNotas] = useState("");
  const [origem, setOrigem] = useState<EventOrigin>("CENTRO_CONVENCOES");
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  // undefined = ainda não escolheu; null = evento novo; string = série existente.
  const [serie, setSerie] = useState<string | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const primeiro = `${mesSugerido.ano}-${String(mesSugerido.mes).padStart(2, "0")}-01`;
    setTitulo(""); setInicio(primeiro); setFim(primeiro); setPublico(""); setAndar(""); setContato(""); setNotas("");
    setOrigem("CENTRO_CONVENCOES"); setSugestoes([]); setSerie(undefined); setErro(null);
  }, [aberto, mesSugerido.ano, mesSugerido.mes]);

  useEffect(() => {
    if (titulo.trim().length < 3) { setSugestoes([]); setSerie(undefined); return undefined; }
    // Resposta que chega depois de a pessoa continuar digitando é descartada, para não trocar
    // a lista (nem a escolha marcada) por sugestões de um nome que já não está no campo.
    let valida = true;
    const espera = setTimeout(() => {
      matchEventSeries(titulo).then((s) => {
        if (!valida) return;
        setSugestoes(s);
        const exata = s.find((x) => x.exato);
        setSerie((atual) => (atual !== undefined && s.some((x) => x.id === atual) ? atual : exata ? exata.id : undefined));
      }).catch(() => { if (valida) setSugestoes([]); });
    }, 300);
    return () => { valida = false; clearTimeout(espera); };
  }, [titulo]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (titulo.trim().length < 2) return setErro("Escreva o nome do evento como está na circular.");
    if (!inicio || !fim || fim < inicio) return setErro("Confira as datas: o fim não pode ser antes do início.");
    if (sugestoes.length > 0 && serie === undefined) return setErro("Diga se é uma edição de um evento que já conhecemos ou um evento novo.");
    setSalvando(true);
    setErro(null);
    try {
      await createEventEdition({
        seriesId: serie ?? null,
        newSeriesName: serie ? null : titulo.trim(),
        newSeriesOrigin: origem,
        title: titulo.trim(),
        startDate: inicio,
        endDate: fim,
        announcedAudience: publico.trim() ? Number(publico.replace(/\D/g, "")) : null,
        floor: andar.trim() || null,
        contact: contato.trim() || null,
        notes: notas.trim() || null,
      });
      onCriada();
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível lançar o evento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }} size="lg" title="Lançar evento da circular"
      description="Um evento por vez, com as datas da circular. Os dias são criados sozinhos.">
      <form className="evt-form" onSubmit={salvar}>
        <TextField label="Nome do evento" value={titulo} autoFocus required maxLength={200}
          placeholder="Ex.: 12º Congresso Paulista de Exemplo" onChange={(e) => setTitulo(e.target.value)} />

        {sugestoes.length > 0 && (
          <fieldset className="evt-sugestoes">
            <legend>Já conhecemos este evento?</legend>
            {sugestoes.map((s) => (
              <label key={s.id}>
                <input type="radio" name="serie" checked={serie === s.id} onChange={() => setSerie(s.id)} />
                É uma nova edição de <strong>{s.name}</strong>{s.exato ? " (mesmo nome)" : ""}
              </label>
            ))}
            <label>
              <input type="radio" name="serie" checked={serie === null} onChange={() => setSerie(null)} />
              Não, é um evento novo
            </label>
          </fieldset>
        )}

        <div className="evt-form-linha">
          <TextField label="Início" type="date" value={inicio} required onChange={(e) => { setInicio(e.target.value); if (fim < e.target.value) setFim(e.target.value); }} />
          <TextField label="Fim" type="date" value={fim} min={inicio} required onChange={(e) => setFim(e.target.value)} />
          <TextField label="Público anunciado" value={publico} inputMode="numeric" placeholder="1200" onChange={(e) => setPublico(e.target.value)} />
        </div>
        <div className="evt-form-linha">
          <TextField label="Andar" value={andar} maxLength={60} placeholder="4º andar" onChange={(e) => setAndar(e.target.value)} />
          <TextField label="Contato da organização" value={contato} maxLength={200} onChange={(e) => setContato(e.target.value)} />
          {serie !== undefined && serie !== null ? null : (
            <Select label="Origem" value={origem} onChange={(e) => setOrigem(e.target.value as EventOrigin)} options={opcoes(ORIGEM)} />
          )}
        </div>
        <Textarea label="Observações" value={notas} rows={3} maxLength={4000} onChange={(e) => setNotas(e.target.value)}
          placeholder="Área do evento, horários, se vai servir almoço lá dentro…" />
        {erro && <Alert tone="error">{erro}</Alert>}
        <div className="evt-form-acoes">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Lançando…" : "Lançar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
