// Conferencia de inventario: o que cada item contado quer dizer.
//
// A tela comparava o contado com o `expectedQuantity`, que e copiado do saldo do
// sistema — e esse saldo so soma compras, nunca baixa (ver estoque-nunca-baixa).
// Resultado: 38% dos itens "divergentes" contra um esperado de 4.589 kg de
// salmao, e nenhuma pista de qual divergencia importava.
//
// Aqui a referencia e o que e confiavel: a ultima contagem aprovada do produto
// mais as compras recebidas desde entao. Contar mais do que isso e impossivel
// (erro de contagem, de unidade ou compra nao lancada); zerar tendo havido
// entrada e suspeito. O resto e consumo, e so vira alerta quando foge do
// historico de contagens do proprio produto.

import { detectarEmbalagem, normalizarUnidade } from "../../shared/unidades/conversao.js";

export type ClasseConferencia =
  | "IMPOSSIVEL"
  | "ZERADO_SUSPEITO"
  | "FORA_DO_HISTORICO"
  | "SEM_REFERENCIA"
  | "PENDENTE"
  | "COERENTE";

/** Da mais grave para a menos grave: e a ordem em que a tela mostra. */
export const CLASSES_CONFERENCIA: readonly ClasseConferencia[] = [
  "IMPOSSIVEL",
  "ZERADO_SUSPEITO",
  "FORA_DO_HISTORICO",
  "SEM_REFERENCIA",
  "PENDENTE",
  "COERENTE"
];

export type HistoricoDeContagem = {
  mediana: number | null;
  menor: number | null;
  maior: number | null;
  observacoes: number;
};

export type EntradaConferencia = {
  nomeProduto: string;
  unidade: string | null;
  contado: number | null;
  /** Ultima contagem aprovada do produto. `null` = nunca foi contado num inventario aprovado. */
  anterior: number | null;
  /** Compras recebidas depois da contagem anterior, na unidade de estoque. */
  compras: number;
  custoUnitario: number | null;
  historico: HistoricoDeContagem;
};

export type ResultadoConferencia = {
  classe: ClasseConferencia;
  disponivel: number | null;
  consumo: number | null;
  /** Valor em R$ que ordena a lista. O que ele mede depende da classe (ver `impactoDe`). */
  impacto: number | null;
  motivo: string;
  /** Contagem em unidades de um produto vendido em embalagem: o valor certo provavel. */
  sugestao?: { quantidade: number; embalagem: number };
};

// Balanca e arredondamento de quem conta: 5% do disponivel, ou um centesimo.
const TOLERANCIA_RELATIVA = 0.05;
const TOLERANCIA_ABSOLUTA = 0.01;

// Mesmas bases da guarda de plausibilidade da tela de contagem
// (`/count-sessions/:id/plausibility`): uma contagem so nao e base, e historico
// que varia 20x e o proprio sintoma de confusao de unidade.
const MIN_OBSERVACOES = 2;
const FATOR_HISTORICO_ERRATICO = 20;
const FATOR_ACIMA_DO_MAIOR = 3;
const FATOR_ABAIXO_DA_MEDIANA = 10;

// Pacote com menos que isso nao produz o erro de contar a peca avulsa.
const EMBALAGEM_MINIMA_PARA_PISTA = 10;
const FATOR_ORDEM_DE_GRANDEZA = 10;

const EMBALAGEM_POR_EXTENSO: Record<string, string> = {
  PCT: "pacotes",
  CX: "caixas",
  FD: "fardos"
};

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function qtd(valor: number, unidade: string | null): string {
  const numero = formatoQuantidade.format(valor);
  return unidade ? `${numero} ${unidade}` : numero;
}

function emReais(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function vezesCusto(quantidade: number, custo: number | null): number | null {
  return custo == null ? null : emReais(Math.abs(quantidade) * custo);
}

function embalagemDoNome(nomeProduto: string) {
  return detectarEmbalagem(nomeProduto).find(
    (e) => e.nivel === "pacote" && e.unidade == null && e.confianca === "alta" && e.quantidade >= EMBALAGEM_MINIMA_PARA_PISTA
  );
}

// So sugere quando a conta fecha: dividir pelo tamanho da embalagem tem que
// caber no que havia. Senao a sugestao so troca um numero errado por outro.
function sugestaoDeEmbalagem(nomeProduto: string, contado: number, disponivel: number, tolerancia: number) {
  const embalagem = embalagemDoNome(nomeProduto);
  if (!embalagem) return undefined;
  const quantidade = Math.round((contado / embalagem.quantidade) * 1000) / 1000;
  if (quantidade <= 0 || quantidade > disponivel + tolerancia) return undefined;
  // E tem que estar na ordem de grandeza do que havia. GARRAFA C100: havia 18
  // garrafas e contou 82; 0,82 caixa "cabe", mas o erro ali e a unidade da compra.
  if (quantidade < disponivel / FATOR_ORDEM_DE_GRANDEZA) return undefined;
  return { quantidade, embalagem: embalagem.quantidade };
}

function pistaDeEmbalagem(nomeProduto: string, unidade: string | null): string {
  const embalagem = embalagemDoNome(nomeProduto);
  if (!embalagem) return "";
  const formatoQueDeviaSerContado = EMBALAGEM_POR_EXTENSO[normalizarUnidade(unidade ?? "")] ?? "embalagens";
  return ` O nome indica embalagem com ${formatoQuantidade.format(embalagem.quantidade)}: confira se foram contadas unidades em vez de ${formatoQueDeviaSerContado}.`;
}

function historicoServe(h: HistoricoDeContagem): h is { mediana: number; menor: number; maior: number; observacoes: number } {
  if (h.observacoes < MIN_OBSERVACOES || h.mediana == null || h.menor == null || h.maior == null) return false;
  if (h.menor <= 0 || h.mediana <= 0) return false;
  return h.maior / h.menor < FATOR_HISTORICO_ERRATICO;
}

export function classificarItemDaConferencia(e: EntradaConferencia): ResultadoConferencia {
  const u = e.unidade;

  if (e.contado == null) {
    return { classe: "PENDENTE", disponivel: null, consumo: null, impacto: null, motivo: "Sem quantidade lançada." };
  }
  const contado = e.contado;

  if (e.anterior == null) {
    return {
      classe: "SEM_REFERENCIA",
      disponivel: null,
      consumo: null,
      impacto: vezesCusto(contado, e.custoUnitario),
      motivo: "Sem contagem aprovada anterior para comparar."
    };
  }

  const disponivel = e.anterior + e.compras;
  const consumo = disponivel - contado;
  const tolerancia = Math.max(TOLERANCIA_ABSOLUTA, disponivel * TOLERANCIA_RELATIVA);

  if (contado > disponivel + tolerancia) {
    const sobra = contado - disponivel;
    const semCompra = e.compras === 0
      ? " Nenhuma compra lançada no período: se houve compra, ela não entrou no sistema."
      : "";
    const sugestao = sugestaoDeEmbalagem(e.nomeProduto, contado, disponivel, tolerancia);
    return {
      classe: "IMPOSSIVEL",
      disponivel,
      consumo,
      ...(sugestao ? { sugestao } : {}),
      impacto: vezesCusto(sobra, e.custoUnitario),
      motivo: `Contou ${qtd(contado, u)}, mas havia ${qtd(e.anterior, u)} e entraram ${qtd(e.compras, u)} no período: ${qtd(sobra, u)} sem origem.${semCompra}${pistaDeEmbalagem(e.nomeProduto, u)}`
    };
  }

  // Zerar o que sobrou da contagem anterior, sem compra no meio, e consumo
  // normal. Suspeito e entrar mercadoria no periodo e nao sobrar nada.
  if (contado === 0 && e.compras > TOLERANCIA_ABSOLUTA) {
    return {
      classe: "ZERADO_SUSPEITO",
      disponivel,
      consumo,
      impacto: vezesCusto(disponivel, e.custoUnitario),
      motivo: `Zerado, mas havia ${qtd(e.anterior, u)} e entraram ${qtd(e.compras, u)} no período.`
    };
  }

  if (historicoServe(e.historico)) {
    const h = e.historico;
    if (contado > h.maior * FATOR_ACIMA_DO_MAIOR) {
      return {
        classe: "FORA_DO_HISTORICO",
        disponivel,
        consumo,
        impacto: vezesCusto(contado - h.mediana, e.custoUnitario),
        motivo: `Contou ${qtd(contado, u)}, muito acima de tudo o que já foi contado (máximo ${qtd(h.maior, u)}).`
      };
    }
    if (contado > 0 && contado < h.mediana / FATOR_ABAIXO_DA_MEDIANA) {
      return {
        classe: "FORA_DO_HISTORICO",
        disponivel,
        consumo,
        impacto: vezesCusto(h.mediana - contado, e.custoUnitario),
        motivo: `Contou ${qtd(contado, u)}, muito abaixo do normal (mediana ${qtd(h.mediana, u)}).`
      };
    }
  }

  return {
    classe: "COERENTE",
    disponivel,
    consumo,
    impacto: vezesCusto(Math.max(consumo, 0), e.custoUnitario),
    motivo: motivoCoerente(contado, disponivel, consumo, e.anterior, u)
  };
}

function motivoCoerente(contado: number, disponivel: number, consumo: number, anterior: number, u: string | null): string {
  if (contado === 0 && disponivel <= TOLERANCIA_ABSOLUTA) return "Sem estoque e sem entrada no período.";
  if (contado === 0) return `Consumiu os ${qtd(anterior, u)} que havia; sem compra no período.`;
  return `Consumo de ${qtd(Math.max(consumo, 0), u)} no período.`;
}

type Classificado = { classe: ClasseConferencia; impacto: number | null };

export function ordenarConferencia<T extends Classificado>(itens: readonly T[]): T[] {
  const peso = (c: ClasseConferencia) => CLASSES_CONFERENCIA.indexOf(c);
  return [...itens].sort((a, b) => {
    if (a.classe !== b.classe) return peso(a.classe) - peso(b.classe);
    if (a.impacto == null) return b.impacto == null ? 0 : 1;
    if (b.impacto == null) return -1;
    return b.impacto - a.impacto;
  });
}

export type ResumoConferencia = Record<ClasseConferencia, { itens: number; impacto: number }>;

export function resumirConferencia(itens: readonly Classificado[]): ResumoConferencia {
  const resumo = Object.fromEntries(
    CLASSES_CONFERENCIA.map((classe) => [classe, { itens: 0, impacto: 0 }])
  ) as ResumoConferencia;
  for (const item of itens) {
    const atual = resumo[item.classe];
    resumo[item.classe] = {
      itens: atual.itens + 1,
      impacto: emReais(atual.impacto + (item.impacto ?? 0))
    };
  }
  return resumo;
}
