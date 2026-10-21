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
  /** Conferência em vez de justificativa: o texto diz o que foi conferido. */
  conferencia?: boolean;
};

const MINIMO = 10;

export function JustificarDialog({ aberto, pendencia, enviando, onCancelar, onConfirmar, conferencia }: Props) {
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
      title={conferencia ? "Registrar conferência" : "Justificar pendência"}
      description={conferencia
        ? "A conferência fica registrada na auditoria do fechamento."
        : "O motivo fica registrado na auditoria do fechamento."}
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
          <span>{conferencia ? "O que foi conferido" : "Motivo"}</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            autoFocus
            placeholder={conferencia
              ? "Ex.: conferi a agenda de eventos do mês; os 3 eventos estão lançados."
              : "Ex.: nota do condomínio ainda não emitida pelo shopping; será lançada em julho."}
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
            {enviando ? "Registrando…" : conferencia ? "Registrar conferência" : "Registrar justificativa"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
