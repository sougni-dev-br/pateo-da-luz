import { useEffect, useState, type FormEvent } from "react";
import { saveOperationDay, type AgendaDay, type BuffetCharged, type ServiceMode } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Select, TextField, Textarea } from "../../../design-system";
import { TamanhoPill } from "./Agenda";
import { MODALIDADE, TAMANHO, centavos, dataBr, diaDaSemana, diaDoEvento, lerPreco, nomeDoBuffet, opcoes, reais, ticket } from "./formato";

type Props = {
  dia: AgendaDay | null;
  podeEditar: boolean;
  onFechar: () => void;
  onSalvo: () => void;
  onAbrirEvento: (seriesId: string) => void;
};

/** Preço do dia (o buffet que mais vendeu) e, se houve, os outros preços cobrados. */
export function BuffetDoDia({ buffet }: { buffet: BuffetCharged }) {
  const { principal, outros } = buffet;
  return (
    <>
      {centavos(principal.preco)} · {principal.vendidos} vendidos ({nomeDoBuffet(principal.produto)})
      {outros.length > 0 && (
        <small className="evt-buffet-outros">
          Também: {outros.map((o) => `${nomeDoBuffet(o.produto)} ${centavos(o.preco)} (${o.vendidos})`).join(" · ")}
        </small>
      )}
    </>
  );
}

// O dia do restaurante: os eventos, a previsão (com o porquê), o que aconteceu e a decisão.
export function DiaDialog({ dia, podeEditar, onFechar, onSalvo, onAbrirEvento }: Props) {
  const [modalidade, setModalidade] = useState<ServiceMode | "">("");
  const [preco, setPreco] = useState("");
  const [notas, setNotas] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!dia) return;
    setModalidade(dia.decisao?.serviceMode ?? "");
    setPreco(dia.decisao?.buffetPrice ? String(dia.decisao.buffetPrice).replace(".", ",") : "");
    setNotas(dia.decisao?.notes ?? "");
    setErro(null);
  }, [dia]);

  if (!dia) return null;
  const r = dia.realizado;
  const p = dia.previsao;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!dia) return;
    const precoNumero = lerPreco(preco);
    if (precoNumero !== null && (!Number.isFinite(precoNumero) || precoNumero < 0)) return setErro("Preço do buffet inválido. Use, por exemplo, 89,90.");
    setSalvando(true);
    setErro(null);
    try {
      await saveOperationDay(dia.date, { serviceMode: modalidade || null, buffetPrice: precoNumero, notes: notas.trim() || null });
      onSalvo();
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível salvar o dia.");
    } finally {
      setSalvando(false);
    }
  }

  const titulo = `${diaDaSemana(dia.date)}, ${dataBr(dia.date)}`;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }} size="lg" title={titulo.charAt(0).toUpperCase() + titulo.slice(1)}
      description={dia.eventos.length ? `${dia.eventos.length} evento(s) no dia` : "Sem evento lançado"}>
      <div className="evt-dia-detalhe">
        <section>
          <h3 className="evt-secao">Eventos</h3>
          {dia.eventos.length === 0 ? <p className="evt-sem">Nenhum evento lançado para este dia.</p> : (
            <ul className="evt-lista-eventos">
              {dia.eventos.map((e) => (
                <li key={e.editionId}>
                  <button type="button" className="evt-link" onClick={() => onAbrirEvento(e.seriesId)}>{e.seriesName}</button>
                  <span>{diaDoEvento(e.dia, e.totalDias)}{e.startTime && e.endTime ? ` · ${e.startTime} às ${e.endTime}` : ""}</span>
                  {e.editionTitle !== e.seriesName && <small>{e.editionTitle}</small>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="evt-dia-colunas">
          <section className="evt-bloco">
            <h3 className="evt-secao">Previsão de almoços</h3>
            {p ? (
              <>
                <p className="evt-grande"><TamanhoPill tamanho={p.tamanho} /> ~{p.almoco} <small>({p.minimo} a {p.maximo})</small></p>
                <p className="evt-base">Buffet {TAMANHO[p.tamanho].nome}. {p.base}.</p>
                {p.poucaBase && <p className="evt-aviso">Pouca base: use a sua experiência para decidir.</p>}
              </>
            ) : <p className="evt-sem">{dia.eventos.length ? "Sem histórico parecido para prever." : "Dia sem evento."}</p>}
            <p className="evt-base">
              Escala: {dia.escala ? <><TamanhoPill tamanho={dia.escala} /> {TAMANHO[dia.escala].nome}</> : "sem marcação"}
              {p && dia.escala && dia.escala !== p.tamanho ? " (diferente da sugestão)" : ""}
            </p>
            {dia.decisao?.forecastLunch != null && (
              <p className="evt-base">Previsão quando a decisão foi salva: ~{dia.decisao.forecastLunch} almoços.</p>
            )}
          </section>

          <section className="evt-bloco">
            <h3 className="evt-secao">O que aconteceu</h3>
            {r && r.almocos !== null ? (
              <dl className="evt-numeros">
                <div><dt>Almoço</dt><dd>{r.almocos} pessoas · {reais(r.valorAlmoco)} · ticket {ticket(r.valorAlmoco, r.almocos)}</dd></div>
                <div><dt>Jantar</dt><dd>{r.jantares ?? 0} pessoas · {reais(r.valorJantar)} · ticket {ticket(r.valorJantar, r.jantares)}</dd></div>
                {dia.buffetCobrado && <div><dt>Buffet</dt><dd><BuffetDoDia buffet={dia.buffetCobrado} /></dd></div>}
                <div><dt>Fonte</dt><dd>{r.fonte === "PDV" ? "PDV (sem os 10%)" : "Planilha do painel (sem os 10%)"}</dd></div>
              </dl>
            ) : <p className="evt-sem">Ainda sem faturamento deste dia.</p>}
          </section>
        </div>

        <form className="evt-bloco" onSubmit={salvar}>
          <h3 className="evt-secao">Decisão do dia</h3>
          <div className="evt-form-linha">
            {/* Com venda no PDV a modalidade sai de lá: vendeu buffet ou não. Escolher só serve para dia sem PDV. */}
            {dia.modalidadePdv ? (
              <div className="evt-preco-pdv">
                <span className="evt-preco-rotulo">Modalidade</span>
                <strong>{MODALIDADE[dia.modalidadePdv]}</strong>
                <small>{dia.buffetCobrado ? "pelo PDV: vendeu buffet" : "pelo PDV: nenhum buffet vendido"}</small>
              </div>
            ) : (
              <Select label="Modalidade" value={modalidade} disabled={!podeEditar} placeholder="Não definida"
                onChange={(e) => setModalidade(e.target.value as ServiceMode | "")} options={opcoes(MODALIDADE)} />
            )}
            {/* Com venda de buffet no PDV o preço vem de lá; digitar só serve para dia sem PDV (planejar ou histórico). */}
            {dia.buffetCobrado ? (
              <div className="evt-preco-pdv">
                <span className="evt-preco-rotulo">Preço do buffet</span>
                <strong>{centavos(dia.buffetCobrado.principal.preco)}</strong>
                <small>cobrado no PDV</small>
              </div>
            ) : (
              <TextField label="Preço do buffet" value={preco} disabled={!podeEditar} inputMode="decimal" placeholder="ex.: 79,90"
                hint="Sem venda de buffet no PDV neste dia: anote o preço planejado ou o que foi cobrado."
                onChange={(e) => setPreco(e.target.value)} />
            )}
          </div>
          <Textarea label="Comentário da gerência" value={notas} disabled={!podeEditar} rows={4} maxLength={4000}
            placeholder="Como foi o dia, parcerias, pacotes, o que fazer da próxima vez…" onChange={(e) => setNotas(e.target.value)} />
          {erro && <Alert tone="error">{erro}</Alert>}
          <div className="evt-form-acoes">
            <Button variant="secondary" onClick={onFechar}>Fechar</Button>
            {podeEditar && <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : "Salvar o dia"}</Button>}
          </div>
        </form>
      </div>
    </Dialog>
  );
}
