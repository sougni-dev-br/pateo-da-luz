import { useState } from "react";
import type { CreditCardStatement } from "../../api/client";
import { Button } from "../../design-system";
import { Dialog } from "../../components/ui/Dialog";
import { ajudaDaJustificativa, JUSTIFICATIVA_MAXIMA, justificativaValida } from "./justificativa-reabertura";
import "./creditos-da-fatura.css";

type Props = {
  fatura: CreditCardStatement;
  onConfirmar: (justificativa: string) => Promise<void>;
  onCancelar: () => void;
};

export function ReabrirFaturaDialog({ fatura, onConfirmar, onCancelar }: Props) {
  const [texto, setTexto] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const paga = fatura.status === "PAID";
  const ajuda = ajudaDaJustificativa(texto);

  async function confirmar(event: React.FormEvent) {
    event.preventDefault();
    setTentou(true);
    if (!justificativaValida(texto) || salvando) return;
    setSalvando(true);
    try {
      await onConfirmar(texto.trim());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => { if (!aberto && !salvando) onCancelar(); }}
      title={`Reabrir fatura ${String(fatura.competenceMonth).padStart(2, "0")}/${fatura.competenceYear}`}
      description="O título desta fatura no Contas a pagar será cancelado e a fatura volta a ficar aberta."
      size="md"
    >
      <form className="fatura-creditos-form" onSubmit={(event) => void confirmar(event)} noValidate>
        {paga && <p>Fatura paga: só reabre se nenhuma parcela do título tiver sido baixada.</p>}
        <label className="fatura-creditos-campo">
          Justificativa da reabertura
          <textarea
            value={texto}
            maxLength={JUSTIFICATIVA_MAXIMA}
            rows={4}
            autoFocus
            aria-invalid={tentou && !justificativaValida(texto)}
            onChange={(event) => setTexto(event.target.value)}
            placeholder="Ex.: valor da compra lançado diferente do cobrado pelo banco"
          />
          <small>Fica registrada na fatura e na auditoria, com seu nome e a data.</small>
          {tentou && ajuda && <small role="alert">{ajuda}</small>}
        </label>
        <div className="fatura-creditos-rodape">
          <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando ? "Reabrindo…" : "Reabrir fatura"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
