// Naturezas das compras no Dashboard: rótulo curto, cor e qual visão abrir.
import type { DashboardNatureKey } from "../../api/client";

export type VisaoCompras = "TODAS" | DashboardNatureKey;

/** Plural curto: a tela de Produtos usa a frase longa ("Insumo ou mercadoria"). */
export const ROTULO_NATUREZA: Record<DashboardNatureKey, string> = {
  INSUMO: "Insumos",
  EMBALAGEM: "Embalagens",
  CONSUMO: "Consumo",
  DURAVEL: "Duráveis",
  SERVICO: "Serviços",
  SEM_NATUREZA: "Sem natureza",
};

export const DICA_NATUREZA: Record<DashboardNatureKey, string> = {
  INSUMO: "Comida, bebida e mercadoria — o que vira prato ou é revendido",
  EMBALAGEM: "Embalagens e descartáveis",
  CONSUMO: "Limpeza, escritório e outros materiais que se gastam",
  DURAVEL: "Utensílios, equipamentos e uniformes",
  SERVICO: "Serviços e despesas",
  SEM_NATUREZA: "Produtos ainda sem natureza no cadastro",
};

/**
 * Ordem fixa e cor por natureza (validadas para daltonismo e contraste).
 * A cor segue a natureza, nunca a posição: filtrar não repinta ninguém.
 */
export const COR_NATUREZA: Record<DashboardNatureKey, string> = {
  INSUMO: "#a8781f",
  EMBALAGEM: "#4a76b0",
  CONSUMO: "#3d8a3f",
  DURAVEL: "#8a5cb8",
  SERVICO: "#c0563f",
  SEM_NATUREZA: "#98a2b3",
};

export type Segmento = {
  chave: DashboardNatureKey | "SEM_ITENS";
  rotulo: string;
  total: number;
  pct: number;
};

/**
 * Composição das compras do mês: as naturezas mais o que as notas cobram sem
 * item (nota sem itemização). Segmento negativo não é desenhado.
 */
export function composicao(
  byNature: Array<{ nature: DashboardNatureKey; total: number }>,
  unitemizedTotal: number,
): Segmento[] {
  const partes: Array<Omit<Segmento, "pct">> = byNature
    .filter((n) => n.total > 0)
    .map((n) => ({ chave: n.nature, rotulo: ROTULO_NATUREZA[n.nature], total: n.total }));
  if (unitemizedTotal > 0) partes.push({ chave: "SEM_ITENS", rotulo: "Fora dos itens", total: unitemizedTotal });
  const soma = partes.reduce((s, p) => s + p.total, 0);
  return partes.map((p) => ({ ...p, pct: soma > 0 ? (p.total / soma) * 100 : 0 }));
}

/**
 * Abre em Insumos quando houver: é o que o dono chama de "produto". Serviço de
 * manutenção no meio do salmão e da alcatra era justamente a reclamação.
 */
export function visaoInicial(byNature: Array<{ nature: DashboardNatureKey; total: number }>): VisaoCompras {
  return byNature.some((n) => n.nature === "INSUMO" && n.total > 0) ? "INSUMO" : "TODAS";
}
