/**
 * Organização em lote de produtos: o que muda, o que é recusado e por quê.
 *
 * Só calcula, nada aqui grava. A rota usa o mesmo plano para simular e para aplicar, então o que o dono
 * viu no resumo é exatamente o que é gravado. A categoria DRE fica de fora de propósito: mudá-la reescreve
 * o histórico das compras fora do CMV e tem comparação própria.
 */
import { NATURE_DEFAULTS, type ProductNatureValue } from "./product-nature.js";

export type EstadoDoLote = {
  categoryId: string | null;
  subcategoryId: string | null;
  inventorySectorId: string | null;
  nature: ProductNatureValue | null;
  controlsStock: boolean;
  isActive: boolean;
};

export type ProdutoDoLote = EstadoDoLote & { id: string; name: string; externalCode: string | null };

/** Campo ausente não muda; `null` limpa (subcategoria e setor). */
export type MudancasDoLote = {
  categoryId?: string;
  subcategoryId?: string | null;
  inventorySectorId?: string | null;
  nature?: ProductNatureValue;
  controlsStock?: boolean;
  isActive?: boolean;
};

export type ContextoDoLote = {
  categorias: Map<string, { id: string; name: string; nature: ProductNatureValue | null }>;
  subcategorias: Map<string, { id: string; name: string; categoryId: string }>;
  setores: Map<string, { id: string; name: string; isActive: boolean }>;
};

export type ItemAlterado = {
  id: string;
  name: string;
  antes: EstadoDoLote;
  depois: EstadoDoLote;
  /** Só os campos que mudam: é o que vai para o banco. */
  patch: Partial<EstadoDoLote>;
};

export type PlanoDoLote = {
  alterar: ItemAlterado[];
  semMudanca: number;
  recusados: Array<{ id: string; name: string; motivo: string }>;
  recusadosPorMotivo: Array<{ motivo: string; count: number; exemplos: string[] }>;
  contagens: { categoria: number; subcategoria: number; setor: number; natureza: number; estoque: number; situacao: number };
  avisos: string[];
};

const CAMPOS: Array<keyof EstadoDoLote> = ["categoryId", "subcategoryId", "inventorySectorId", "nature", "controlsStock", "isActive"];
const EXEMPLOS_POR_MOTIVO = 3;

export function aplicarMudancasAoEstado(estado: EstadoDoLote, patch: Partial<EstadoDoLote>): EstadoDoLote {
  const resultado: EstadoDoLote = {
    categoryId: estado.categoryId,
    subcategoryId: estado.subcategoryId,
    inventorySectorId: estado.inventorySectorId,
    nature: estado.nature,
    controlsStock: estado.controlsStock,
    isActive: estado.isActive
  };
  return { ...resultado, ...patch };
}

/** Desfazer só devolve o produto que ainda está como o lote o deixou; quem foi editado depois fica como está. */
export function desfazerEhSeguro(atual: EstadoDoLote, esperado: EstadoDoLote): boolean {
  return CAMPOS.every((campo) => atual[campo] === esperado[campo]);
}

function patchDoProduto(produto: ProdutoDoLote, mudancas: MudancasDoLote): Partial<EstadoDoLote> {
  const patch: Partial<EstadoDoLote> = {};
  if (mudancas.categoryId !== undefined && mudancas.categoryId !== produto.categoryId) patch.categoryId = mudancas.categoryId;
  if (mudancas.subcategoryId !== undefined) {
    if (mudancas.subcategoryId !== produto.subcategoryId) patch.subcategoryId = mudancas.subcategoryId;
  } else if (patch.categoryId !== undefined && produto.subcategoryId !== null) {
    patch.subcategoryId = null;
  }
  if (mudancas.inventorySectorId !== undefined && mudancas.inventorySectorId !== produto.inventorySectorId) patch.inventorySectorId = mudancas.inventorySectorId;
  if (mudancas.nature !== undefined && mudancas.nature !== produto.nature) patch.nature = mudancas.nature;
  if (mudancas.controlsStock !== undefined && mudancas.controlsStock !== produto.controlsStock) patch.controlsStock = mudancas.controlsStock;
  if (mudancas.isActive !== undefined && mudancas.isActive !== produto.isActive) patch.isActive = mudancas.isActive;
  return patch;
}

/** Motivo da recusa, ou null se o produto pode receber o lote. */
function motivoDeRecusa(depois: EstadoDoLote, patch: Partial<EstadoDoLote>, mudancas: MudancasDoLote, contexto: ContextoDoLote): string | null {
  if (mudancas.categoryId !== undefined && !contexto.categorias.has(mudancas.categoryId)) return "Categoria não encontrada.";
  if (typeof mudancas.subcategoryId === "string" && !contexto.subcategorias.has(mudancas.subcategoryId)) return "Subcategoria não encontrada.";
  if (typeof mudancas.inventorySectorId === "string") {
    const setor = contexto.setores.get(mudancas.inventorySectorId);
    if (!setor || !setor.isActive) return "Setor não encontrado ou inativo.";
  }

  if (depois.subcategoryId) {
    const sub = contexto.subcategorias.get(depois.subcategoryId);
    if (sub && sub.categoryId !== depois.categoryId) return "A subcategoria não pertence à categoria final do produto.";
  }

  const mexeEmEstoque = patch.nature !== undefined || patch.controlsStock !== undefined;
  if (mexeEmEstoque && depois.nature === "DURAVEL" && depois.controlsStock) {
    return "Durável não entra na contagem enquanto o escopo do CMV não for isolado: desligue o controle de estoque junto.";
  }

  const mexeEmContagem = patch.inventorySectorId !== undefined || patch.controlsStock !== undefined || patch.isActive !== undefined;
  const fisico = depois.nature === null || NATURE_DEFAULTS[depois.nature].fisico;
  if (mexeEmContagem && fisico && depois.controlsStock && depois.isActive && !depois.inventorySectorId) {
    return "Produto que conta estoque precisa de setor: escolha o setor junto.";
  }
  return null;
}

function agruparRecusas(recusados: PlanoDoLote["recusados"]): PlanoDoLote["recusadosPorMotivo"] {
  const grupos = new Map<string, { count: number; exemplos: string[] }>();
  for (const recusado of recusados) {
    const grupo = grupos.get(recusado.motivo) ?? { count: 0, exemplos: [] };
    grupo.count += 1;
    if (grupo.exemplos.length < EXEMPLOS_POR_MOTIVO) grupo.exemplos.push(recusado.name);
    grupos.set(recusado.motivo, grupo);
  }
  return [...grupos.entries()].map(([motivo, grupo]) => ({ motivo, ...grupo })).sort((a, b) => b.count - a.count);
}

function montarAvisos(alterar: ItemAlterado[], contexto: ContextoDoLote): string[] {
  const avisos: string[] = ["A categoria DRE dos produtos não muda por aqui: use \"Aplicar categoria DRE\", que tem conferência própria."];
  const entram = alterar.filter((item) => item.patch.controlsStock === true).length;
  const saem = alterar.filter((item) => item.patch.controlsStock === false).length;
  if (entram > 0) {
    avisos.push(`${entram} produto(s) passam a entrar na contagem de estoque; o fechamento do mês passa a exigir que sejam contados.`);
  }
  if (saem > 0) avisos.push(`${saem} produto(s) saem da contagem de estoque.`);

  const divergentes = alterar.filter((item) => {
    const natureza = item.depois.nature;
    const categoria = item.depois.categoryId ? contexto.categorias.get(item.depois.categoryId) : undefined;
    return natureza !== null && categoria?.nature != null && categoria.nature !== natureza;
  }).length;
  if (divergentes > 0) {
    avisos.push(`${divergentes} produto(s) ficam com natureza diferente da natureza da categoria escolhida.`);
  }
  return avisos;
}

export function planejarLote(produtos: ProdutoDoLote[], mudancas: MudancasDoLote, contexto: ContextoDoLote): PlanoDoLote {
  const alterar: ItemAlterado[] = [];
  const recusados: PlanoDoLote["recusados"] = [];
  let semMudanca = 0;

  for (const produto of produtos) {
    const patch = patchDoProduto(produto, mudancas);
    if (Object.keys(patch).length === 0) {
      semMudanca += 1;
      continue;
    }
    const antes = aplicarMudancasAoEstado(produto, {});
    const depois = aplicarMudancasAoEstado(produto, patch);
    const motivo = motivoDeRecusa(depois, patch, mudancas, contexto);
    if (motivo) {
      recusados.push({ id: produto.id, name: produto.name, motivo });
      continue;
    }
    alterar.push({ id: produto.id, name: produto.name, antes, depois, patch });
  }

  const conta = (campo: keyof EstadoDoLote) => alterar.filter((item) => item.patch[campo] !== undefined).length;
  return {
    alterar,
    semMudanca,
    recusados,
    recusadosPorMotivo: agruparRecusas(recusados),
    contagens: {
      categoria: conta("categoryId"),
      subcategoria: conta("subcategoryId"),
      setor: conta("inventorySectorId"),
      natureza: conta("nature"),
      estoque: conta("controlsStock"),
      situacao: conta("isActive")
    },
    avisos: montarAvisos(alterar, contexto)
  };
}
