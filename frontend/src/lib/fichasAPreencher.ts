import type { BuffetDish, DishListItem } from "../api/client";
import { folhaDoBuffet, folhaDoNome, type FolhaDados } from "./folhaDaFicha";
import { normalizarBusca, situacaoDaFicha } from "./fichaTecnica";
import { ROTULO_DO_CARDAPIO } from "./categoriasDasFichas";

// A fila de fichas por preencher: o que o responsável cobra da cozinha. Três origens, nesta ordem de urgência:
// preparações criadas pelo lançamento de desperdício (a perda já está sem valor), pratos cadastrados que
// nunca tiveram ficha, fichas com custo parcial e, por último, as fichas montadas que a cozinha ainda não conferiu
// (todas começam assim: ficha fiel é a que a cozinha confirmou). Funções puras; a tela só desenha.

export type GrupoAPreencher = "aguardando" | "sem-ficha" | "incompleta" | "a-conferir";

export type ItemAPreencher = {
  /** O mesmo id do prato: abre a ficha dele. */
  id: string;
  nome: string;
  grupo: GrupoAPreencher;
  /** Uma linha de contexto: onde está, o que já foi perdido, quem pediu. */
  detalhe: string;
  /** Quanto pesa a pressa: perda lançada (só nas preparações do buffet). */
  lancamentos: number;
  folha: FolhaDados;
};

export type FilaAPreencher = Record<GrupoAPreencher, ItemAPreencher[]> & {
  /** Preparações do buffet que já têm ficha: ficam à mão, fora da contagem do que falta. */
  buffetComFicha: BuffetDish[];
  total: number;
};

const porNome = (a: ItemAPreencher, b: ItemAPreencher) => a.nome.localeCompare(b.nome, "pt-BR");

const quantidade = (valor: number, unidade: string) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${unidade}`;

function detalheDoPrato(prato: DishListItem): string {
  const categoria = prato.category ? (prato.category.parentName ? `${prato.category.parentName} › ${prato.category.name}` : prato.category.name) : "Sem categoria";
  return `${ROTULO_DO_CARDAPIO[prato.menu]} · ${categoria}`;
}

function detalheDoBuffet(p: BuffetDish): string {
  const perda = p.wasteEntries > 0
    ? `${p.wasteEntries} ${p.wasteEntries === 1 ? "lançamento" : "lançamentos"} · ${quantidade(p.wasteQuantity, p.unit)} perdidos`
    : "Nenhum lançamento ainda";
  return `${perda}${p.requestedBy ? ` · pedido por ${p.requestedBy}` : ""}`;
}

export function montarFilaAPreencher(pratos: DishListItem[], buffet: BuffetDish[]): FilaAPreencher {
  const aguardando = buffet
    .filter((p) => p.pending)
    .map<ItemAPreencher>((p) => ({ id: p.id, nome: p.name, grupo: "aguardando", detalhe: detalheDoBuffet(p), lancamentos: p.wasteEntries, folha: folhaDoBuffet(p) }))
    // O que mais saiu primeiro: é onde a falta de valor mais pesa na Análise.
    .sort((a, b) => b.lancamentos - a.lancamentos || porNome(a, b));

  const doCardapio = (grupo: GrupoAPreencher) => pratos
    .filter((prato) => prato.isActive && situacaoDaFicha(prato) === (grupo === "sem-ficha" ? "sem-ficha" : "incompleta"))
    .map<ItemAPreencher>((prato) => ({ id: prato.id, nome: prato.name, grupo, detalhe: detalheDoPrato(prato), lancamentos: 0, folha: folhaDoNome(prato) }))
    .sort(porNome);

  const semFicha = doCardapio("sem-ficha");
  const incompleta = doCardapio("incompleta");
  // Ficha montada e completa que ninguém conferiu: a cozinha confirma os ingredientes e as quantidades.
  const aConferir = pratos
    .filter((prato) => prato.isActive && prato.itemsCount > 0 && !prato.conferidaEm && situacaoDaFicha(prato) !== "sem-ficha" && situacaoDaFicha(prato) !== "incompleta")
    .map<ItemAPreencher>((prato) => ({ id: prato.id, nome: prato.name, grupo: "a-conferir", detalhe: prato.fichaDeProducao ? "Ficha de produção" : detalheDoPrato(prato), lancamentos: 0, folha: folhaDoNome(prato) }))
    .sort(porNome);
  return {
    aguardando,
    "sem-ficha": semFicha,
    incompleta,
    "a-conferir": aConferir,
    buffetComFicha: buffet.filter((p) => !p.pending),
    total: aguardando.length + semFicha.length + incompleta.length + aConferir.length
  };
}

/** Busca sem acento nos nomes de uma lista de itens. */
export function filtrarAPreencher(itens: ItemAPreencher[], busca: string): ItemAPreencher[] {
  const termo = normalizarBusca(busca);
  return termo ? itens.filter((i) => normalizarBusca(i.nome).includes(termo)) : itens;
}
