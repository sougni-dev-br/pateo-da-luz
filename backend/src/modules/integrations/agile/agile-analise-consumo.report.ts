import { ehBuffet } from "./agile-categorias.js";
import type { Periodo } from "./agile-analise.report.js";
import { normalizarUnidade, resolveUnitFactor, type UnitConversion } from "../../../shared/unidades/conversao.js";

// Consumo teórico de insumos: o que DEVERIA ter saído do estoque pelo que o PDV vendeu.
//
// É referência, não saída de estoque: nada aqui grava movimento. Serve para a contagem (esperado) e para
// achar divergência. Só calcula onde há vínculo e ficha utilizável; o resto vira lista de trabalho, na
// ordem do que mais vende, em vez de um número inventado. A cobertura diz quanto da receita o cálculo
// explica, e é ela que diz se o consumo teórico já pode ser levado a sério.

export const MAX_SEM_VINCULO = 30;

export type VendaPorProduto = { codigo: string | null; nome: string; categoria: string | null; quantidade: number; valor: number };

/** Ingrediente que é um produto comprado. A quantidade é por receita inteira (rendimento), na unidade do item. */
export type ItemDeProduto = {
  insumoId: string;
  insumo: string;
  quantidade: number;
  unidade: string;
  perda: number;
  unidadeEstoque: string | null;
  conversoes: UnitConversion[];
};

/** Ingrediente que é outra ficha (de produção, ex.: a massa do nhoque). A quantidade é na unidade de rendimento dela. */
export type ItemDeFichaComponente = {
  componenteId: string;
  quantidade: number;
  unidade: string;
  perda: number;
};

export type ItemDeFicha = ItemDeProduto | ItemDeFichaComponente;

/** Ficha dentro de ficha dentro de ficha: o mesmo limite do custo (dish-fichas-de-producao). */
export const MAX_NIVEIS_DE_FICHA = 3;

export type FichaDoPrato = {
  id: string;
  nome: string;
  rendimento: number;
  /** Unidade em que o rendimento é expresso: é nela que outra ficha usa esta como ingrediente. */
  unidadeRendimento: string;
  /** false = rendimento em KG ou L: cada unidade vendida não é uma porção da ficha. */
  rendimentoEmPorcao: boolean;
  itens: ItemDeFicha[];
};

export type VinculoDePrato = { codigo: string; pratoId: string };
export type VinculoDeInsumo = {
  codigo: string;
  insumoId: string;
  insumo: string;
  /** Quanto do insumo sai em cada unidade vendida, na unidade abaixo. */
  quantidade: number;
  unidade: string;
  unidadeEstoque: string | null;
  conversoes: UnitConversion[];
};

export type MotivoSemCobertura = "SEM_VINCULO" | "PRATO_INDISPONIVEL" | "FICHA_SEM_ITENS" | "FICHA_INCOMPLETA" | "RENDIMENTO_NAO_E_PORCAO" | "SEM_CONVERSAO";

export type ProblemaDeConsumo = {
  tipo: "SEM_CONVERSAO" | "RENDIMENTO_NAO_E_PORCAO" | "PRATO_INDISPONIVEL" | "FICHA_DE_PRODUCAO_INDISPONIVEL" | "FICHA_EM_CICLO";
  /** Prato ou produto do PDV onde o problema aparece. */
  origem: string;
  insumo?: string;
  detalhe: string;
};

export type InsumoConsumido = {
  insumoId: string;
  insumo: string;
  unidade: string;
  consumo: number;
  consumoFichas: number;
  consumoRevenda: number;
};

export type ProdutoSemCobertura = {
  codigo: string | null;
  nome: string;
  categoria: string | null;
  receita: number;
  quantidade: number;
  motivo: MotivoSemCobertura;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

type Acumulado = { insumo: string; unidade: string; fichas: number; revenda: number };

export function montarConsumoTeorico({ periodo, vendas, fichas, vinculosPrato, vinculosInsumo }: {
  periodo: Periodo;
  vendas: VendaPorProduto[];
  fichas: FichaDoPrato[];
  vinculosPrato: VinculoDePrato[];
  vinculosInsumo: VinculoDeInsumo[];
}) {
  const fichaPorId = new Map(fichas.map((f) => [f.id, f]));
  const pratoDoCodigo = new Map(vinculosPrato.map((v) => [v.codigo, v.pratoId]));
  const insumoDoCodigo = new Map(vinculosInsumo.map((v) => [v.codigo, v]));

  const acumulado = new Map<string, Acumulado>();
  const problemas = new Map<string, ProblemaDeConsumo>();
  const semCobertura: ProdutoSemCobertura[] = [];

  const somar = (insumoId: string, insumo: string, unidade: string, quantidade: number, origem: "fichas" | "revenda") => {
    const atual = acumulado.get(insumoId) ?? { insumo, unidade, fichas: 0, revenda: 0 };
    atual[origem] += quantidade;
    acumulado.set(insumoId, atual);
  };
  const registrar = (problema: ProblemaDeConsumo) => {
    problemas.set(`${problema.tipo}|${problema.origem}|${problema.insumo ?? ""}`, problema);
  };

  // Gasta `unidades` do rendimento da ficha: cada item sai na proporção quantidade / rendimento. Item que é outra
  // ficha vira unidades do rendimento dela e desce mais um nível, até os produtos. Devolve false quando algum item
  // ficou de fora (sem conversão, ficha que falta, ciclo): o consumo que deu para somar vale como piso, e o prato
  // não pode contar como coberto, senão a cobertura passa de "boa" com um ingrediente importante faltando.
  const expandir = (ficha: FichaDoPrato, unidades: number, origem: string, caminho: string[], nivel: number): boolean => {
    let completa = true;
    const rendimento = Number.isFinite(ficha.rendimento) && ficha.rendimento > 0 ? ficha.rendimento : 1;
    for (const item of ficha.itens) {
      if ("componenteId" in item) {
        const componente = fichaPorId.get(item.componenteId);
        if (!componente) {
          registrar({ tipo: "FICHA_DE_PRODUCAO_INDISPONIVEL", origem, detalhe: "Uma ficha de produção usada como ingrediente não foi encontrada." });
          completa = false;
          continue;
        }
        if (caminho.includes(componente.id) || nivel + 1 > MAX_NIVEIS_DE_FICHA) {
          registrar({ tipo: "FICHA_EM_CICLO", origem, insumo: componente.nome, detalhe: `Ficha que usa a si mesma ou com fichas dentro de fichas além de ${MAX_NIVEIS_DE_FICHA} níveis.` });
          completa = false;
          continue;
        }
        const fator = resolveUnitFactor(item.unidade, componente.unidadeRendimento, []);
        if (fator == null) {
          registrar({
            tipo: "SEM_CONVERSAO",
            origem,
            insumo: componente.nome,
            detalhe: `Sem conversão de ${normalizarUnidade(item.unidade) || "(vazio)"} para ${normalizarUnidade(componente.unidadeRendimento) || "(vazio)"}.`
          });
          completa = false;
          continue;
        }
        const unidadesDoComponente = unidades * (item.quantidade / rendimento) * fator * (1 + item.perda);
        if (!expandir(componente, unidadesDoComponente, origem, [...caminho, componente.id], nivel + 1)) completa = false;
        continue;
      }
      const fator = resolveUnitFactor(item.unidade, item.unidadeEstoque, item.conversoes);
      if (fator == null) {
        registrar({
          tipo: "SEM_CONVERSAO",
          origem,
          insumo: item.insumo,
          detalhe: `Sem conversão de ${normalizarUnidade(item.unidade) || "(vazio)"} para ${normalizarUnidade(item.unidadeEstoque) || "(vazio)"}.`
        });
        completa = false;
        continue;
      }
      somar(item.insumoId, item.insumo, item.unidadeEstoque ?? item.unidade, unidades * (item.quantidade / rendimento) * fator * (1 + item.perda), "fichas");
    }
    return completa;
  };

  let receitaTotal = 0;
  let receitaCoberta = 0;
  let receitaBuffet = 0;

  for (const venda of vendas) {
    const comReceita = venda.valor > 0;
    if (ehBuffet(venda.nome)) {
      if (comReceita) receitaBuffet += venda.valor;
      continue;
    }
    if (comReceita) receitaTotal += venda.valor;

    const naoCoberto = (motivo: MotivoSemCobertura) => {
      if (comReceita) semCobertura.push({ codigo: venda.codigo, nome: venda.nome, categoria: venda.categoria, receita: round2(venda.valor), quantidade: venda.quantidade, motivo });
    };

    const pratoId = venda.codigo ? pratoDoCodigo.get(venda.codigo) : undefined;
    if (pratoId !== undefined) {
      const ficha = fichaPorId.get(pratoId);
      if (!ficha) {
        registrar({ tipo: "PRATO_INDISPONIVEL", origem: venda.nome, detalhe: "O produto está vinculado a um prato que foi desativado ou saiu do cardápio do salão." });
        naoCoberto("PRATO_INDISPONIVEL");
        continue;
      }
      if (!ficha.rendimentoEmPorcao) {
        registrar({ tipo: "RENDIMENTO_NAO_E_PORCAO", origem: ficha.nome, detalhe: "A ficha rende em peso ou volume, não em porções: cada venda não equivale a uma receita." });
        naoCoberto("RENDIMENTO_NAO_E_PORCAO");
        continue;
      }
      if (ficha.itens.length === 0) {
        naoCoberto("FICHA_SEM_ITENS");
        continue;
      }
      if (!expandir(ficha, venda.quantidade, ficha.nome, [ficha.id], 0)) {
        naoCoberto("FICHA_INCOMPLETA");
        continue;
      }
      if (comReceita) receitaCoberta += venda.valor;
      continue;
    }

    const ligacao = venda.codigo ? insumoDoCodigo.get(venda.codigo) : undefined;
    if (ligacao) {
      const fator = resolveUnitFactor(ligacao.unidade, ligacao.unidadeEstoque, ligacao.conversoes);
      if (fator == null) {
        registrar({
          tipo: "SEM_CONVERSAO",
          origem: venda.nome,
          insumo: ligacao.insumo,
          detalhe: `Sem conversão de ${normalizarUnidade(ligacao.unidade) || "(vazio)"} para ${normalizarUnidade(ligacao.unidadeEstoque) || "(vazio)"}.`
        });
        naoCoberto("SEM_CONVERSAO");
        continue;
      }
      somar(ligacao.insumoId, ligacao.insumo, ligacao.unidadeEstoque ?? ligacao.unidade, venda.quantidade * ligacao.quantidade * fator, "revenda");
      if (comReceita) receitaCoberta += venda.valor;
      continue;
    }

    naoCoberto("SEM_VINCULO");
  }

  const insumos: InsumoConsumido[] = [...acumulado.entries()]
    .map(([insumoId, a]) => ({
      insumoId,
      insumo: a.insumo,
      unidade: a.unidade,
      consumo: round4(a.fichas + a.revenda),
      consumoFichas: round4(a.fichas),
      consumoRevenda: round4(a.revenda)
    }))
    .sort((a, b) => a.insumo.localeCompare(b.insumo, "pt-BR"));

  const ordenado = [...semCobertura].sort((a, b) => b.receita - a.receita);

  return {
    periodo,
    insumos,
    cobertura: {
      receitaTotal: round2(receitaTotal),
      receitaCoberta: round2(receitaCoberta),
      pct: receitaTotal > 0 ? round4(receitaCoberta / receitaTotal) : 0,
      receitaBuffet: round2(receitaBuffet),
      semVinculoTotal: ordenado.length
    },
    semVinculo: ordenado.slice(0, MAX_SEM_VINCULO),
    problemas: [...problemas.values()]
  };
}
