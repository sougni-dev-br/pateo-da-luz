import { Check, FileText } from "lucide-react";
import { useMemo } from "react";
import { Select, TextField } from "../design-system";
import {
  dividirValor, formaPermiteParcelamento, formasPorNomeBase, somarDias,
  type FormaPagamento,
} from "../lib/formas-pagamento";
import { numeroBr } from "../utils/format";

export type LinhaParcela = {
  dataVencimento: string;
  valor: string;
  /** Arquivo de onde a parcela foi lida (vazio quando foi gerada pela tela). */
  origem: string;
};

type Props = {
  parcelas: LinhaParcela[];
  totalEsperado: number;
  formasPagamento: FormaPagamento[];
  paymentMethodId: string;
  onFormaChange: (paymentMethodId: string) => void;
  onChange: (parcelas: LinhaParcela[]) => void;
};

const TOLERANCIA = 0.01;
const DIAS_ENTRE_PARCELAS = 30;

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function paraBr(dataIso: string): string {
  return dataIso ? dataIso.split("-").reverse().join("/") : "–";
}

/**
 * Pagamento do título — mesmo desenho do lançamento de compra: escolhe-se a
 * FORMA e a QUANTIDADE de parcelas, e a grade abaixo mostra cada vencimento e
 * valor, com o total conferido.
 *
 * Duas diferenças, porque aqui há documento:
 *   - a quantidade já vem com o número de boletos lidos, e cada linha mostra de
 *     qual arquivo veio;
 *   - mudar a quantidade recalcula tudo, e isso descarta o que foi lido — por
 *     isso o aviso aparece antes, não depois.
 */
export function ParcelasEditor({ parcelas, totalEsperado, formasPagamento, paymentMethodId, onFormaChange, onChange }: Props) {
  const opcoes = useMemo(() => formasPorNomeBase(formasPagamento), [formasPagamento]);
  const formaEscolhida = formasPagamento.find((forma) => forma.id === paymentMethodId) ?? null;
  const permiteParcelar = formaPermiteParcelamento(formaEscolhida);

  const soma = parcelas.reduce((total, parcela) => total + numeroBr(parcela.valor), 0);
  const diferenca = soma - totalEsperado;
  const fecha = Math.abs(diferenca) <= TOLERANCIA;
  const veioDeBoleto = parcelas.some((parcela) => parcela.origem);

  function alterar(indice: number, mudanca: Partial<LinhaParcela>) {
    onChange(parcelas.map((parcela, i) => (i === indice ? { ...parcela, ...mudanca } : parcela)));
  }

  /** Refaz a grade inteira: divide o total e espaça os vencimentos. */
  function recalcular(quantidade: number) {
    const total = Math.max(1, Math.min(60, quantidade));
    const valores = dividirValor(totalEsperado, total);
    const primeira = parcelas[0]?.dataVencimento || "";
    onChange(valores.map((valor, indice) => ({
      dataVencimento: primeira ? somarDias(primeira, indice * DIAS_ENTRE_PARCELAS) : "",
      // toFixed(2) como o splitAmount da tela de Compras: o campo e numerico.
      valor: valor.toFixed(2),
      origem: "",
    })));
  }

  function mudarForma(novaFormaId: string) {
    onFormaChange(novaFormaId);
    const nova = formasPagamento.find((forma) => forma.id === novaFormaId) ?? null;
    // Forma que não parcela (PIX, dinheiro, débito) volta para parcela única:
    // o backend recusaria mais de uma, e é melhor a tela ajustar do que deixar
    // a pessoa montar um parcelamento que vai ser rejeitado no fim.
    if (!formaPermiteParcelamento(nova) && parcelas.length > 1) recalcular(1);
  }

  return (
    <div className="doc-pagamento">
      <div className="doc-pagamento__cabecalho">
        <strong className="doc-pagamento__titulo">Pagamento</strong>
        <span className="doc-pagamento__resumo">
          {parcelas.length === 1 ? "parcela única" : `${parcelas.length} parcelas`}
          {parcelas[0]?.dataVencimento ? ` · 1ª em ${paraBr(parcelas[0].dataVencimento)}` : ""}
          {` · ${dinheiro(soma)}`}
        </span>
      </div>

      <div className="doc-pagamento__campos">
        <Select
          label="Forma de pagamento"
          value={paymentMethodId}
          onChange={(evento) => mudarForma(evento.target.value)}
          placeholder="Selecione…"
          options={opcoes.map((forma) => ({ value: forma.id, label: forma.rotulo }))}
        />
        <TextField
          label="Quantidade de parcelas"
          type="number"
          min={1}
          max={60}
          inputMode="numeric"
          value={String(parcelas.length)}
          disabled={!formaEscolhida || !permiteParcelar}
          onChange={(evento) => recalcular(Number(evento.target.value || 1))}
          hint={
            formaEscolhida && !permiteParcelar
              ? "esta forma não parcela"
              : veioDeBoleto
                ? "veio dos boletos — mudar aqui refaz a grade"
                : undefined
          }
        />
        <TextField
          label="Primeiro vencimento"
          value={paraBr(parcelas[0]?.dataVencimento ?? "")}
          disabled
          hint="editável na grade abaixo"
        />
      </div>

      <div className="doc-parcela-grade">
        {parcelas.map((parcela, indice) => (
          <div key={indice} className="doc-parcela-linha">
            <span className="doc-parcela-linha__ordem">
              {indice + 1}ª <span className="doc-parcela-linha__de">de {parcelas.length}</span>
            </span>
            <TextField
              aria-label={`Vencimento da parcela ${indice + 1}`}
              type="date"
              value={parcela.dataVencimento}
              onChange={(evento) => alterar(indice, { dataVencimento: evento.target.value })}
            />
            {/* Mesmo campo da tela de Compras: numerico com passo de centavo,
              * nao mascarado — digitar 150 e cento e cinquenta reais. */}
            <TextField
              aria-label={`Valor da parcela ${indice + 1}`}
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              placeholder="0,00"
              value={parcela.valor}
              onChange={(evento) => alterar(indice, { valor: evento.target.value })}
            />
            {parcela.origem ? (
              <div className="doc-parcela-linha__origem">
                <FileText size={12} /> <span title={parcela.origem}>{parcela.origem}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className={`doc-total${fecha ? "" : " doc-total--diverge"}`}>
        <span className="doc-total__rotulo">Total das parcelas</span>
        <span className="doc-total__valor">
          {dinheiro(soma)}
          {fecha
            ? <Check size={14} className="doc-total__check" />
            : <span className="doc-total__diferenca">falta {dinheiro(Math.abs(diferenca))} para {dinheiro(totalEsperado)}</span>}
        </span>
      </div>
    </div>
  );
}
