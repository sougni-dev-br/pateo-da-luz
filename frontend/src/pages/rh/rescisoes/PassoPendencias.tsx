// Passo 3: o que resolver antes de lançar, cada item com o que fazer e o atalho para a
// rotina. Excluir um lançamento da Folha pede motivo (fica na auditoria).
import { ExternalLink, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { deletePayrollItem } from "../../../api/client";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, FormField, Money, Textarea } from "../../../design-system";
import { hasPermission } from "../../../lib/permissions";
import type { NumeroPasso } from "./AssistenteRescisao";
import type { Pendencia, TomPendencia } from "./pendencias";

const MOTIVO_MINIMO = 3;
const ROTULO_TOM: Record<TomPendencia, string> = { acao: "Resolver", aviso: "Conferir", ok: "Certo" };

type Props = { pendencias: Pendencia[]; onMudou: () => void; onPasso: (n: NumeroPasso) => void };

function ConfirmarExclusao({ acao, id, onFechar, onExcluiu }: {
  acao: Extract<Pendencia["acao"], { tipo: "excluir" }>; id: string; onFechar: () => void; onExcluiu: () => void;
}) {
  const [motivo, setMotivo] = useState(acao.motivoSugerido);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    if (motivo.trim().length < MOTIVO_MINIMO) { setErro(`Explique em pelo menos ${MOTIVO_MINIMO} letras.`); return; }
    setOcupado(true);
    setErro(null);
    try {
      await deletePayrollItem(acao.itemId, motivo.trim());
      onFechar();
      onExcluiu();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui excluir o lançamento.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="rr-pendencia-confirmar" id={id}>
      <FormField label="Motivo da exclusão (fica na auditoria)" required error={erro ?? undefined}>
        <Textarea rows={2} value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(null); }} autoFocus />
      </FormField>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="danger" onClick={() => void confirmar()} disabled={ocupado}>{ocupado ? "Excluindo…" : "Confirmar exclusão"}</Button>
        <Button size="sm" variant="secondary" onClick={onFechar} disabled={ocupado}>Desistir</Button>
      </div>
    </div>
  );
}

function ItemPendencia({ pendencia: p, podeExcluir, onMudou, onPasso }: {
  pendencia: Pendencia; podeExcluir: boolean; onMudou: () => void; onPasso: (n: NumeroPasso) => void;
}) {
  const [excluindo, setExcluindo] = useState(false);
  const id = useId();
  const excluir = p.acao?.tipo === "excluir" ? p.acao : null;
  return (
    <li className={`rr-pendencia rr-pendencia--${p.tom}`}>
      <div className="rr-pendencia-texto">
        <span className="rr-tom">{ROTULO_TOM[p.tom]}</span>
        <strong>{p.titulo}{p.valor != null && <> · <Money value={p.valor} /></>}</strong>
        {p.detalhe && <span className="rr-sub">{p.detalhe}</span>}
        <span className="rr-pendencia-fazer">{p.oQueFazer}</span>
      </div>
      <div className="rr-pendencia-acoes">
        <Acao pendencia={p} onPasso={onPasso} />
        {excluir && !excluindo && (
          <Button size="sm" variant="danger" leadingIcon={<Trash2 size={14} />} disabled={!podeExcluir}
            title={podeExcluir ? undefined : "Excluir lançamento da Folha exige a permissão de excluir na Folha"}
            aria-expanded={false} aria-controls={id} onClick={() => setExcluindo(true)}>
            {excluir.rotulo}
          </Button>
        )}
      </div>
      {excluir && excluindo && <ConfirmarExclusao acao={excluir} id={id} onFechar={() => setExcluindo(false)} onExcluiu={onMudou} />}
    </li>
  );
}

function Acao({ pendencia, onPasso }: { pendencia: Pendencia; onPasso: (n: NumeroPasso) => void }) {
  const a = pendencia.acao;
  if (!a || a.tipo === "excluir") return null;
  if (a.tipo === "link") {
    return <Link className="rr-link-botao" to={a.para}>{a.rotulo} <ExternalLink size={13} aria-hidden="true" /></Link>;
  }
  return <Button size="sm" variant="secondary" onClick={() => onPasso(a.passo)}>{a.rotulo}</Button>;
}

export function PassoPendencias({ pendencias, onMudou, onPasso }: Props) {
  const { user } = useSession();
  const podeExcluir = hasPermission(user, "payroll", "delete");
  const resolver = pendencias.filter((p) => p.tom === "acao").length;
  const conferir = pendencias.filter((p) => p.tom === "aviso").length;

  return (
    <section className="rr-corpo" aria-labelledby="rr-p3">
      <h3 id="rr-p3">3. Pendências antes de lançar</h3>
      {pendencias.length === 0 ? (
        <Alert tone="success">Nada pendente: vales, Folha, gorjeta e VT estão em ordem para lançar.</Alert>
      ) : (
        <p className="rr-ajuda" aria-live="polite">
          {resolver > 0 ? `${resolver} para resolver` : "Nada para resolver"}
          {conferir > 0 ? ` · ${conferir} para conferir` : ""}. Lançar com pendência é possível, mas o que ficar aberto pode pagar duas vezes.
        </p>
      )}
      <ul className="rr-pendencias">
        {pendencias.map((p) => (
          <ItemPendencia key={p.id} pendencia={p} podeExcluir={podeExcluir} onMudou={onMudou} onPasso={onPasso} />
        ))}
      </ul>
    </section>
  );
}
