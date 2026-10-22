import { useEffect, useState } from "react";
import { getCardFinalSugerido, type CreditCard } from "../../api/client";
import { rotuloDoFinal, tipoDoFinal } from "./cartoes-vinculados";

type Props = {
  cartao: CreditCard | undefined;
  fornecedor: string;
  /** Id do cartão (físico/virtual) escolhido; "" = definir depois, na fatura. */
  valor: string;
  onChange: (cardFinalId: string) => void;
};

// Escolha opcional do cartão usado na compra. Quem não sabe qual foi deixa em
// branco e classifica depois, dentro da fatura; nunca trava o lançamento.
export function CartaoDaCompra({ cartao, fornecedor, valor, onChange }: Props) {
  const finais = (cartao?.finais ?? []).filter((final) => final.isActive);
  const [sugerido, setSugerido] = useState<string | null>(null);

  useEffect(() => {
    setSugerido(null);
    if (!cartao || finais.length === 0 || !fornecedor) return;
    let cancelado = false;
    getCardFinalSugerido(cartao.id, fornecedor)
      .then((resposta) => {
        if (!cancelado) setSugerido(resposta.cardFinalId);
      })
      .catch(() => {
        if (!cancelado) setSugerido(null);
      });
    return () => {
      cancelado = true;
    };
    // finais.length muda só quando o cadastro muda; o cartão e o fornecedor definem a sugestão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartao?.id, fornecedor, finais.length]);

  if (!cartao || finais.length === 0) return null;
  const sugestao = finais.find((final) => final.id === sugerido);

  return (
    <label>
      Cartão usado (opcional)
      <select value={valor} onChange={(event) => onChange(event.target.value)}>
        <option value="">Não sei / definir depois na fatura</option>
        {finais.map((final) => (
          <option key={final.id} value={final.id}>{tipoDoFinal(final.kind)} — {rotuloDoFinal(final)}</option>
        ))}
      </select>
      {sugestao && !valor && (
        <small>
          Na última compra deste fornecedor foi o {tipoDoFinal(sugestao.kind).toLowerCase()}.{" "}
          <button type="button" onClick={() => onChange(sugestao.id)}>Usar {rotuloDoFinal(sugestao)}</button>
        </small>
      )}
    </label>
  );
}
