import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { payTaxPayment, type TaxPayment } from "../../api/client";
import { Button, FormField, FormGrid, Money, TextField, Textarea } from "../../design-system";
import { formatarDiaDaGuia } from "../../lib/guia-imposto";
import { moneyToMasked, maskMoney, numeroBr } from "../../utils/format";
import { Janela } from "../payables/Janela";
import { mesDaData, rotuloMes } from "./regras";
import "../payables/payables.css";
import "./tax-payments.css";

type Props = {
  guia: TaxPayment;
  hoje: string;
  onFechar: () => void;
  onPago: (mensagem: string) => void;
};

const TOLERANCIA = 0.009;

// Dar baixa é registrar que a guia foi paga: tira dos vencidos e do "a pagar", e o desembolso
// entra no mês da data do pagamento. Quem paga e estorna é esta ação, não a edição da guia.
export function ModalPagar({ guia, hoje, onFechar, onPago }: Props) {
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState(moneyToMasked(guia.amount));
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const original = Number(guia.amount);
  const pago = numeroBr(valor);
  const diferenca = Number((pago - original).toFixed(2));
  const temDiferenca = Math.abs(diferenca) > TOLERANCIA;
  const competencia = guia.competenceDate ? rotuloMes(mesDaData(guia.competenceDate)) : "";

  async function confirmar() {
    if (!data) return setErro("Informe a data do pagamento.");
    if (!(pago > 0)) return setErro("Informe o valor pago.");
    setEnviando(true);
    setErro(null);
    try {
      await payTaxPayment(guia.id, { paymentDate: data, paidAmount: pago, comments: obs.trim() || null });
      onPago(`${guia.documentType}${competencia ? ` de ${competencia}` : ""} marcada como paga em ${formatarDiaDaGuia(data)}.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível dar baixa.");
      setEnviando(false);
    }
  }

  return (
    <Janela eyebrow="Pagar guia" titulo={`${guia.documentType}${competencia ? ` · ${competencia}` : ""}`} onFechar={onFechar} ocupado={enviando} largura="estreita">
      <div className="ip-pagar-ctx">
        <div>
          <span className="ip-rotulo">Valor da guia</span>
          <strong><Money value={original} /></strong>
        </div>
        <div>
          <span className="ip-rotulo">Vencimento</span>
          <strong>{formatarDiaDaGuia(guia.dueDate)}</strong>
        </div>
      </div>

      <FormGrid cols={2}>
        <FormField label="Data do pagamento" required>
          <TextField type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Valor pago" required hint="Com juros e multa, se houve.">
          <TextField inputMode="decimal" value={valor} onChange={(e) => setValor(maskMoney(e.target.value))} />
        </FormField>
      </FormGrid>

      {temDiferenca && (
        <p className={`ip-diferenca ${diferenca > 0 ? "ip-diferenca--mais" : "ip-diferenca--menos"}`} role="status">
          {diferenca > 0 ? "Acima" : "Abaixo"} do valor da guia em <Money value={Math.abs(diferenca)} />
          {diferenca > 0 ? " (juros ou multa)." : "."}
        </p>
      )}

      <FormField label="Observação (opcional)">
        <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      </FormField>

      <p className="ip-confirma">
        <CheckCircle2 size={16} aria-hidden="true" />
        A guia sai dos vencidos e de Contas a Pagar em aberto. O pagamento fica registrado no mês de {formatarDiaDaGuia(data)}.
      </p>

      {erro && <p className="field-hint field-hint--alerta" role="alert">{erro}</p>}

      <div className="modal-actions">
        <Button variant="secondary" onClick={onFechar} disabled={enviando}>Cancelar</Button>
        <Button onClick={() => void confirmar()} disabled={enviando}>{enviando ? "Registrando…" : "Confirmar pagamento"}</Button>
      </div>
    </Janela>
  );
}
