import type { DishUnitConversion } from "../../api/client";
import { fatorConversao, lerNumero, normalizarUnidade } from "../../lib/fichaTecnica";
import { unidadesDoLancamento } from "../desperdicio/quantidade";

/** Uma linha da requisição: o que a pessoa digitou (quantidade + unidade) e o que o produto sabe converter. */
export type LinhaDaRequisicao = {
  productId: string;
  productName: string;
  productCode: string | null;
  /** Unidade do estoque do item: o saldo e a baixa são nela. */
  stockUnit: string | null;
  conversions: DishUnitConversion[];
  unit: string;
  quantity: string;
};

export type SituacaoDaLinha =
  | { tipo: "VAZIA" }
  | { tipo: "SEM_CONVERSAO" }
  | { tipo: "OK"; emEstoque: number; saldo: number; ficaCom: number }
  | { tipo: "FALTA"; emEstoque: number; saldo: number; falta: number };

/** Evita 0,30000000004 na tela depois de converter g para kg. */
const arredondar = (valor: number) => Math.round(valor * 1_000_000) / 1_000_000;

/**
 * Quanto a linha tira do estoque e se o saldo cobre. Item sem registro de saldo conta como saldo zero:
 * é assim que o servidor decide, e a tela antes o deixava passar para a requisição ser recusada inteira.
 */
export function situacaoDaLinha(linha: LinhaDaRequisicao, saldoDoEstoque: number | undefined): SituacaoDaLinha {
  const digitado = lerNumero(linha.quantity);
  if (!Number.isFinite(digitado) || digitado <= 0) return { tipo: "VAZIA" };

  const base = normalizarUnidade(linha.stockUnit);
  // Produto sem unidade no cadastro: a quantidade vale como veio (o servidor faz o mesmo).
  const fator = base ? fatorConversao(linha.unit || base, base, linha.conversions) : 1;
  if (fator == null) return { tipo: "SEM_CONVERSAO" };

  const emEstoque = arredondar(digitado * fator);
  const saldo = saldoDoEstoque ?? 0;
  if (emEstoque > saldo) return { tipo: "FALTA", emEstoque, saldo, falta: arredondar(emEstoque - saldo) };
  return { tipo: "OK", emEstoque, saldo, ficaCom: arredondar(saldo - emEstoque) };
}

/** Unidades que o servidor sabe converter para a do estoque; a do estoque vem primeiro. */
export function unidadesDaLinha(linha: Pick<LinhaDaRequisicao, "stockUnit" | "conversions">): string[] {
  const lista = unidadesDoLancamento(linha.stockUnit, linha.conversions);
  return lista.length > 0 ? lista : [normalizarUnidade(linha.stockUnit) || "UN"];
}

export type ResumoDasLinhas = { comQuantidade: number; semSaldo: LinhaDaRequisicao[]; semConversao: LinhaDaRequisicao[]; semQuantidade: number };

export function resumirLinhas(linhas: LinhaDaRequisicao[], saldos: Map<string, number>): ResumoDasLinhas {
  const resumo: ResumoDasLinhas = { comQuantidade: 0, semSaldo: [], semConversao: [], semQuantidade: 0 };
  for (const linha of linhas) {
    const situacao = situacaoDaLinha(linha, saldos.get(linha.productId));
    if (situacao.tipo === "VAZIA") resumo.semQuantidade += 1;
    else {
      resumo.comQuantidade += 1;
      if (situacao.tipo === "FALTA") resumo.semSaldo.push(linha);
      if (situacao.tipo === "SEM_CONVERSAO") resumo.semConversao.push(linha);
    }
  }
  return resumo;
}
