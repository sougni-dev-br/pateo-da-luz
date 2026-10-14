import type { ReactNode } from "react";
import type { DishProductSearchResult } from "../../../api/client";
import { chaveDoIngrediente, type ErroDoItem, type ItemDaFicha } from "../../../lib/fichaTecnica";
import { BuscaDeIngrediente } from "./BuscaDeIngrediente";
import { LinhaDeIngrediente } from "./LinhaDeIngrediente";

type Props = {
  titulo: string;
  /** Distingue as duas listas do prato nos dois cardápios (ids e rótulos). */
  idBase: string;
  rotuloDaBusca?: string;
  /** A ficha em edição: ela não pode aparecer na busca de fichas de produção (não se usa a si mesma). */
  excluirId?: string;
  itens: ItemDaFicha[];
  repetidos: Map<string, number>;
  idsNaFicha: Set<string>;
  erros: Record<string, ErroDoItem>;
  /** Erro da lista inteira (ex.: nenhuma quantidade do delivery). */
  erroDaLista?: string;
  /** Explica de onde vêm as quantidades desta lista. */
  descricao?: ReactNode;
  /** Botões extras no alto da seção (ex.: começar da ficha do a la carte). */
  acoes?: ReactNode;
  onAdicionar: (produto: DishProductSearchResult) => void;
  onAlterar: (tempId: string, campo: "quantity" | "unit" | "wasteFactor", valor: string) => void;
  onRemover: (tempId: string) => void;
  onInformarConversao: (productId: string, unidade: string, quantidade: number, substituir?: boolean) => Promise<void>;
};

/** Lista de ingredientes de uma ficha: busca, linhas editáveis e o aviso de lista vazia. */
export function SecaoDeIngredientes({
  titulo, idBase, rotuloDaBusca, excluirId, itens, repetidos, idsNaFicha, erros, erroDaLista, descricao, acoes,
  onAdicionar, onAlterar, onRemover, onInformarConversao
}: Props) {
  const idDoTitulo = `ft-ingredientes-${idBase}`;
  return (
    <section className="ft-secao" aria-labelledby={idDoTitulo}>
      <h3 id={idDoTitulo} className="ft-secao-titulo">
        {titulo} <span className="ft-secao-n">{itens.length}</span>
      </h3>
      {descricao && <p className="ft-nota">{descricao}</p>}
      {acoes && <div className="ft-secao-acoes">{acoes}</div>}

      <BuscaDeIngrediente
        jaNaFicha={idsNaFicha}
        onEscolher={onAdicionar}
        idDoCampo={idBase === "salao" ? undefined : `ft-busca-ingrediente-${idBase}`}
        rotulo={rotuloDaBusca}
        excluirId={excluirId}
      />

      {erroDaLista && <p className="ft-resumo-aviso ft-resumo-aviso--erro" role="alert">{erroDaLista}</p>}

      {itens.length === 0 ? (
        <p className="ft-vazio-ingredientes">
          Nenhum ingrediente ainda. Busque o produto (ou uma ficha de produção, como a massa de um nhoque) acima, informe a quantidade e a unidade em que ele entra na receita.
        </p>
      ) : (
        <>
          <div className="ft-ingredientes-cabecalho" aria-hidden>
            <span>Ingrediente</span><span>Quantidade</span><span>Unidade</span><span>Perda %</span><span>Custo</span><span />
          </div>
          <ul className="ft-ingredientes-lista">
            {itens.map((item) => (
              <LinhaDeIngrediente
                key={item.tempId}
                item={item}
                erro={erros[item.tempId]}
                repetido={(repetidos.get(chaveDoIngrediente(item)) ?? 0) > 1}
                onAlterar={onAlterar}
                onRemover={onRemover}
                onInformarConversao={onInformarConversao}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
