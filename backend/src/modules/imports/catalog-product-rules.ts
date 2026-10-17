/**
 * Regras da planilha de catálogo de produtos que não dependem do banco.
 *
 * A planilha-modelo ainda traz o vocabulário antigo (setor "NÃO BATER EST", categorias INSUMOS e DESPESAS).
 * Esse setor foi aposentado: "não se conta" é o controle de estoque desligado, não um setor. Então a linha
 * com esse setor não cria nem usa setor, e não pede setor.
 */
import { normalizeText } from "../../shared/utils/normalize-text.js";
import type { ProductNatureValue } from "../products/product-nature.js";

const SETORES_APOSENTADOS = new Set(["nao bater est", "nao bater estoque"]);

export function ehSetorAposentado(nome: string | null | undefined): boolean {
  return SETORES_APOSENTADOS.has(normalizeText(nome));
}

export function shouldControlStock(sectorName?: string | null, accountType?: string | null): boolean {
  const account = normalizeText(accountType);
  if (ehSetorAposentado(sectorName)) return false;
  if (account === "custo fixo" || account === "custo variavel") return false;
  return true;
}

export type SetorInterpretado = {
  sectorName: string | null;
  /** A linha veio com o setor aposentado: o produto fica sem setor (desvincula, não apenas "não mexe"). */
  setorAposentado: boolean;
  controlsStock: boolean;
  missingSector: boolean;
  countableInGeneral: boolean;
  countableInSectoral: boolean;
  countabilityReasons: string[];
};

/**
 * @param rawSectorName texto da célula, antes de qualquer filtro (distingue "vazio" de "inválido")
 * @param sectorName    setor já passado pelo porteiro de escrita de setor (null se vazio ou lixo)
 */
export function interpretarSetorDaPlanilha(
  rawSectorName: string | null,
  sectorName: string | null,
  accountType: string | null
): SetorInterpretado {
  const controlsStock = shouldControlStock(sectorName, accountType);
  if (ehSetorAposentado(sectorName)) {
    return {
      sectorName: null,
      setorAposentado: true,
      controlsStock: false,
      missingSector: false,
      countableInGeneral: false,
      countableInSectoral: false,
      countabilityReasons: ["SEM_CONTROLE_ESTOQUE"]
    };
  }
  return {
    sectorName,
    setorAposentado: false,
    controlsStock,
    missingSector: !sectorName,
    countableInGeneral: controlsStock,
    countableInSectoral: Boolean(sectorName) && controlsStock,
    countabilityReasons: [
      ...(!sectorName ? [rawSectorName ? "SETOR_INVALIDO" : "SEM_SETOR"] : []),
      ...(!controlsStock ? ["SEM_CONTROLE_ESTOQUE"] : [])
    ]
  };
}

/**
 * Quem decide o controle de estoque de um produto NOVO: se a linha diz que não controla (setor aposentado,
 * custo fixo ou variável), isso vale mesmo que a natureza da categoria sugira o contrário; senão vale o
 * padrão da natureza, e sem natureza vale o que a linha diz.
 */
export function controleDeEstoqueDoProdutoNovo(linhaControla: boolean, padraoDaNatureza: boolean | null): boolean {
  if (!linhaControla) return false;
  return padraoDaNatureza ?? linhaControla;
}

export type DadosDeCriacaoEntrada = {
  /** Dados da linha da planilha (categoria e subcategoria da própria planilha). */
  linha: { categoryId?: string; subcategoryId?: string; controlsStock: boolean };
  /** Resultado de estruturaDeProdutoNovo; nulo se o produto já existe. */
  estrutura: { categoryId: string | null | undefined; padrao: { nature: ProductNatureValue | null; dreCategoryId: string | null; controlsStock: boolean | null } } | null;
};

/** Categoria, subcategoria, natureza, DRE usual e estoque com que o produto novo é criado. */
export function dadosDeCriacaoDoProduto({ linha, estrutura }: DadosDeCriacaoEntrada) {
  const categoryId = estrutura ? (estrutura.categoryId ?? undefined) : linha.categoryId;
  return {
    categoryId,
    // A subcategoria da planilha pertencia à categoria dela: se o produto caiu em outra (ou em nenhuma), não vale.
    subcategoryId: categoryId === linha.categoryId ? linha.subcategoryId : undefined,
    nature: estrutura?.padrao.nature ?? null,
    dreCategoryId: estrutura?.padrao.dreCategoryId ?? null,
    controlsStock: controleDeEstoqueDoProdutoNovo(linha.controlsStock, estrutura?.padrao.controlsStock ?? null)
  };
}
