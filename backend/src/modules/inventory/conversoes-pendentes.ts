import { normalizarUnidade, resolveUnitFactor } from "../../shared/unidades/conversao.js";
import { pecaSemConversao } from "../../shared/unidades/conversao-manual.js";
import { proporConversoes } from "../../shared/unidades/conversao-automatica.js";
import type { ProdutoCarregadoParaConversao } from "../products/conversao-automatica.service.js";

// Pendências de conversão para o estoquista: unidades em que o produto já foi comprado (ou é comprado, ou se
// chama "peça") e que o sistema ainda não sabe converter para a unidade do estoque. Enquanto isso não é
// cadastrado, a unidade não aparece na requisição e o preço do pedido de compra fica sem referência.

export type OrigemDaPendencia = "COMPRA" | "CADASTRO" | "NOME_PECA";

export type PendenciaDeUnidade = {
  unidade: string;
  origem: OrigemDaPendencia;
  /** Linhas de compra nessa unidade que ainda não convertem. */
  linhas: number;
  valor: number;
  /** O que o nome e as compras sugerem; null quando o sistema não tem palpite. */
  proposta: { factor: number; confianca: "alta" | "baixa"; motivo: string } | null;
};

export type PendenciaDoProduto = {
  productId: string;
  codigo: string | null;
  nome: string;
  unidadeDeContagem: string;
  saldo: number | null;
  pendencias: PendenciaDeUnidade[];
};

const LIMITE = 300;

export function montarPendencias(
  carregados: ProdutoCarregadoParaConversao[],
  saldos: Map<string, number>,
  controlaEstoque: Set<string>
): PendenciaDoProduto[] {
  const resultado: PendenciaDoProduto[] = [];
  for (const p of carregados) {
    if (!controlaEstoque.has(p.productId)) continue;
    const contagem = normalizarUnidade(p.contagem);
    if (!contagem) continue;

    const propostas = new Map(proporConversoes(p.entrada).map((x) => [x.fromUnit, x]));
    const porUnidade = new Map<string, PendenciaDeUnidade>();
    for (const nota of p.entrada.unidadesDaNota) {
      const unidade = normalizarUnidade(nota.unidade);
      if (!unidade || unidade === contagem) continue;
      if (resolveUnitFactor(unidade, contagem, p.entrada.cadastradas) != null) continue;
      const atual = porUnidade.get(unidade);
      const proposta = propostas.get(unidade);
      porUnidade.set(unidade, {
        unidade,
        origem: (atual?.linhas ?? 0) + nota.linhas > 0 ? "COMPRA" : "CADASTRO",
        linhas: (atual?.linhas ?? 0) + nota.linhas,
        valor: (atual?.valor ?? 0) + nota.valor,
        proposta: proposta ? { factor: proposta.factor, confianca: proposta.confianca, motivo: proposta.motivo } : null
      });
    }
    // "BACON PEÇA" contado em KG: ninguém requisita 1 peça sem saber quanto ela pesa.
    if (!porUnidade.has("UN") && pecaSemConversao(p.nome, p.contagem, p.entrada.cadastradas)) {
      porUnidade.set("UN", { unidade: "UN", origem: "NOME_PECA", linhas: 0, valor: 0, proposta: null });
    }
    if (porUnidade.size === 0) continue;

    resultado.push({
      productId: p.productId,
      codigo: p.codigo,
      nome: p.nome,
      unidadeDeContagem: contagem,
      saldo: saldos.has(p.productId) ? saldos.get(p.productId)! : null,
      pendencias: Array.from(porUnidade.values()).sort((a, b) => b.valor - a.valor || b.linhas - a.linhas)
    });
  }
  const peso = (x: PendenciaDoProduto) => x.pendencias.reduce((s, y) => s + y.valor, 0);
  return resultado.sort((a, b) => peso(b) - peso(a) || a.nome.localeCompare(b.nome, "pt-BR")).slice(0, LIMITE);
}
