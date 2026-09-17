// O que conferir antes de um inventário virar base do CMV.
//
// Cada verificação aqui nasceu de um erro que passou despercebido por meses e só
// apareceu numa auditoria manual:
//
//   CADEIA_QUEBRADA      07 e 08/2026 apuraram com estoque de abertura ZERO,
//                        R$ 115 mil e R$ 49 mil abaixo do que o mês anterior
//                        havia fechado.
//   ITEM_SEM_CUSTO       228 a 283 itens por inventário entravam valendo R$ 0,00
//                        — um terço da base — porque o produto nunca foi comprado
//                        pelo ERP e não tinha custo médio.
//   CUSTO_FORA_DA_SERIE  o SACO AMOSTRA entrou a R$ 113,16 por saco (o preço da
//                        embalagem de 800) e sozinho inflou agosto em R$ 81 mil.
//   TOTAL_FORA_DA_SERIE  agosto fechou R$ 137 mil contra R$ 41 mil de julho e
//                        ninguém estranhou na hora.
//
// Nada aqui bloqueia sozinho: a função classifica e descreve, e quem fecha
// decide. Bloquear o que não se entende empurra quem fecha a contornar; mostrar
// o que destoa, com o número ao lado, é o que faz olhar.

import { verificarCadeia, type EloDaCadeia } from "./cadeia-inventario.js";

export type ItemDoInventario = {
  productId: string | null;
  productName: string;
  unit: string | null;
  quantity: number;
  unitCost: number | null;
};

/** Custo do MESMO produto em outros meses, para comparar. */
export type CustoHistorico = {
  productId: string;
  competenceMonth: number;
  unitCost: number;
};

export type EntradaDaVerificacao = {
  competenceYear: number;
  competenceMonth: number;
  itens: ItemDoInventario[];
  totalValue: number;
  historicoDeCusto: CustoHistorico[];
  /** totalValue dos inventários finais anteriores, do mais antigo ao mais recente. */
  totaisAnteriores: number[];
  /** A série inteira, em ordem cronológica, para conferir o encadeamento. */
  cadeia: EloDaCadeia[];
};

export type Severidade = "BLOQUEIO" | "ALERTA";

export type Achado = {
  codigo: "CADEIA_QUEBRADA" | "ITEM_SEM_CUSTO" | "CUSTO_FORA_DA_SERIE" | "ITEM_CONCENTRADO" | "TOTAL_FORA_DA_SERIE";
  severidade: Severidade;
  titulo: string;
  detalhe: string;
  /** Amostra do que gerou o achado, para a tela mostrar sem nova consulta. */
  exemplos: Array<{ produto: string; numero: string }>;
};

// Um custo 10x acima do que o mesmo produto teve em outro mês não é reajuste: as
// embalagens da base vão de 10 a 1000 unidades, e é esse fator que aparece
// quando se confunde o preço da caixa com o da unidade. Abaixo de 10x entra
// variação real de hortifruti, que chega a 5x entre safra e entressafra.
const FATOR_DE_CUSTO_SUSPEITO = 10;

// O inventário oscila de verdade — de R$ 41 mil a R$ 95 mil na série real — e
// isso limita o que comparar totais consegue pegar. Agosto, inflado em R$ 81 mil
// por um item só, ficou em 1,7x da mediana: abaixo de qualquer limiar que não
// acusasse também a queda legítima de julho. O teste fica como rede grossa, para
// erro de ordem de grandeza, e quem pega o caso real é a concentração abaixo.
const FATOR_DE_TOTAL_SUSPEITO = 2;

// Um item que responde por mais de um quarto do inventário inteiro é o sintoma
// mais nítido de custo errado. No agosto inflado, o SACO AMOSTRA era 59% do
// total; num mês saudável o maior item fica abaixo de 10%.
const PARTICIPACAO_SUSPEITA = 0.25;

// Abaixo disso a comparação não se sustenta: dois meses não formam série.
const MINIMO_DE_MESES_PARA_COMPARAR = 3;

const MAX_EXEMPLOS = 8;

function mediana(valores: number[]): number | null {
  const ordenados = valores.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (ordenados.length === 0) return null;
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[meio]
    : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function verificarFechamento(entrada: EntradaDaVerificacao): Achado[] {
  const achados: Achado[] = [];

  // ── 1. A cadeia ────────────────────────────────────────────────────────────
  const quebras = verificarCadeia(entrada.cadeia).filter(
    (q) => q.competenceYear === entrada.competenceYear && q.competenceMonth <= entrada.competenceMonth
  );
  if (quebras.length > 0) {
    achados.push({
      codigo: "CADEIA_QUEBRADA",
      severidade: "BLOQUEIO",
      titulo: "O estoque de abertura não vem do mês anterior",
      detalhe:
        "O inicial de um mês é, por definição, o final do anterior. Enquanto não bater, " +
        "o CMV apura sobre um estoque que não existiu.",
      exemplos: quebras.slice(0, MAX_EXEMPLOS).map((q) => ({
        produto: `${String(q.competenceMonth).padStart(2, "0")}/${q.competenceYear}`,
        numero: q.tipo === "INICIAL_AUSENTE"
          ? `ausente — deveria ser ${brl(q.valorEsperado ?? 0)}`
          : q.tipo === "FINAL_AUSENTE"
            ? "sem inventário final"
            : `${brl(q.valorAtual ?? 0)} contra ${brl(q.valorEsperado ?? 0)}`
      }))
    });
  }

  // ── 2. Item com saldo e sem custo ──────────────────────────────────────────
  const semCusto = entrada.itens.filter((i) => i.quantity > 0 && (i.unitCost == null || i.unitCost === 0));
  if (semCusto.length > 0) {
    achados.push({
      codigo: "ITEM_SEM_CUSTO",
      severidade: "ALERTA",
      titulo: `${semCusto.length} ${semCusto.length === 1 ? "item existe no estoque e vale" : "itens existem no estoque e valem"} R$ 0,00`,
      detalhe:
        "Produto sem custo médio entra no inventário valendo zero, e o CMV do mês sai maior " +
        "do que é. Costuma ser produto que nunca passou por uma compra no sistema.",
      exemplos: semCusto
        .slice()
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, MAX_EXEMPLOS)
        .map((i) => ({ produto: i.productName, numero: `${i.quantity} ${i.unit ?? ""}`.trim() }))
    });
  }

  // ── 3. Custo que destoa do próprio histórico do produto ────────────────────
  const historicoPorProduto = new Map<string, number[]>();
  for (const h of entrada.historicoDeCusto) {
    if (h.competenceMonth === entrada.competenceMonth) continue;
    const atual = historicoPorProduto.get(h.productId) ?? [];
    atual.push(h.unitCost);
    historicoPorProduto.set(h.productId, atual);
  }

  const foraDaSerie: Array<{ item: ItemDoInventario; referencia: number; fator: number }> = [];
  for (const item of entrada.itens) {
    if (!item.productId || item.unitCost == null || item.unitCost <= 0) continue;
    const ref = mediana(historicoPorProduto.get(item.productId) ?? []);
    if (ref == null) continue;
    const fator = item.unitCost > ref ? item.unitCost / ref : ref / item.unitCost;
    if (fator >= FATOR_DE_CUSTO_SUSPEITO) foraDaSerie.push({ item, referencia: ref, fator });
  }
  if (foraDaSerie.length > 0) {
    achados.push({
      codigo: "CUSTO_FORA_DA_SERIE",
      severidade: "ALERTA",
      titulo: `${foraDaSerie.length} ${foraDaSerie.length === 1 ? "item tem custo" : "itens têm custo"} muito fora do próprio histórico`,
      detalhe:
        "Salto dessa ordem costuma ser embalagem confundida com unidade — a caixa lançada " +
        "como 1 faz o custo da caixa virar o custo de cada unidade contada.",
      exemplos: foraDaSerie
        .sort((a, b) => b.item.quantity * b.item.unitCost! - a.item.quantity * a.item.unitCost!)
        .slice(0, MAX_EXEMPLOS)
        .map((f) => ({
          produto: f.item.productName,
          numero: `${brl(f.item.unitCost!)} contra ${brl(f.referencia)} — ${Math.round(f.fator)}x`
        }))
    });
  }

  // ── 4. Um item concentrando o inventário ───────────────────────────────────
  if (entrada.totalValue > 0) {
    const concentrados = entrada.itens
      .map((i) => ({ item: i, valor: (i.unitCost ?? 0) * i.quantity }))
      .filter((x) => x.valor / entrada.totalValue >= PARTICIPACAO_SUSPEITA)
      .sort((a, b) => b.valor - a.valor);

    if (concentrados.length > 0) {
      achados.push({
        codigo: "ITEM_CONCENTRADO",
        severidade: "ALERTA",
        titulo:
          concentrados.length === 1
            ? "Um item sozinho responde por boa parte do inventário"
            : `${concentrados.length} itens concentram boa parte do inventário`,
        detalhe:
          "Concentração assim costuma ser custo errado, não estoque real. " +
          "Confira a unidade do item e o preço da última compra.",
        exemplos: concentrados.slice(0, MAX_EXEMPLOS).map((x) => ({
          produto: x.item.productName,
          numero: `${brl(x.valor)} — ${Math.round((x.valor / entrada.totalValue) * 100)}% do inventário`
        }))
      });
    }
  }

  // ── 5. Total que destoa da série ───────────────────────────────────────────
  const anteriores = entrada.totaisAnteriores.filter((v) => Number.isFinite(v) && v > 0);
  const refTotal = anteriores.length >= MINIMO_DE_MESES_PARA_COMPARAR ? mediana(anteriores) : null;
  if (refTotal != null && entrada.totalValue > 0) {
    const fator = entrada.totalValue > refTotal ? entrada.totalValue / refTotal : refTotal / entrada.totalValue;
    if (fator >= FATOR_DE_TOTAL_SUSPEITO) {
      achados.push({
        codigo: "TOTAL_FORA_DA_SERIE",
        severidade: "ALERTA",
        titulo: "O total do inventário destoa dos meses anteriores",
        detalhe:
          "Pode ser real — compra grande antes de evento, virada de cardápio. " +
          "Vale conferir os itens de maior valor antes de aprovar.",
        exemplos: [{
          produto: `${String(entrada.competenceMonth).padStart(2, "0")}/${entrada.competenceYear}`,
          numero: `${brl(entrada.totalValue)} contra mediana de ${brl(refTotal)} — ${fator.toFixed(1)}x`
        }]
      });
    }
  }

  return achados;
}

/** true quando nada impede a aprovação (alertas não impedem; bloqueios sim). */
export function podeAprovar(achados: Achado[]): boolean {
  return !achados.some((a) => a.severidade === "BLOQUEIO");
}
