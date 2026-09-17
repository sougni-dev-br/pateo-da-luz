// Justificar uma pendência do fechamento.
//
// Antes isto era um `window.prompt`. O texto entra no AuditLog e é o que
// sustenta o fechamento perante a contabilidade — capturá-lo num popup nativo
// significava: sem ver o que se está justificando, sem limite, sem poder
// revisar antes de enviar, e no celular um alerta do sistema operacional.
//
// Aqui o que se justifica fica à vista enquanto se escreve.

import { useEffect, useState } from "react";
import { Button } from "../../design-system";
import { Dialog } from "../ui";

type Props = {
  aberto: boolean;
  /** O que está sendo justificado, mostrado durante a escrita. */
  pendencia: string | null;
  enviando?: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
};

const MINIMO = 10;

export function JustificarDialog({ aberto, pendencia, enviando, onCancelar, onConfirmar }: Props) {
  const [motivo, setMotivo] = useState("");

  // Limpar ao abrir, não ao fechar: fechar e reabrir na mesma pendência deve
  // começar em branco, mas o texto não pode sumir enquanto o envio acontece.
  useEffect(() => {
    if (aberto) setMotivo("");
  }, [aberto, pendencia]);

  const limpo = motivo.trim();
  const curto = limpo.length > 0 && limpo.length < MINIMO;
  const podeEnviar = limpo.length >= MINIMO && !enviando;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => { if (!v) onCancelar(); }}
      title="Justificar pendência"
      description="O motivo fica registrado na auditoria do fechamento."
      size="md"
    >
      <div className="just-dialog">
        {pendencia && (
          <p className="just-dialog-alvo">
            <span>Pendência</span>
            <strong>{pendencia}</strong>
          </p>
        )}

        <label className="just-dialog-campo">
          <span>Motivo</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Ex.: nota do condomínio ainda não emitida pelo shopping; será lançada em julho."
            aria-invalid={curto || undefined}
          />
        </label>

        <p className={`just-dialog-ajuda${curto ? " invalido" : ""}`}>
          {curto
            ? `Escreva pelo menos ${MINIMO} caracteres — quem ler daqui a seis meses precisa entender.`
            : "Quem ler daqui a seis meses precisa entender sem perguntar."}
        </p>

        <div className="just-dialog-acoes">
          <Button variant="secondary" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => onConfirmar(limpo)} disabled={!podeEnviar}>
            {enviando ? "Registrando…" : "Registrar justificativa"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
