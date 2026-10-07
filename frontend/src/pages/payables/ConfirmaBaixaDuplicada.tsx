import { AlertTriangle } from "lucide-react";
import { Alert, Button } from "../../design-system";
import { descreverExistente, descreverSuspeito, fraseJaPago, type RecusaFolha } from "../../lib/folha-duplicidade";
import { Janela } from "./Janela";

type Props = {
  recusa: RecusaFolha;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
};

// Baixa individual de um título da folha cujo mesmo pagamento (pessoa + tipo + mês,
// + quinzena no VT) já foi pago em outro título. Só baixa com a confirmação, que vai
// para a auditoria.
export function ConfirmaBaixaDuplicada({ recusa, enviando, onCancelar, onConfirmar }: Props) {
  const pagos = recusa.jaPagos ?? [];
  // Título do lote da folha: todos os membros suspeitos; confirmar vale para todos os listados.
  const suspeitos = recusa.suspeitos ?? [];
  const frase = suspeitos.length > 0 ? recusa.message : pagos[0] ? fraseJaPago(recusa.pessoa ?? "", pagos[0]) : recusa.message;
  return (
    <Janela eyebrow="Baixa em duplicidade" titulo="Este pagamento já foi feito?" onFechar={onCancelar} ocupado={enviando} largura="estreita">
      <Alert tone="warning">{frase}</Alert>
      {suspeitos.length > 0 && (
        <ul className="pg-lote-erros" aria-label="Pessoas com o pagamento já feito">
          {suspeitos.map((x) => <li key={x.item.id ?? x.pessoa}>{descreverSuspeito(x)}</li>)}
        </ul>
      )}
      {suspeitos.length === 0 && pagos.length > 1 && (
        <ul className="pg-lote-erros" aria-label="Pagamentos já feitos">
          {pagos.map((p) => <li key={p.id ?? p.rotulo ?? ""}>{descreverExistente(p)}</li>)}
        </ul>
      )}
      <p className="pg-nota">Confirmando, a baixa é registrada e a confirmação fica na auditoria.</p>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onCancelar} disabled={enviando}>Não baixar</Button>
        <Button leadingIcon={<AlertTriangle size={16} />} onClick={onConfirmar} disabled={enviando}>
          {enviando ? "Registrando…" : "Baixar mesmo assim"}
        </Button>
      </div>
    </Janela>
  );
}
