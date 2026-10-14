// Regras de tela e de PDF da lista do adiantamento (dia 20) e da 1ª quinzena (dia 15).
import type { LinhaPagamentoMeio, PagamentoMeio, TipLinhaFolha, TipoPagamentoMeio } from "../../api/client";
import type { ListaPagamentoPdf } from "../gorjeta/pdfFolhaLiquidos";
import type { Selo } from "../gorjeta/pdfTema";

export const TITULO_PAGAMENTO: Record<TipoPagamentoMeio, string> = { ADIANTAMENTO: "Adiantamento", QUINZENA: "1ª quinzena" };
/** "dia 20": o adiantamento vence no dia das Configurações da folha; a 1ª quinzena, sempre no dia 15. */
export function diaDoPagamento(tipo: TipoPagamentoMeio, diaAdiantamento: number | null): string {
  return tipo === "QUINZENA" ? "dia 15" : `dia ${diaAdiantamento ?? 20}`;
}
/** O botão que lança no Contas a Pagar é o mesmo gerador da prévia da folha. */
export const KIND_DO_TIPO = { ADIANTAMENTO: "ADIANTAMENTO_SR", QUINZENA: "QUINZENA_SR" } as const;

/** 1ª quinzena em aberto com valor diferente do cálculo de hoje: o mesmo botão atualiza. */
export const precisaAtualizar = (l: LinhaPagamentoMeio) => l.situacao === "LANCADO" && l.atualizarPara != null;

/** O que o botão "Lançar no Contas a Pagar" vai criar ou atualizar. */
export function aLancar(dados: PagamentoMeio): LinhaPagamentoMeio[] {
  return dados.linhas.filter((l) => l.situacao === "A_LANCAR" || precisaAtualizar(l));
}

/** Depois de lançar: quem saiu de "a lançar" e quem continua (o gerador pulou). */
export function resultadoDoLancamento(antes: LinhaPagamentoMeio[], depois: PagamentoMeio) {
  const agora = new Map(depois.linhas.map((l) => [l.employeeId, l]));
  const lancados = antes.filter((l) => l.situacao === "A_LANCAR" && agora.get(l.employeeId)?.situacao === "LANCADO")
    .map((l) => agora.get(l.employeeId)!);
  const pendentes = depois.linhas.filter((l) => l.situacao === "A_LANCAR");
  return { lancados, pendentes, total: Math.round(lancados.reduce((a, l) => a + l.valor, 0) * 100) / 100 };
}

const ddmm = (iso: string) => iso.slice(0, 10).split("-").slice(1).reverse().join("/");
export const ddmmaaaa = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Linha de baixo da situação (o selo já diz qual é): a data que importa para pagar. */
export function textoSituacao(l: LinhaPagamentoMeio): string {
  if (l.situacao === "PAGO") return `em ${ddmm(l.pagoEm ?? l.vencimento)}`;
  return `vence ${ddmm(l.vencimento)}`;
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O aviso que vai no PDF, embaixo do nome: o que quem paga precisa saber. */
function avisoNoPdf(l: LinhaPagamentoMeio): string | null {
  if (l.situacao === "A_LANCAR") return "Ainda não lançado no Contas a Pagar";
  if (precisaAtualizar(l)) return `Título em aberto de ${reais(l.valor)}; o cálculo de hoje dá ${reais(l.atualizarPara!)}`;
  return l.aviso;
}

/** PDF: os pagos saem da lista (vão para "Já pagos"); quem falta lançar ou atualizar sai marcado. */
export function listaParaPdf(dados: PagamentoMeio): ListaPagamentoPdf {
  const linhas: TipLinhaFolha[] = dados.linhas.filter((l) => l.situacao !== "PAGO").map((l) => ({
    employeeId: l.employeeId, nome: l.nome, grupo: l.grupo, origem: l.origem, valor: l.valor,
    pix: l.pix, pixTipo: l.pixTipo, contaBancaria: l.contaBancaria, aviso: avisoNoPdf(l),
  }));
  const jaPagos = dados.linhas.filter((l) => l.situacao === "PAGO")
    .map((l) => ({ nome: l.nome, valor: l.valorPago ?? l.valor, pagoEm: l.pagoEm ?? l.vencimento }));
  return { linhas, jaPagos, total: Math.round(linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100 };
}

/** Prévia enquanto falta lançar ou atualizar alguém; "lançado" só com a lista toda no Contas a Pagar. */
export function seloDoPdf(dados: PagamentoMeio): Selo {
  const n = aLancar(dados).length;
  return n > 0
    ? { texto: `PRÉVIA - ${n === 1 ? "FALTA LANÇAR 1" : `FALTAM LANÇAR ${n}`}`, tom: "aviso" }
    : { texto: "LANÇADO NO CONTAS A PAGAR", tom: "ok" };
}

export function regrasDoPdf(tipo: TipoPagamentoMeio, percent: number | null): string[] {
  const pago = "O valor pago é descontado no pagamento do mês (lista de pagamento).";
  if (tipo === "QUINZENA") {
    return ["1ª quinzena: metade do salário base, a quem é sem registro e recebe por quinzena (cadastro).", pago];
  }
  return [
    "CLT: adiantamento do extrato da contabilidade.",
    `Sem registro: ${percent != null ? `${String(percent).replace(".", ",")}% do` : "percentual do"} salário base, a quem recebe adiantamento (cadastro).`,
    pago,
  ];
}

/** Vencimento que vai no cabeçalho: o mais comum entre as linhas. */
export function vencimentoDaLista(linhas: LinhaPagamentoMeio[]): string | null {
  const conta = new Map<string, number>();
  for (const l of linhas) conta.set(l.vencimento, (conta.get(l.vencimento) ?? 0) + 1);
  return [...conta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
