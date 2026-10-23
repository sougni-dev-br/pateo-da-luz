import { useState, type ReactNode } from "react";
import { Alert, Button } from "../../design-system";
import { Janela } from "../payables/Janela";

type Props = {
  eyebrow: string;
  titulo: string;
  /** Resumo do que será afetado (valor, datas…), no mesmo quadro das outras janelas. */
  contexto?: ReactNode;
  nota: string;
  rotuloMotivo: string;
  placeholder: string;
  rotuloConfirmar: string;
  rotuloEnviando: string;
  icone: ReactNode;
  onFechar: () => void;
  onConfirmar: (motivo: string) => Promise<void>;
};

const MINIMO = 3;

/** Janela de ação que desfaz algo (cancelar conta, estornar recebimento): o motivo é obrigatório e vai para a auditoria. */
export function ModalMotivo({ eyebrow, titulo, contexto, nota, rotuloMotivo, placeholder, rotuloConfirmar, rotuloEnviando, icone, onFechar, onConfirmar }: Props) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const valido = motivo.trim().length >= MINIMO;

  async function confirmar() {
    if (!valido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar(motivo.trim());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir a ação.");
      setEnviando(false);
    }
  }

  return (
    <Janela eyebrow={eyebrow} titulo={titulo} onFechar={onFechar} ocupado={enviando} largura="estreita">
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}
      {contexto && <div className="pay-ctx"><div className="pay-ctx-row">{contexto}</div></div>}
      <p className="pg-nota">{nota}</p>
      <label className="pg-campo-texto rc-motivo">
        <span>{rotuloMotivo} *</span>
        <textarea rows={3} maxLength={300} placeholder={placeholder} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      </label>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>Voltar</Button>
        <Button variant="danger" leadingIcon={icone} disabled={!valido || enviando} aria-busy={enviando} onClick={() => void confirmar()}>
          {enviando ? rotuloEnviando : rotuloConfirmar}
        </Button>
      </div>
    </Janela>
  );
}
