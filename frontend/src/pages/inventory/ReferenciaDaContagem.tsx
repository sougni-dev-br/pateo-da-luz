import type { ReferenciaDaContagem as Referencia } from "../../api/client";
import { Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { lerContagem } from "./referencia-contagem";
import "./referencia-contagem.css";

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function qtd(valor: number | null, unidade: string | null | undefined): string {
  if (valor == null) return "—";
  const numero = formatoQuantidade.format(valor);
  return unidade ? `${numero} ${unidade}` : numero;
}

type Props = {
  referencia: Referencia | undefined;
  unidade: string | null | undefined;
  valorDigitado: string;
  /** Enquanto digita nao avisa: "25" a caminho de "250" nao e sobra. */
  isActive: boolean;
  /** Permissao "Custos do estoque": sem ela o servidor nem manda o custo. */
  mostrarValor: boolean;
};

// A conta da conferencia na linha de quem conta: anterior + compras =
// disponivel -> contado, e quanto vale o que foi contado.
export function ReferenciaDaContagem({ referencia, unidade, valorDigitado, isActive, mostrarValor }: Props) {
  const leitura = lerContagem(referencia, valorDigitado);
  const alerta = !isActive && (leitura.situacao === "ACIMA_DO_DISPONIVEL" || leitura.situacao === "ZERADO_COM_COMPRA");
  const origem = referencia
    ? [referencia.anteriorCodigo, referencia.anteriorData ? formatDate(referencia.anteriorData) : null].filter(Boolean).join(" · ")
    : "";
  const dataAnterior = referencia?.anteriorData ? formatDate(referencia.anteriorData).slice(0, 5) : null;

  return (
    <div className={`ref-contagem${alerta ? " ref-contagem--alerta" : ""}`}>
      <dl className="ref-contagem__conta">
        {leitura.disponivel != null && referencia ? (
          <>
            <div title={origem ? `Contagem aprovada: ${origem}` : undefined}>
              {/* A data a vista: no celular nao ha "passar o mouse" para ver o title. */}
              <dt>Anterior{dataAnterior ? ` · ${dataAnterior}` : ""}</dt>
              <dd>{qtd(referencia.anterior, unidade)}</dd>
            </div>
            <div className="ref-contagem__sinal" aria-hidden="true">+</div>
            <div><dt>Compras</dt><dd>{qtd(referencia.compras, unidade)}</dd></div>
            <div className="ref-contagem__sinal" aria-hidden="true">=</div>
            <div><dt>Disponível</dt><dd>{qtd(leitura.disponivel, unidade)}</dd></div>
            <div className="ref-contagem__sinal" aria-hidden="true">→</div>
          </>
        ) : (
          <div className="ref-contagem__sem-ref"><dt>Referência</dt><dd>sem contagem aprovada</dd></div>
        )}
        <div className="ref-contagem__contado"><dt>Contado</dt><dd>{qtd(leitura.contado, unidade)}</dd></div>
        {mostrarValor && (
          <div className="ref-contagem__valor">
            <dt>Valor</dt>
            <dd>
              {leitura.valor != null
                ? <Money value={leitura.valor} />
                : leitura.contado != null && leitura.contado > 0 ? "sem custo" : "—"}
            </dd>
          </div>
        )}
      </dl>
      {alerta && (
        <p className="ref-contagem__aviso">
          {leitura.situacao === "ACIMA_DO_DISPONIVEL"
            ? <>
                {qtd(leitura.sobra, unidade)} a mais do que havia
                {leitura.valorSemOrigem != null && <> (<Money value={leitura.valorSemOrigem} />)</>}.
                {" "}Confira a contagem e a unidade.
                {referencia?.compras === 0 ? " Se chegou mercadoria, a nota não foi lançada." : ""}
              </>
            : <>Zerado, mas entraram {qtd(referencia?.compras ?? null, unidade)} no período. Confira se não há em outro lugar.</>}
        </p>
      )}
    </div>
  );
}
