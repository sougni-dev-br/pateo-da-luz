// Impressão da tela de férias "como se apresenta": linha do tempo ou lista, com as escolhas de
// papel, orientação, período e empresas. Aqui só as contas e os valores padrão.
import type { ListaFerias } from "../../../api/client";
import { type Eixo, criarEixoEntre } from "./eixoDoTempo";
import { somaDias } from "./feriasFormato";

export type Papel = "A4" | "A3";
export type Orientacao = "landscape" | "portrait";
export type MesesNaFolha = 3 | 6 | 12 | 18;

export type OpcoesTela = {
  papel: Papel;
  orientacao: Orientacao;
  meses: MesesNaFolha;
  legenda: boolean;
  cobertura: boolean;
  /** Empresas desmarcadas (vazio = todas as que aparecem na tela). */
  semEmpresa: string[];
};

export const OPCOES_PADRAO: OpcoesTela = { papel: "A4", orientacao: "landscape", meses: 12, legenda: true, cobertura: true, semEmpresa: [] };

export const MESES_OPCOES: MesesNaFolha[] = [3, 6, 12, 18];

const PAPEIS_MM: Record<Papel, { largura: number; altura: number }> = { A4: { largura: 210, altura: 297 }, A3: { largura: 297, altura: 420 } };
const MARGEM_MM = 10;
const PX_POR_MM = 96 / 25.4;
/** Largura da coluna com o nome, na folha (px a 96 dpi). */
export const NOME_NA_FOLHA_PX = 214;

/** Largura útil da folha (sem as margens), em px a 96 dpi: é onde a linha do tempo precisa caber. */
export function larguraUtilPx({ papel, orientacao }: Pick<OpcoesTela, "papel" | "orientacao">): number {
  const p = PAPEIS_MM[papel];
  const largura = orientacao === "landscape" ? p.altura : p.largura;
  return Math.floor((largura - 2 * MARGEM_MM) * PX_POR_MM);
}

/** `@page` da folha escolhida; entra na página só enquanto imprime. */
export const estiloDePagina = ({ papel, orientacao }: Pick<OpcoesTela, "papel" | "orientacao">) =>
  `@page { size: ${papel} ${orientacao}; margin: ${MARGEM_MM}mm; }`;

/** O período impresso começa no mês atual (como a escala da tela) e dura `meses` meses (3 = trimestre); tudo cabe na largura da folha. */
export function eixoDaFolha(hoje: string, opcoes: Pick<OpcoesTela, "papel" | "orientacao" | "meses">): Eixo {
  const largura = larguraUtilPx(opcoes) - NOME_NA_FOLHA_PX - 2;
  const [ano, mes] = hoje.split("-").map(Number);
  const inicio = new Date(Date.UTC(ano, mes - 1, 1)).toISOString().slice(0, 10);
  const fim = somaDias(new Date(Date.UTC(ano, mes - 1 + opcoes.meses, 1)).toISOString().slice(0, 10), -1);
  return criarEixoEntre(inicio, fim, largura);
}

const ROTULO_VISAO = { linha: "Linha do tempo", lista: "Lista" } as const;
export const tituloDaFolha = (visao: keyof typeof ROTULO_VISAO) => `Férias · ${ROTULO_VISAO[visao]}`;

/** Nome sugerido para o arquivo ao salvar em PDF (o navegador usa o título da página). */
export const nomeDoArquivo = (visao: keyof typeof ROTULO_VISAO, lista: Pick<ListaFerias, "hoje">) =>
  `Ferias - ${ROTULO_VISAO[visao]} - ${lista.hoje}`;
