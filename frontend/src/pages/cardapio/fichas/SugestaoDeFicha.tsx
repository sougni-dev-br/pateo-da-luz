import { Layers } from "lucide-react";
import type { FichaSuggestion } from "../../../api/client";
import { Button } from "../../../design-system";
import { formatarQuantidade, lerNumero, type ItemDaFicha } from "../../../lib/fichaTecnica";

type Props = {
  sugestoes: FichaSuggestion[];
  itens: ItemDaFicha[];
  /** Os ingredientes como estavam quando a ficha abriu: a sugestão foi calculada sobre eles. */
  originais: ItemDaFicha[];
  onTrocar: (sugestao: FichaSuggestion) => void;
};

/**
 * "Estes ingredientes são a ficha X": o prato repete, na mesma proporção, os ingredientes de uma ficha de produção
 * (a massa do nhoque dividida por 12 à mão). Trocar deixa uma linha só e passa a seguir o custo da ficha.
 * Só aparece enquanto os ingredientes continuam na lista: quem já mexeu neles não recebe uma troca que não vale mais.
 */
export function SugestaoDeFicha({ sugestoes, itens, originais, onTrocar }: Props) {
  const atuais = new Map(itens.map((item) => [item.tempId, item]));
  const deOrigem = new Map(originais.map((item) => [item.tempId, item]));
  // Vale enquanto cada ingrediente continua igual ao que a sugestão comparou: quantidade, unidade e perda.
  // Com perda a troca mudaria o custo (a ficha não leva perda no ingrediente), então nesse caso não é oferecida.
  const intacto = (id: string) => {
    const agora = atuais.get(id);
    const antes = deOrigem.get(id);
    return Boolean(agora && antes && lerNumero(agora.quantity) === lerNumero(antes.quantity) && agora.unit === antes.unit && !(lerNumero(agora.wasteFactor) > 0));
  };
  const validas = sugestoes.filter((sugestao) => sugestao.itemIds.every(intacto));
  if (validas.length === 0) return null;

  return (
    <section className="ft-sugestao-ficha" aria-label="Ingredientes que já são uma ficha de produção">
      {validas.map((sugestao) => {
        const nomes = itens.filter((item) => sugestao.itemIds.includes(item.tempId)).map((item) => item.productName);
        return (
          <div key={sugestao.componentDishId}>
            <p>
              <Layers size={14} aria-hidden /> Estes {nomes.length} ingredientes são a ficha <strong>“{sugestao.name}”</strong>
              {" "}({formatarQuantidade(sugestao.quantity)} {sugestao.unit}). Trocar deixa uma linha só e o custo passa a seguir a ficha: mudou a receita dela, muda aqui.
            </p>
            <ul>{itens.filter((item) => sugestao.itemIds.includes(item.tempId)).map((item) => <li key={item.tempId}>{item.productName}</li>)}</ul>
            <Button size="sm" variant="secondary" onClick={() => onTrocar(sugestao)}>
              Trocar por “{sugestao.name}” ({formatarQuantidade(sugestao.quantity)} {sugestao.unit})
            </Button>
            {sugestao.incompleta && <p className="ft-resumo-aviso">A ficha “{sugestao.name}” ainda está incompleta: o custo desta linha fica sem valor até ela ser completada.</p>}
          </div>
        );
      })}
    </section>
  );
}
