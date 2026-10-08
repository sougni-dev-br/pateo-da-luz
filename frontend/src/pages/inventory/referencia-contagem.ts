import type { ReferenciaDaContagem } from "../../api/client";
import { quantityToApi } from "./shared";

// Referencia de quem conta: a conta da conferencia do inventario (anterior +
// compras = disponivel) na hora de contar, quando ainda da para olhar a
// prateleira de novo. So os dois casos que nao dependem de historico: contar
// mais do que havia e zerar o que acabou de entrar. Fora do historico ja e o
// aviso de plausibilidade (evaluateQuantity), que segue valendo.

export type SituacaoDaContagem = "SEM_REFERENCIA" | "PENDENTE" | "ACIMA_DO_DISPONIVEL" | "ZERADO_COM_COMPRA" | "OK";

export type LeituraDaContagem = {
  situacao: SituacaoDaContagem;
  disponivel: number | null;
  contado: number | null;
  /** Quanto vale o que foi contado. `null` sem custo ou sem quantidade. */
  valor: number | null;
  /** Contado acima do disponivel: quanto e quanto vale. */
  sobra: number | null;
  valorSemOrigem: number | null;
};

// Mesma regra do servidor (backend/src/modules/inventory/conferencia.ts):
// balanca e arredondamento de quem conta, 5% do disponivel ou um centesimo.
const TOLERANCIA_RELATIVA = 0.05;
const TOLERANCIA_ABSOLUTA = 0.01;

function emReais(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function quantidadeDigitada(valorDigitado: string): number | null {
  const normalizado = quantityToApi(valorDigitado);
  if (normalizado === undefined || normalizado === "") return null;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

export function lerContagem(referencia: ReferenciaDaContagem | undefined, valorDigitado: string): LeituraDaContagem {
  const contado = quantidadeDigitada(valorDigitado);
  const custo = referencia?.custoUnitario ?? null;
  const valor = contado != null && custo != null ? emReais(contado * custo) : null;
  const base = { contado, valor, sobra: null, valorSemOrigem: null };

  if (!referencia || referencia.anterior == null) {
    return { ...base, situacao: "SEM_REFERENCIA", disponivel: null };
  }
  const disponivel = referencia.anterior + referencia.compras;
  if (contado == null) return { ...base, situacao: "PENDENTE", disponivel };

  const tolerancia = Math.max(TOLERANCIA_ABSOLUTA, disponivel * TOLERANCIA_RELATIVA);
  if (contado > disponivel + tolerancia) {
    const sobra = contado - disponivel;
    return {
      ...base,
      situacao: "ACIMA_DO_DISPONIVEL",
      disponivel,
      sobra,
      valorSemOrigem: custo != null ? emReais(sobra * custo) : null
    };
  }
  if (contado === 0 && referencia.compras > TOLERANCIA_ABSOLUTA) {
    return { ...base, situacao: "ZERADO_COM_COMPRA", disponivel };
  }
  return { ...base, situacao: "OK", disponivel };
}

export type TotalDaContagem = {
  /** Soma de contado x custo dos itens com quantidade e custo. */
  valor: number;
  contadosSemCusto: number;
  acimaDoDisponivel: number;
};

export function totalDaContagem(
  itemIds: readonly string[],
  referencias: Readonly<Record<string, ReferenciaDaContagem>>,
  valores: Readonly<Record<string, string | undefined>>
): TotalDaContagem {
  return itemIds.reduce<TotalDaContagem>((total, id) => {
    const leitura = lerContagem(referencias[id], valores[id] ?? "");
    if (leitura.contado == null) return total;
    return {
      valor: leitura.valor == null ? total.valor : emReais(total.valor + leitura.valor),
      contadosSemCusto: total.contadosSemCusto + (leitura.valor == null && leitura.contado > 0 ? 1 : 0),
      acimaDoDisponivel: total.acimaDoDisponivel + (leitura.situacao === "ACIMA_DO_DISPONIVEL" ? 1 : 0)
    };
  }, { valor: 0, contadosSemCusto: 0, acimaDoDisponivel: 0 });
}
