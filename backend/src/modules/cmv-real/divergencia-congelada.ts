// Um periodo de CMV fechado congela cinco numeros. Congelar e o certo: fechamento
// que se move sozinho nao vale como fechamento. So que ate 09/2026 nada nunca
// conferia se o congelado ainda correspondia a base — e quando para de
// corresponder, o sistema mostra dois numeros incompativeis na mesma tela sem
// dizer que sao de epocas diferentes.
//
// Caso real (CMV-2026-0001, abril/2026, fechado em 11/09/2026): as compras batiam
// ao centavo, mas os dois estoques estavam R$ 18,4 mil e R$ 26,3 mil acima de
// QUALQUER InventorySnapshot existente no banco. Ninguem percebeu por 6 dias
// porque o caminho de leitura do periodo fechado nao recalculava nada.
//
// Este modulo e puro de proposito: comparar congelado x recalculado e' a regra
// que precisa de teste, e ela nao depende de banco nenhum.

/** Os cinco numeros que o fechamento congela em CmvPeriod. */
export type TotaisDoPeriodo = {
  estoqueInicialTotal: number;
  comprasTotal: number;
  estoqueFinalTotal: number;
  cmvReal: number;
  faturamentoTotal: number;
};

export type CampoDivergente = {
  campo: keyof TotaisDoPeriodo;
  rotulo: string;
  congelado: number;
  recalculado: number;
  /** recalculado - congelado; negativo significa que a base de hoje vale menos. */
  diferenca: number;
};

const ROTULOS: Array<[keyof TotaisDoPeriodo, string]> = [
  ["estoqueInicialTotal", "estoque inicial"],
  ["comprasTotal", "compras"],
  ["estoqueFinalTotal", "estoque final"],
  ["cmvReal", "CMV real"],
  ["faturamentoTotal", "faturamento"],
];

// Um centavo de folga absorve arredondamento de soma de Decimal sem engolir
// divergencia de verdade. Dois centavos ja sao sinal, nao ruido.
const TOLERANCIA_EM_CENTAVOS = 1;

function emCentavos(valor: number) {
  return Math.round(valor * 100);
}

export function formatarReais(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Compara os totais congelados com o que a base devolve hoje.
 * Devolve so os campos que divergem, na ordem em que a equacao do CMV os le.
 */
export function compararTotaisCongelados(
  congelado: TotaisDoPeriodo,
  recalculado: TotaisDoPeriodo
): CampoDivergente[] {
  const divergentes: CampoDivergente[] = [];
  for (const [campo, rotulo] of ROTULOS) {
    const valorCongelado = congelado[campo];
    const valorRecalculado = recalculado[campo];
    if (!Number.isFinite(valorCongelado) || !Number.isFinite(valorRecalculado)) continue;

    const diferencaEmCentavos = emCentavos(valorRecalculado) - emCentavos(valorCongelado);
    if (Math.abs(diferencaEmCentavos) <= TOLERANCIA_EM_CENTAVOS) continue;

    divergentes.push({
      campo,
      rotulo,
      congelado: valorCongelado,
      recalculado: valorRecalculado,
      diferenca: diferencaEmCentavos / 100,
    });
  }
  return divergentes;
}

/**
 * O texto que o operador le. Diz as tres coisas que ele precisa saber: que os
 * numeros grandes sao de quando fechou, quais nao batem mais, e que a composicao
 * logo abaixo veio da base de hoje — porque e' exatamente essa mistura que, sem
 * aviso, faz a tela se contradizer.
 */
export function mensagemDeDivergencia(divergentes: CampoDivergente[], fechadoEm?: Date | string | null) {
  if (divergentes.length === 0) return null;

  const quando = formatarQuando(fechadoEm);
  const abertura = quando
    ? `Os totais desta apuracao foram congelados no fechamento, em ${quando}.`
    : "Os totais desta apuracao foram congelados no fechamento.";

  const lista = divergentes
    .map((d) => `${d.rotulo} (congelado ${formatarReais(d.congelado)}, hoje ${formatarReais(d.recalculado)})`)
    .join("; ");

  const quantos = divergentes.length === 1
    ? "1 deles nao bate mais com a base"
    : `${divergentes.length} deles nao batem mais com a base`;

  return `${abertura} Recalculando agora, ${quantos}: ${lista}. A composicao abaixo (categorias, fornecedores e canais) foi montada com a base de hoje, entao ela explica o numero recalculado, nao o congelado.`;
}

function formatarQuando(valor?: Date | string | null) {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}/${data.getFullYear()}`;
}
