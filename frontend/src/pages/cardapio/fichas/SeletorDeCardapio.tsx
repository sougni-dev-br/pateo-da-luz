import { DESCRICAO_DO_CARDAPIO, ROTULO_DO_CARDAPIO, type FiltroDeCardapio } from "../../../lib/categoriasDasFichas";

type Props = {
  valor: FiltroDeCardapio;
  contagem: Record<FiltroDeCardapio, number>;
  onChange: (valor: FiltroDeCardapio) => void;
};

const OPCOES: Array<{ valor: FiltroDeCardapio; rotulo: string; dica: string }> = [
  { valor: "todos", rotulo: "Todos", dica: "Salão e delivery juntos" },
  { valor: "CARDAPIO", rotulo: ROTULO_DO_CARDAPIO.CARDAPIO, dica: DESCRICAO_DO_CARDAPIO.CARDAPIO },
  { valor: "DELIVERY", rotulo: ROTULO_DO_CARDAPIO.DELIVERY, dica: DESCRICAO_DO_CARDAPIO.DELIVERY }
];

/** Qual cardápio a tela mostra. Vale para o painel, a lista e as categorias. */
export function SeletorDeCardapio({ valor, contagem, onChange }: Props) {
  return (
    <div className="ft-segmentos" role="radiogroup" aria-label="Cardápio">
      {OPCOES.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          role="radio"
          aria-checked={valor === opcao.valor}
          className="ft-segmento"
          title={opcao.dica}
          onClick={() => onChange(opcao.valor)}
        >
          {opcao.rotulo}
          <span className="ft-segmento-n">{contagem[opcao.valor]}</span>
        </button>
      ))}
    </div>
  );
}
