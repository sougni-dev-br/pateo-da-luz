// Formatação do comparativo de Planejamento. As variações chegam do backend como fração (0,05 = +5%).

/**
 * Variação em pontos percentuais com uma casa, arredondada pela MAGNITUDE (meio para longe do zero) e só depois com o
 * sinal. Math.round puro arredonda -83,5 para -83 e +83,5 para 84: a tabela mostraria −8,3% e a frase "8,4% a menos".
 * Toda tela que escreve uma variação passa por aqui.
 */
export function pontosDaVariacao(variacao: number): number {
  const magnitude = Math.round(Math.abs(variacao) * 1000 + 1e-9) / 10;
  return variacao < 0 && magnitude > 0 ? -magnitude : magnitude;
}

/** Estável: a variação some ao arredondar para uma casa decimal (mesma precisão mostrada na tela). */
export type Leitura = "Aumento" | "Redução" | "Estável";

export function leituraDaVariacao(variacao: number | null): Leitura | null {
  if (variacao === null) return null;
  const pontos = pontosDaVariacao(variacao);
  if (pontos > 0) return "Aumento";
  if (pontos < 0) return "Redução";
  return "Estável";
}

const umaCasa = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function textoDaVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const pct = pontosDaVariacao(variacao);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${umaCasa(Math.abs(pct))}%`;
}

/** Só o tamanho da variação, sem sinal ("8,4%"), para frases que já dizem "a mais"/"a menos". Igual ao da tabela. */
export function textoDaMagnitude(variacao: number): string {
  return `${umaCasa(Math.abs(pontosDaVariacao(variacao)))}%`;
}

export const NOMES_DOS_MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"] as const;
export const NOMES_DOS_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;

/** "janeiro a outubro" a partir dos meses comparados; lista só um mês ou meses soltos se não forem seguidos. */
export function descricaoDoPeriodo(meses: readonly number[]): string {
  if (meses.length === 0) return "";
  const nomes = meses.map((m) => NOMES_DOS_MESES[m - 1]);
  if (nomes.length === 1) return nomes[0];
  const seguidos = meses.every((m, i) => i === 0 || m === meses[i - 1] + 1);
  if (seguidos) return `${nomes[0]} a ${nomes[nomes.length - 1]}`;
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Fração → texto do campo de percentual: 0,055 vira "5,5"; 0 vira "0". */
export function percentualParaTexto(fracao: number): string {
  const pct = Math.round(fracao * 10000) / 100;
  return pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** Texto digitado ("10", "5,5", "-3", "7%") → fração. Devolve null se não for um número. */
export function textoParaPercentual(texto: string): number | null {
  const limpo = texto.trim().replace("%", "").replace(/\s/g, "");
  if (!/^[-+−]?\d+([.,]\d+)?$/.test(limpo)) return null;
  const numero = Number(limpo.replace("−", "-").replace(",", "."));
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100) / 10000;
}

export const MOTIVO_SEM_BASE: Record<string, string> = {
  SEM_DADO: "sem dado no ano-base",
  EM_ANDAMENTO: "mês em andamento",
  MES_PARCIAL: "mês incompleto no ano-base",
  CLIENTES_INCOMPLETOS: "vendas sem nº de clientes",
  TURNO_SEM_CLIENTES: "turno sem clientes"
};

export const ROTULO_DO_GRUPO: Record<string, string> = {
  OCUPACAO: "Ocupação",
  TARIFAS_PUBLICAS: "Tarifas públicas",
  FOLHA: "Folha de pagamento",
  TRIBUTOS: "Tributos",
  DIVIDA: "Dívida",
  CONTRATOS: "Contratos recorrentes",
  SEGUROS: "Seguros",
  TARIFAS_BANCARIAS: "Tarifas bancárias",
  OUTROS: "Outros"
};

/** Valor em reais para o campo: 52000 vira "52.000"; 1234,5 vira "1.234,5". */
export function reaisParaTexto(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** "52.000", "52000", "1.234,56", "R$ 500" → número. Devolve null se não for dinheiro válido (negativo não vale). */
export function textoParaReais(texto: string): number | null {
  const limpo = texto.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!limpo) return null;
  const ptBr = /^\d{1,3}(\.\d{3})*(,\d+)?$/.test(limpo);
  const simples = /^\d+([.,]\d+)?$/.test(limpo);
  if (!ptBr && !simples) return null;
  const normalizado = ptBr ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** % do gasto pago no mês do gasto, por grupo, para linhas novas (o resto sai no mês seguinte). Espelha o servidor; são suposições editáveis. */
const PAGO_NO_MES_PADRAO: Record<string, number> = { OCUPACAO: 0, TARIFAS_PUBLICAS: 0, FOLHA: 0.4, TRIBUTOS: 0 };
export const pagoNoMesPadrao = (grupo: string): number => PAGO_NO_MES_PADRAO[grupo] ?? 1;

export const ROTULO_DA_FORMA: Record<string, string> = { DINHEIRO: "Dinheiro", PIX: "PIX", DEBITO: "Débito", CREDITO: "Crédito", VOUCHER: "Voucher" };

/** Dias inteiros e não negativos ("30" → 30); null se não for. */
export function textoParaDias(texto: string): number | null {
  const limpo = texto.trim();
  return /^\d{1,3}$/.test(limpo) ? Number(limpo) : null;
}
