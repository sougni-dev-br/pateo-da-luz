import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { markReceivableReceived, type ReceivableView } from "../../api/client";
import { Alert, Button, Money, Select, TextField } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Janela } from "../payables/Janela";
import { FORMAS_DE_RECEBIMENTO } from "./ModalReceber";
import { ORIGEM_ROTULO, tituloDaConta } from "./regras";

type Props = {
  contas: ReceivableView[];
  hoje: string;
  onFechar: () => void;
  /** Chamado ao terminar (mesmo com falhas) para a tela recarregar. */
  onConcluir: (resumo: { feitas: number; falhas: string[] }) => void;
};

/** Registra o recebimento do saldo de várias contas de uma vez (ex.: as faturas da semana que caíram juntas). */
export function ModalLote({ contas, hoje, onFechar, onConcluir }: Props) {
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("Repasse da plataforma");
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [falhas, setFalhas] = useState<string[]>([]);
  const total = Math.round(contas.reduce((s, c) => s + Math.round(c.remainingAmount * 100), 0)) / 100;
  const dataInvalida = !data || data > hoje;

  async function confirmar() {
    if (dataInvalida || enviando) return;
    setEnviando(true);
    setFalhas([]);
    const erros: string[] = [];
    let feitas = 0;
    for (const c of contas) {
      try {
        await markReceivableReceived(c.id, { receivedDate: data, paidAmount: c.remainingAmount, paymentMethod: forma });
        feitas += 1;
      } catch (e) {
        erros.push(`${tituloDaConta(c.description)}: ${e instanceof Error ? e.message : "falhou"}`);
      }
      setProgresso((p) => p + 1);
    }
    setFalhas(erros);
    if (erros.length === 0) {
      onConcluir({ feitas, falhas: [] });
      return;
    }
    setEnviando(false);
    onConcluir({ feitas, falhas: erros });
  }

  const terminou = progresso > 0 && !enviando;

  return (
    <Janela eyebrow="Receber em lote" titulo={`${contas.length} ${contas.length === 1 ? "conta" : "contas"} selecionadas`} onFechar={onFechar} ocupado={enviando} largura="media">
      <div className="pg-lote-resumo">
        <div>
          <span>Total a registrar</span>
          <strong className="pg-lote-total"><Money value={total} /></strong>
        </div>
        <div className="pg-lote-resumo-meta"><span>Cada conta é recebida pelo seu saldo.</span></div>
      </div>

      <div className="form-grid rc-form">
        <TextField label="Data do recebimento *" type="date" max={hoje} value={data} onChange={(e) => setData(e.target.value)} error={dataInvalida ? "A data não pode ser futura." : undefined} disabled={enviando || terminou} />
        <Select label="Forma de recebimento" value={forma} onChange={(e) => setForma(e.target.value)} options={FORMAS_DE_RECEBIMENTO.map((f) => ({ value: f, label: f }))} disabled={enviando || terminou} />
      </div>

      <ul className="pg-lote-lista" aria-label="Contas que serão recebidas">
        {contas.map((c) => (
          <li key={c.id}>
            <span className="pg-lote-nome">{tituloDaConta(c.description)} <small>({ORIGEM_ROTULO[c.sourceType]})</small></span>
            <span className="pg-lote-venc">{formatDate(c.expectedDate)}</span>
            <strong className="pg-num"><Money value={c.remainingAmount} /></strong>
          </li>
        ))}
      </ul>

      {enviando && <p className="pg-nota" role="status">Registrando {progresso} de {contas.length}…</p>}
      {falhas.length > 0 && (
        <Alert tone="error" role="alert">
          {contas.length - falhas.length} de {contas.length} registradas. Não foi possível registrar:
          <ul className="pg-lote-erros">{falhas.map((f) => <li key={f}>{f}</li>)}</ul>
        </Alert>
      )}

      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>{terminou ? "Fechar" : "Cancelar"}</Button>
        {!terminou && (
          <Button leadingIcon={<CheckCircle2 size={16} />} onClick={() => void confirmar()} disabled={dataInvalida || enviando} aria-busy={enviando}>
            {enviando ? "Registrando…" : "Confirmar recebimentos"}
          </Button>
        )}
      </div>
    </Janela>
  );
}
