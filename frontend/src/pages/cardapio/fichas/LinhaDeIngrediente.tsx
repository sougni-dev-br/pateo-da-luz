import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../../api/client";
import { Button, Money, Select } from "../../../design-system";
import {
  custoPrevisto,
  fatorConversao,
  lerNumero,
  medidaInformavel,
  motivoSemCusto,
  normalizarUnidade,
  opcoesDeUnidade,
  type ErroDoItem,
  type ItemDaFicha
} from "../../../lib/fichaTecnica";

type Props = {
  item: ItemDaFicha;
  erro?: ErroDoItem;
  repetido: boolean;
  onAlterar: (tempId: string, campo: "quantity" | "unit" | "wasteFactor", valor: string) => void;
  onRemover: (tempId: string) => void;
  /** Grava "1 <estoque> = <quantidade> <unidade>" no produto; rejeita com a mensagem do servidor. */
  onInformarConversao: (productId: string, unidade: string, quantidade: number, substituir?: boolean) => Promise<void>;
};

/** Impede que a rodinha do mouse mude o número quando o campo está em foco. */
const soltarNaRodinha = (evento: { currentTarget: HTMLInputElement }) => evento.currentTarget.blur();

/**
 * "1 UN = [____] G": quando a unidade escolhida ainda não converte, a pessoa diz como o produto
 * é de fato (quanto pesa 1 UN, quantos ml tem 1 KG) e o sistema grava no produto, valendo para
 * todas as fichas. Sem isto a única saída era sair da ficha e achar a tela de conversões.
 */
function InformarConversao({ item, medida, onInformar, aoSalvar }: {
  item: ItemDaFicha;
  medida: string;
  onInformar: Props["onInformarConversao"];
  aoSalvar?: () => void;
}) {
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  // O produto já tem outra conversão cadastrada: o servidor avisa e só troca com confirmação.
  const [pedeConfirmacao, setPedeConfirmacao] = useState(false);
  const base = normalizarUnidade(item.productUnit) || "UN";
  const quantidade = lerNumero(valor);
  const valido = Number.isFinite(quantidade) && quantidade > 0;

  async function salvar(substituir = false) {
    if (!valido) return;
    setSalvando(true);
    setFalha(null);
    try {
      await onInformar(item.productId, medida, quantidade, substituir);
      aoSalvar?.();
    } catch (erro) {
      setPedeConfirmacao(erro instanceof ApiError && erro.status === 409);
      setFalha(erro instanceof Error ? erro.message : "Não foi possível salvar a conversão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="ft-conversao" role="group" aria-label={`Informar quanto vale 1 ${base} de ${item.productName} em ${medida}`}>
      <span className="ft-conversao-texto">Quanto vale 1 {base} em {medida}?</span>
      <span className="ft-conversao-campo">
        <span aria-hidden>1 {base} =</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          value={valor}
          placeholder="0"
          aria-label={`Quantos ${medida} tem 1 ${base} de ${item.productName}`}
          onChange={(evento) => setValor(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key !== "Enter") return;
            evento.preventDefault();
            evento.stopPropagation();
            void salvar();
          }}
          onWheel={soltarNaRodinha}
        />
        <span aria-hidden>{medida}</span>
        <Button size="sm" variant="secondary" disabled={!valido || salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar conversão"}
        </Button>
      </span>
      <small className="ft-conversao-ajuda">Vale para todas as fichas deste produto e para a conversão de compras e contagem.</small>
      {falha && <small className="ft-conversao-erro" role="alert">{falha}</small>}
      {pedeConfirmacao && (
        <Button size="sm" variant="danger" disabled={salvando} onClick={() => void salvar(true)}>Substituir mesmo assim</Button>
      )}
    </div>
  );
}

export function LinhaDeIngrediente({ item, erro, repetido, onAlterar, onRemover, onInformarConversao }: Props) {
  const custo = custoPrevisto(item);
  const motivo = motivoSemCusto(item);
  const unidadeAtual = normalizarUnidade(item.unit);
  const idDaNota = `ft-nota-${item.tempId}`;
  // Conversão lida do nome: só avisa quando a unidade escolhida depende dela.
  const usaEmbalagemDoNome = Boolean(item.embalagemInferida) && unidadeAtual !== normalizarUnidade(item.productUnit);
  const medida = medidaInformavel(unidadeAtual);
  const [corrigindo, setCorrigindo] = useState(false);
  const faltaConversao = item.unitCost > 0 && fatorConversao(item.unit, item.productUnit, item.conversions) == null && medida != null;

  const opcoes = opcoesDeUnidade(item.productUnit, item.conversions, item.unit).map((opcao) => ({ value: opcao.value, label: opcao.label }));
  const podeCorrigirALeitura = usaEmbalagemDoNome && !faltaConversao && medida != null;
  const textoDaNota = erro?.mensagem
    ?? (faltaConversao ? null : motivo)
    ?? (repetido ? "Este produto aparece mais de uma vez na ficha." : null)
    ?? item.avisoDeConversao
    ?? (usaEmbalagemDoNome ? `${item.embalagemInferida}. Confira se bate com a embalagem.` : null);
  const temNota = Boolean(textoDaNota);

  return (
    <li className={`ft-ingrediente${erro ? " ft-ingrediente--erro" : motivo ? " ft-ingrediente--alerta" : ""}`}>
      <div className="ft-ingrediente-linha">
        <div className="ft-ingrediente-produto">
          <strong>{item.productName}</strong>
          <small>
            {item.unitCost > 0
              ? <>Estoque: <Money value={item.unitCost} />{item.productUnit ? ` / ${item.productUnit}` : ""}</>
              : "Sem custo no estoque"}
          </small>
        </div>

        <label className="ft-campo ft-campo--qtd">
          <span className="ft-campo-rotulo">Quantidade</span>
          <input
            id={`ft-qtd-${item.tempId}`}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={item.quantity}
            aria-label={`Quantidade de ${item.productName}`}
            aria-invalid={erro?.campo === "quantity" ? true : undefined}
            aria-describedby={temNota ? idDaNota : undefined}
            onChange={(evento) => onAlterar(item.tempId, "quantity", evento.target.value)}
            onWheel={soltarNaRodinha}
          />
        </label>

        <div className="ft-campo ft-campo--un">
          <span className="ft-campo-rotulo">Unidade</span>
          <Select
            value={unidadeAtual}
            options={opcoes}
            aria-label={`Unidade de ${item.productName}`}
            onChange={(evento) => onAlterar(item.tempId, "unit", evento.target.value)}
          />
        </div>

        <label className="ft-campo ft-campo--perda">
          <span className="ft-campo-rotulo">Perda %</span>
          <input
            id={`ft-perda-${item.tempId}`}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            max="100"
            value={item.wasteFactor}
            aria-label={`Perda de ${item.productName} em percentual`}
            aria-invalid={erro?.campo === "wasteFactor" ? true : undefined}
            aria-describedby={temNota ? idDaNota : undefined}
            onChange={(evento) => onAlterar(item.tempId, "wasteFactor", evento.target.value)}
            onWheel={soltarNaRodinha}
          />
        </label>

        <div className="ft-ingrediente-custo" aria-label={`Custo de ${item.productName}`}>
          <span className="ft-campo-rotulo">Custo</span>
          {custo != null ? <Money value={custo} /> : <span className="ft-sem-valor" title={motivo ?? undefined}>sem custo</span>}
        </div>

        <button
          type="button"
          className="ft-remover"
          onClick={() => onRemover(item.tempId)}
          aria-label={`Remover ${item.productName} da ficha`}
          title="Remover da ficha"
        >
          <Trash2 size={16} aria-hidden />
        </button>
      </div>

      {textoDaNota && (
        <p
          id={idDaNota}
          className={`ft-ingrediente-nota${erro ? " ft-ingrediente-nota--erro" : !motivo && !repetido && (usaEmbalagemDoNome || item.avisoDeConversao) ? " ft-ingrediente-nota--info" : ""}`}
          role={erro ? "alert" : undefined}
        >
          <AlertTriangle size={13} aria-hidden />
          {textoDaNota}
          {podeCorrigirALeitura && !corrigindo && (
            <button type="button" className="ft-link" onClick={() => setCorrigindo(true)}>Não bate? Informar o valor certo</button>
          )}
        </p>
      )}

      {((faltaConversao && medida) || (corrigindo && medida)) && (
        <InformarConversao
          key={`${item.productId}-${medida}`}
          item={item}
          medida={medida!}
          onInformar={onInformarConversao}
          aoSalvar={() => setCorrigindo(false)}
        />
      )}
    </li>
  );
}
