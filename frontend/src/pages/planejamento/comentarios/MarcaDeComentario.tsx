import { MessageSquare, Plus } from "lucide-react";
import type { PontoDeComentario } from "./ponto";
import { chaveDoPonto, rotuloDoPonto, textoDaContagem } from "./ponto";
import type { LigacaoDeComentarios } from "./ligacao";

// Marca de um ponto do quadro: com comentário vira um botão com a contagem (parada de Tab); sem comentário, quem
// pode escrever ganha um "+" que só aparece ao passar o mouse e fica fora do Tab (a barra tem o botão "Comentar").

type Props = { ligacao: LigacaoDeComentarios | undefined; ponto: PontoDeComentario; anoComparado: number };

export function MarcaDeComentario({ ligacao, ponto, anoComparado }: Props) {
  if (!ligacao) return null;
  const quantidade = ligacao.porPonto.get(chaveDoPonto(ponto))?.length ?? 0;
  const rotulo = rotuloDoPonto(ponto, anoComparado);
  if (quantidade > 0) {
    return (
      <button type="button" className="plan-coment-marca plan-coment-marca-cheia" onClick={() => ligacao.abrir(ponto)} aria-label={`${textoDaContagem(quantidade)} em ${rotulo}. Abrir`}>
        <MessageSquare size={14} aria-hidden /> <span aria-hidden>{quantidade}</span>
      </button>
    );
  }
  if (!ligacao.podeEscrever) return null;
  return (
    <button type="button" className="plan-coment-marca plan-coment-marca-vazia" tabIndex={-1} aria-hidden onClick={() => ligacao.abrir(ponto)}>
      <Plus size={14} aria-hidden />
    </button>
  );
}
