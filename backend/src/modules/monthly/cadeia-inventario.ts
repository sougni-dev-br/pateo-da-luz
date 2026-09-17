// A cadeia de inventário: o final de um mês é o inicial do seguinte.
//
// O CMV é `inicial + compras − final`. O inicial nunca é um número independente:
// é o estoque que sobrou do mês anterior. Quando os dois deixam de conversar, o
// CMV do mês sai errado sem nada indicar que saiu.
//
// Foi o que aconteceu em 07 e 08/2026: os meses não tinham snapshot INICIAL e a
// consulta devolvia 0. Julho apurou com estoque de abertura zero, R$ 115 mil
// abaixo do que junho havia fechado, e isso passou quatro meses despercebido —
// nenhuma tela mostrava um zero, porque o zero era o resultado normal da conta.
//
// Este módulo separa duas responsabilidades que estavam fundidas:
//   - `resolverInicial` faz o CMV ser calculável mesmo sem snapshot próprio,
//     herdando o final anterior em vez de assumir zero;
//   - `verificarCadeia` diz onde a cadeia está frouxa, para o fechamento cobrar.
//
// A herança NÃO dispensa o snapshot: ela impede o erro silencioso enquanto o
// fechamento aponta o que falta. Zero continua sendo possível — mas só quando
// não há mês anterior nenhum, e aí é declarado, não deduzido.

/** De onde veio o valor usado como estoque de abertura. */
export type OrigemDoInicial =
  /** Existe snapshot INVENTARIO_INICIAL para o mês. */
  | "PROPRIO"
  /** Não existe, e o valor foi herdado do final do mês anterior. */
  | "HERDADO_DO_ANTERIOR"
  /** Não existe e não há mês anterior: primeiro mês da série. */
  | "INEXISTENTE";

export type InicialResolvido = {
  valor: number;
  origem: OrigemDoInicial;
};

/**
 * Qual valor usar como estoque de abertura do mês.
 *
 * Herdar o final anterior não é uma estimativa: por definição contábil é o mesmo
 * estoque. Assumir zero, que era o comportamento anterior, é que era o chute —
 * e um chute que sempre errava para o mesmo lado, inflando o CMV do mês.
 */
export function resolverInicial(
  proprio: number | null | undefined,
  finalDoMesAnterior: number | null | undefined
): InicialResolvido {
  if (proprio != null && Number.isFinite(proprio)) {
    return { valor: proprio, origem: "PROPRIO" };
  }
  if (finalDoMesAnterior != null && Number.isFinite(finalDoMesAnterior)) {
    return { valor: finalDoMesAnterior, origem: "HERDADO_DO_ANTERIOR" };
  }
  return { valor: 0, origem: "INEXISTENTE" };
}

export type EloDaCadeia = {
  competenceYear: number;
  competenceMonth: number;
  /** Valor do snapshot INVENTARIO_INICIAL do mês, quando existe. */
  inicial: number | null;
  /** Valor do snapshot INVENTARIO_FINAL do mês, quando existe. */
  final: number | null;
};

export type TipoDeQuebra =
  /** O mês não tem inicial e existe final anterior para herdar. */
  | "INICIAL_AUSENTE"
  /** Tem inicial próprio, mas ele não bate com o final do mês anterior. */
  | "INICIAL_DIVERGENTE"
  /** O mês fechou, mas o seguinte já começou sem herdar nada. */
  | "FINAL_AUSENTE";

export type QuebraDaCadeia = {
  competenceYear: number;
  competenceMonth: number;
  tipo: TipoDeQuebra;
  /** O que o mês usa hoje como abertura. */
  valorAtual: number | null;
  /** O que ele deveria usar. */
  valorEsperado: number | null;
  /** Diferença em reais; 0 quando não se aplica. */
  diferenca: number;
  mensagem: string;
};

/** Centavo de tolerância: os valores vêm de Decimal(14,2). */
const TOLERANCIA = 0.01;

const mesLabel = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

/**
 * Percorre a série e aponta cada elo frouxo.
 *
 * Espera os meses em ordem cronológica. O primeiro mês da série nunca é cobrado
 * por inicial — não há de onde herdar, e cobrar geraria um alerta permanente que
 * treina quem fecha a ignorar a tela.
 */
export function verificarCadeia(elos: EloDaCadeia[]): QuebraDaCadeia[] {
  const quebras: QuebraDaCadeia[] = [];

  for (let i = 0; i < elos.length; i += 1) {
    const elo = elos[i];
    const anterior = i === 0 ? null : elos[i - 1];
    const label = mesLabel(elo.competenceYear, elo.competenceMonth);

    // Um mês sem final só é problema quando o mês seguinte existe e precisa dele.
    if (elo.final == null && i < elos.length - 1) {
      quebras.push({
        competenceYear: elo.competenceYear,
        competenceMonth: elo.competenceMonth,
        tipo: "FINAL_AUSENTE",
        valorAtual: null,
        valorEsperado: null,
        diferenca: 0,
        mensagem: `${label} não tem inventário final, e o mês seguinte precisa dele como abertura.`
      });
    }

    if (anterior == null) continue;
    const finalAnterior = anterior.final;
    if (finalAnterior == null) continue;

    if (elo.inicial == null) {
      quebras.push({
        competenceYear: elo.competenceYear,
        competenceMonth: elo.competenceMonth,
        tipo: "INICIAL_AUSENTE",
        valorAtual: null,
        valorEsperado: finalAnterior,
        diferenca: finalAnterior,
        mensagem:
          `${label} não tem inventário inicial. ` +
          `Herdando o final de ${mesLabel(anterior.competenceYear, anterior.competenceMonth)} para não apurar com zero.`
      });
      continue;
    }

    if (Math.abs(elo.inicial - finalAnterior) > TOLERANCIA) {
      quebras.push({
        competenceYear: elo.competenceYear,
        competenceMonth: elo.competenceMonth,
        tipo: "INICIAL_DIVERGENTE",
        valorAtual: elo.inicial,
        valorEsperado: finalAnterior,
        diferenca: elo.inicial - finalAnterior,
        mensagem:
          `O inicial de ${label} não bate com o final de ` +
          `${mesLabel(anterior.competenceYear, anterior.competenceMonth)}.`
      });
    }
  }

  return quebras;
}

/** true quando a série inteira está encadeada. */
export function cadeiaIntegra(elos: EloDaCadeia[]): boolean {
  return verificarCadeia(elos).length === 0;
}
