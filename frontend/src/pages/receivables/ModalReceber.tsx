import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { ReceivableView } from "../../api/client";
import { Alert, Button, Money, Select, TextField } from "../../design-system";
import { formatDate, maskMoney, moneyToMasked, numeroBr } from "../../utils/format";
import { Janela } from "../payables/Janela";
import { ORIGEM_ROTULO, tituloDaConta } from "./regras";

export const FORMAS_DE_RECEBIMENTO = ["PIX", "Transferência (TED)", "Dinheiro", "Repasse da plataforma", "Outro"];

export type ValoresDoRecebimento = {
  receivedDate: string;
  paidAmount: number;
  paymentMethod: string;
  notes: string;
  differenceReason: string;
};

type Props = {
  conta: ReceivableView;
  hoje: string;
  onFechar: () => void;
  onConfirmar: (valores: ValoresDoRecebimento) => Promise<void>;
};

const TOLERANCIA = 0.005;

/** Forma inicial: a que a conta já traz (se conhecida) ou a mais provável para a origem. */
function formaInicial(conta: ReceivableView): string {
  const daConta = FORMAS_DE_RECEBIMENTO.find((f) => f === conta.paymentMethod);
  if (daConta) return daConta;
  return conta.sourceType === "EVENT" || conta.sourceType === "DIRECT" || conta.sourceType === "OTHER" ? "PIX" : "Repasse da plataforma";
}

export function ModalReceber({ conta, hoje, onFechar, onConfirmar }: Props) {
  const saldo = conta.remainingAmount || conta.netAmount;
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState(moneyToMasked(saldo));
  const [forma, setForma] = useState(formaInicial(conta));
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recebido = numeroBr(valor);
  const passaDoSaldo = recebido > saldo + TOLERANCIA;
  const falta = Math.max(0, saldo - recebido);
  const dataInvalida = !data || data > hoje;
  const invalido = recebido <= 0 || dataInvalida || (passaDoSaldo && !motivo.trim());
  const parcela = conta.installmentNumber && conta.totalInstallments ? `${conta.installmentNumber}/${conta.totalInstallments}` : null;

  async function confirmar() {
    if (invalido || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar({ receivedDate: data, paidAmount: recebido, paymentMethod: forma, notes: obs.trim(), differenceReason: passaDoSaldo ? motivo.trim() : "" });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar o recebimento.");
      setEnviando(false);
    }
  }

  return (
    <Janela eyebrow="Registrar recebimento" titulo={tituloDaConta(conta.description)} onFechar={onFechar} ocupado={enviando} largura="estreita">
      {erro && <Alert tone="error" role="alert">{erro}</Alert>}

      <div className="pay-ctx">
        <div className="pay-ctx-row">
          <div><span>Origem</span><strong>{ORIGEM_ROTULO[conta.sourceType]}</strong></div>
          {parcela && <div><span>Parcela</span><strong>{parcela}</strong></div>}
          <div><span>Previsto</span><strong>{formatDate(conta.expectedDate)}</strong></div>
          {conta.status === "PARTIALLY_RECEIVED" && <div><span>Já recebido</span><strong><Money value={conta.paidAmount ?? 0} /></strong></div>}
          <div className="pg-ctx-valor"><span>{conta.status === "PARTIALLY_RECEIVED" ? "Falta receber" : "Valor da conta"}</span><strong className="pay-ctx-amount"><Money value={saldo} /></strong></div>
        </div>
      </div>

      <div className="form-grid payment-grid rc-form">
        <TextField
          label="Data do recebimento *"
          type="date"
          max={hoje}
          value={data}
          onChange={(e) => setData(e.target.value)}
          error={dataInvalida ? (data ? "A data não pode ser futura." : "Informe a data.") : undefined}
        />
        <div className="rc-valor">
          <TextField
            label="Valor recebido *"
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            onChange={(e) => setValor(maskMoney(e.target.value))}
            error={recebido <= 0 ? "Informe um valor maior que zero." : undefined}
          />
          {Math.abs(recebido - saldo) > TOLERANCIA && (
            <button type="button" className="pg-link" onClick={() => setValor(moneyToMasked(saldo))}>Usar o saldo todo</button>
          )}
        </div>
        <Select label="Forma de recebimento" value={forma} onChange={(e) => setForma(e.target.value)} options={FORMAS_DE_RECEBIMENTO.map((f) => ({ value: f, label: f }))} />
        <TextField label="Observação" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} />
      </div>

      {passaDoSaldo && (
        <TextField
          label="Motivo da diferença *"
          value={motivo}
          maxLength={300}
          onChange={(e) => setMotivo(e.target.value)}
          hint="O valor passa do que falta receber. Explique a diferença (ex.: ajuste da plataforma)."
          error={!motivo.trim() ? "Informe o motivo para registrar um valor acima do saldo." : undefined}
        />
      )}

      <p className="pay-confirm-phrase" aria-live="polite">
        {recebido <= 0
          ? "Informe o valor recebido."
          : passaDoSaldo
            ? <>Você está registrando <strong><Money value={recebido} /></strong>, <strong><Money value={recebido - saldo} /></strong> acima do saldo.</>
            : falta > TOLERANCIA
              ? <>Você está registrando <strong><Money value={recebido} /></strong>. Depois disso, <strong><Money value={falta} /></strong> ficam a receber.</>
              : <>Você está registrando <strong><Money value={recebido} /></strong>. Isso quita a conta.</>}
      </p>

      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>Cancelar</Button>
        <Button leadingIcon={<CheckCircle2 size={16} />} onClick={() => void confirmar()} disabled={invalido || enviando} aria-busy={enviando}>
          {enviando ? "Registrando…" : "Confirmar recebimento"}
        </Button>
      </div>
    </Janela>
  );
}
