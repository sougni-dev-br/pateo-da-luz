import { normalizarUnidade, resolveUnitFactor } from "../../shared/unidades/conversao.js";
import { pecaSemConversao } from "../../shared/unidades/conversao-manual.js";
import { proporConversoes } from "../../shared/unidades/conversao-automatica.js";
import type { ProdutoCarregadoParaConversao } from "../products/conversao-automatica.service.js";

// Rotina de conversões do estoquista: todo produto que controla estoque aparece com a situação da conversão —
// ainda sem cadastro (PENDENTE), cadastrada mas faltando uma unidade em uso (PARCIAL), tudo cadastrado
// (CADASTRADO) ou conferido como "não precisa" (NAO_PRECISA). O que falta primeiro é o que a cozinha mais pede.

export type OrigemDaPendencia = "COMPRA" | "CADASTRO" | "NOME_PECA";
export type StatusDaConversao = "PENDENTE" | "PARCIAL" | "CADASTRADO" | "NAO_PRECISA";

export type PendenciaDeUnidade = {
  unidade: string;
  origem: OrigemDaPendencia;
  /** Linhas de compra nessa unidade que ainda não convertem. */
  linhas: number;
  valor: number;
  /** O que o nome e as compras sugerem; null quando o sistema não tem palpite. */
  proposta: { factor: number; confianca: "alta" | "baixa"; motivo: string } | null;
};

export type ConversaoCadastrada = { fromUnit: string; toUnit: string; factor: number };

export type ProdutoDaRotina = {
  productId: string;
  codigo: string | null;
  nome: string;
  unidadeDeContagem: string;
  saldo: number | null;
  sectorId: string | null;
  sectorName: string | null;
  status: StatusDaConversao;
  conversoes: ConversaoCadastrada[];
  pendencias: PendenciaDeUnidade[];
  /** Quantas vezes o produto saiu em requisição nos últimos 90 dias: quem a cozinha mais pede vem antes. */
  usosEmRequisicoes: number;
  conferidoPorNome: string | null;
  conferidoEm: string | null;
};

export type ResumoDaRotina = { total: number; pendentes: number; parciais: number; cadastrados: number; naoPrecisa: number };

export type ApoioDaRotina = {
  saldos: Map<string, number>;
  controlaEstoque: Set<string>;
  setores: Map<string, { id: string; nome: string }>;
  setorDoProduto: Map<string, string>;
  usos: Map<string, number>;
  conferencias: Map<string, { por: string | null; em: string }>;
};

const peso = (x: ProdutoDaRotina) => x.pendencias.reduce((s, y) => s + y.valor, 0);
const aFazer = (x: ProdutoDaRotina) => x.status === "PENDENTE" || x.status === "PARCIAL";

export function montarRotina(carregados: ProdutoCarregadoParaConversao[], apoio: ApoioDaRotina): { produtos: ProdutoDaRotina[]; resumo: ResumoDaRotina } {
  const produtos: ProdutoDaRotina[] = [];
  for (const p of carregados) {
    if (!apoio.controlaEstoque.has(p.productId)) continue;
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
      const linhas = (atual?.linhas ?? 0) + nota.linhas;
      porUnidade.set(unidade, {
        unidade,
        origem: linhas > 0 ? "COMPRA" : "CADASTRO",
        linhas,
        valor: (atual?.valor ?? 0) + nota.valor,
        proposta: proposta ? { factor: proposta.factor, confianca: proposta.confianca, motivo: proposta.motivo } : null
      });
    }
    // "BACON PEÇA" contado em KG: ninguém requisita 1 peça sem saber quanto ela pesa.
    if (!porUnidade.has("PÇ") && !porUnidade.has("UN") && pecaSemConversao(p.nome, p.contagem, p.entrada.cadastradas)) {
      porUnidade.set("PÇ", { unidade: "PÇ", origem: "NOME_PECA", linhas: 0, valor: 0, proposta: null });
    }
    const pendencias = Array.from(porUnidade.values()).sort((a, b) => b.valor - a.valor || b.linhas - a.linhas);
    const conversoes = p.entrada.cadastradas.map((c) => ({ fromUnit: normalizarUnidade(c.fromUnit), toUnit: normalizarUnidade(c.toUnit), factor: c.factor }));
    const conferencia = apoio.conferencias.get(p.productId);
    const status: StatusDaConversao = conferencia ? "NAO_PRECISA" : conversoes.length === 0 ? "PENDENTE" : pendencias.length > 0 ? "PARCIAL" : "CADASTRADO";
    const setor = apoio.setorDoProduto.get(p.productId);

    produtos.push({
      productId: p.productId,
      codigo: p.codigo,
      nome: p.nome,
      unidadeDeContagem: contagem,
      saldo: apoio.saldos.has(p.productId) ? apoio.saldos.get(p.productId)! : null,
      sectorId: setor ?? null,
      sectorName: setor ? apoio.setores.get(setor)?.nome ?? null : null,
      status,
      conversoes,
      pendencias,
      usosEmRequisicoes: apoio.usos.get(p.productId) ?? 0,
      conferidoPorNome: conferencia?.por ?? null,
      conferidoEm: conferencia?.em ?? null
    });
  }

  produtos.sort((a, b) =>
    Number(aFazer(b)) - Number(aFazer(a))
    || (aFazer(a) ? b.usosEmRequisicoes - a.usosEmRequisicoes || peso(b) - peso(a) : 0)
    || a.nome.localeCompare(b.nome, "pt-BR")
  );
  const contar = (s: StatusDaConversao) => produtos.filter((x) => x.status === s).length;
  return { produtos, resumo: { total: produtos.length, pendentes: contar("PENDENTE"), parciais: contar("PARCIAL"), cadastrados: contar("CADASTRADO"), naoPrecisa: contar("NAO_PRECISA") } };
}
