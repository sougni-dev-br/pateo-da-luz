// Números do painel de Fichas Técnicas, tirados só da lista de pratos (nada de venda: o ERP ainda
// não cruza ficha com mix de vendas). Por isso o CMV médio é a média SIMPLES dos pratos, e o painel
// diz isso. Só entram na análise pratos ativos, com ingredientes, custo completo e preço de venda —
// custo parcial subestima o CMV e contaminaria a média.

import type { DishListItem } from "../api/client";
import { CMV_ALTO, CMV_BOM, faixaDeCmv, situacaoDaFicha } from "./fichaTecnica";

export type PratoAnalisavel = DishListItem & { cmvPercentual: number; margemBruta: number };

export type PainelDasFichas = {
  ativos: number;
  comFicha: number;
  percentualComFicha: number;
  /** Pratos que entram no CMV e na margem. */
  analisaveis: number;
  cmvMedio: number | null;
  margemMedia: number | null;
  distribuicao: { bom: number; atencao: number; alto: number };
  pendencias: { semFicha: number; incompletas: number; semPreco: number; cmvAlto: number };
  maioresCmv: PratoAnalisavel[];
  maioresMargens: PratoAnalisavel[];
  porCategoria: Array<{ id: string | null; nome: string; pratos: number; cmvMedio: number }>;
};

const TOPO = 5;
const SEM_CATEGORIA = "Sem categoria";

export function ehAnalisavel(prato: DishListItem): prato is PratoAnalisavel {
  return (
    prato.isActive &&
    prato.itemsCount > 0 &&
    !prato.custoIncompleto &&
    prato.cmvPercentual != null &&
    prato.margemBruta != null &&
    Number.isFinite(prato.cmvPercentual)
  );
}

const media = (valores: number[]): number | null =>
  valores.length === 0 ? null : valores.reduce((soma, v) => soma + v, 0) / valores.length;

export function montarPainel(pratos: DishListItem[]): PainelDasFichas {
  const ativos = pratos.filter((prato) => prato.isActive);
  const analisaveis = ativos.filter(ehAnalisavel);
  const comFicha = ativos.filter((prato) => prato.itemsCount > 0).length;

  const distribuicao = { bom: 0, atencao: 0, alto: 0 };
  for (const prato of analisaveis) {
    const faixa = faixaDeCmv(prato.cmvPercentual);
    if (faixa?.tom === "success") distribuicao.bom += 1;
    else if (faixa?.tom === "warning") distribuicao.atencao += 1;
    else distribuicao.alto += 1;
  }

  const pendencias = { semFicha: 0, incompletas: 0, semPreco: 0, cmvAlto: 0 };
  for (const prato of ativos) {
    const situacao = situacaoDaFicha(prato);
    if (situacao === "sem-ficha") pendencias.semFicha += 1;
    else if (situacao === "incompleta") pendencias.incompletas += 1;
    else if (situacao === "sem-preco") pendencias.semPreco += 1;
    else if (situacao === "cmv-alto") pendencias.cmvAlto += 1;
  }

  const grupos = new Map<string, { id: string | null; nome: string; cmvs: number[] }>();
  for (const prato of analisaveis) {
    const chave = prato.category?.id ?? "__sem__";
    const grupo = grupos.get(chave) ?? { id: prato.category?.id ?? null, nome: prato.category?.name ?? SEM_CATEGORIA, cmvs: [] };
    grupo.cmvs.push(prato.cmvPercentual);
    grupos.set(chave, grupo);
  }

  return {
    ativos: ativos.length,
    comFicha,
    percentualComFicha: ativos.length > 0 ? Math.round((comFicha / ativos.length) * 100) : 0,
    analisaveis: analisaveis.length,
    cmvMedio: media(analisaveis.map((prato) => prato.cmvPercentual)),
    margemMedia: media(analisaveis.map((prato) => prato.margemBruta)),
    distribuicao,
    pendencias,
    maioresCmv: [...analisaveis].sort((a, b) => b.cmvPercentual - a.cmvPercentual || a.name.localeCompare(b.name, "pt-BR")).slice(0, TOPO),
    maioresMargens: [...analisaveis].sort((a, b) => b.margemBruta - a.margemBruta || a.name.localeCompare(b.name, "pt-BR")).slice(0, TOPO),
    porCategoria: [...grupos.values()]
      .map((grupo) => ({ id: grupo.id, nome: grupo.nome, pratos: grupo.cmvs.length, cmvMedio: media(grupo.cmvs) ?? 0 }))
      .sort((a, b) => b.cmvMedio - a.cmvMedio || a.nome.localeCompare(b.nome, "pt-BR"))
  };
}

/** Frase curta que resume a saúde do cardápio; null quando ainda não há prato analisável. */
export function veredito(painel: PainelDasFichas): { tom: "success" | "warning" | "danger"; texto: string } | null {
  if (painel.cmvMedio == null || painel.analisaveis === 0) return null;
  const { alto, atencao } = painel.distribuicao;
  if (painel.cmvMedio > CMV_ALTO) return { tom: "danger", texto: `CMV médio acima de ${CMV_ALTO}%: o cardápio está caro de produzir.` };
  if (alto > 0) return { tom: "warning", texto: `${alto} prato${alto === 1 ? "" : "s"} com CMV acima de ${CMV_ALTO}% puxam o resultado.` };
  if (painel.cmvMedio > CMV_BOM || atencao > 0) return { tom: "warning", texto: "Cardápio dentro do limite, mas com pratos em atenção." };
  return { tom: "success", texto: `Cardápio saudável: todos os pratos analisados estão até ${CMV_BOM}% de CMV.` };
}
