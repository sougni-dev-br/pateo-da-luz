// Passo 4: conferir e lançar no Contas a Pagar. O formulário é o mesmo de antes (parcelas,
// vencimento, justificativa quando o lançado diverge do apurado, ajuste depois de lançada).
import type { TermoRescisaoResumo } from "../../../api/client";
import { type FuncionarioDaRescisao, RescisaoFormulario } from "../../../components/pessoal/RescisaoFormulario";
import { Alert, Button, Money } from "../../../design-system";
import type { NumeroPasso } from "./AssistenteRescisao";

type Props = {
  funcionario: FuncionarioDaRescisao;
  termo: TermoRescisaoResumo | null;
  pendenciasParaAcao: number;
  /** Registrada como quitada no termo (líquido zero): nada a lançar. */
  quitadaNoTermo?: boolean;
  onPasso: (n: NumeroPasso) => void;
  onGravou: () => void;
};

export function PassoLancar({ funcionario, termo, pendenciasParaAcao, quitadaNoTermo, onPasso, onGravou }: Props) {
  if (quitadaNoTermo) {
    return (
      <section className="rr-corpo" aria-labelledby="rr-p4">
        <h3 id="rr-p4">4. Conferir e lançar</h3>
        <Alert tone="success">
          Quitada no termo: o líquido do termo é zero, não há o que lançar nem pagar. Para desfazer, volte ao passo 2.{" "}
          <Button size="sm" variant="secondary" onClick={() => onPasso(2)}>Ver o passo 2</Button>
        </Alert>
      </section>
    );
  }
  return (
    <section className="rr-corpo" aria-labelledby="rr-p4">
      <h3 id="rr-p4">4. Conferir e lançar</h3>
      <p className="rr-ajuda">
        {funcionario.semRegistro
          ? "Os campos vêm preenchidos com o apurado. Mudou algum valor? O sistema pede justificativa e guarda o apurado ao lado."
          : "Digite o bruto do termo (a gorjeta já vem nele). O VT a descontar vem do sistema."}
        {" "}Liberar cria os títulos em Contas a Pagar; acordo pode ser dividido em parcelas mensais.
      </p>
      {pendenciasParaAcao > 0 && (
        <Alert tone="warning">
          Ainda há {pendenciasParaAcao} {pendenciasParaAcao === 1 ? "pendência" : "pendências"} para resolver no passo 3.{" "}
          <Button size="sm" variant="secondary" onClick={() => onPasso(3)}>Ver pendências</Button>
        </Alert>
      )}
      {!funcionario.semRegistro && termo?.liquido != null && (
        <Alert tone="info">Líquido no termo: <Money value={termo.liquido} />. Confira com o líquido abaixo depois de digitar o bruto e o VT.</Alert>
      )}
      <RescisaoFormulario funcionario={funcionario} onGravou={onGravou} />
    </section>
  );
}
