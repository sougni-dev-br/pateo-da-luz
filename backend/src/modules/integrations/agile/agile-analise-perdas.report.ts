import { ehCancelada } from "./agile-situacao.js";
import { encontrarRefacoes, JANELA_REFACAO_MINUTOS, TOLERANCIA_VALOR_REFACAO } from "./agile-analise-refacao.js";
import { LIMITE_CANCELAMENTO_GRANDE, type VendaVisao } from "./agile-analise-visao.report.js";
import { limpar, NAO_INFORMADO, type montarCancelamentos, type montarDescontos, type montarItensCancelados, type Periodo } from "./agile-analise.report.js";
import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";

// "Onde perdemos dinheiro": junta cancelamento de venda, item cancelado e desconto num só funil e
// separa o que provavelmente NÃO foi perda (comanda refeita) e o que merece conferência (valores
// muito altos). Os relatórios detalhados continuam anexos, para a tela abrir o detalhe.

const MAX_GRANDES = 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? parte / todo : 0);

type Entrada = {
  periodo: Periodo;
  vendas: VendaVisao[];
  cancelamentos: ReturnType<typeof montarCancelamentos>;
  itens: ReturnType<typeof montarItensCancelados>;
  descontos: ReturnType<typeof montarDescontos>;
};

type LinhaPessoa = {
  pessoa: string;
  canceladas: number;
  valorCancelado: number;
  valorRefeito: number;
  itens: number;
  valorItens: number;
  descontos: number;
  valorDescontos: number;
  perda: number;
};

export function montarPerdas({ periodo, vendas, cancelamentos, itens, descontos }: Entrada) {
  const canceladas = vendas.filter((v) => ehCancelada(v.saleStatus));
  const pares = encontrarRefacoes(vendas);
  const nome = (n: string | null) => limpar(n) || NAO_INFORMADO;

  const refeitas = canceladas.filter((v) => pares.has(v.saleId));
  const valorRefeito = refeitas.reduce((s, v) => s + v.totalAmount, 0);
  const valorCancelado = cancelamentos.resumo.valorCancelado;
  const valorGrandes = canceladas.filter((v) => v.totalAmount >= LIMITE_CANCELAMENTO_GRANDE).reduce((s, v) => s + v.totalAmount, 0);
  const valorItens = itens.resumo.valorCancelado;
  const valorDescontos = descontos.resumo.valorDescontos;
  const semRefacao = valorCancelado - valorRefeito;
  const perdaTotal = semRefacao + valorItens + valorDescontos;
  const perdaTeto = valorCancelado + valorItens + valorDescontos;
  const todasGrandes = canceladas.filter((v) => v.totalAmount >= LIMITE_CANCELAMENTO_GRANDE);
  const faturado = cancelamentos.resumo.valorFaturado;

  const pessoas = new Map<string, LinhaPessoa>();
  const linha = (pessoa: string) => {
    const atual = pessoas.get(pessoa) ?? { pessoa, canceladas: 0, valorCancelado: 0, valorRefeito: 0, itens: 0, valorItens: 0, descontos: 0, valorDescontos: 0, perda: 0 };
    pessoas.set(pessoa, atual);
    return atual;
  };
  for (const v of canceladas) {
    const l = linha(nome(v.cancelledBy));
    l.canceladas += 1;
    l.valorCancelado += v.totalAmount;
    if (pares.has(v.saleId)) l.valorRefeito += v.totalAmount;
  }
  for (const i of itens.porQuemCancelou) {
    const l = linha(i.pessoa);
    l.itens += i.itens;
    l.valorItens += i.valor;
  }
  for (const d of descontos.porPessoa) {
    const l = linha(d.pessoa);
    l.descontos += d.vendas;
    l.valorDescontos += d.valor;
  }
  const porPessoa = [...pessoas.values()]
    .map((l) => ({
      ...l,
      valorCancelado: round2(l.valorCancelado),
      valorRefeito: round2(l.valorRefeito),
      valorItens: round2(l.valorItens),
      valorDescontos: round2(l.valorDescontos),
      perda: round2(l.valorCancelado - l.valorRefeito + l.valorItens + l.valorDescontos)
    }))
    // "(não informado)" sempre por último: não é uma pessoa e ninguém deve lê-lo como a que mais perde.
    .sort((a, b) => Number(a.pessoa === NAO_INFORMADO) - Number(b.pessoa === NAO_INFORMADO) || b.perda - a.perda || a.pessoa.localeCompare(b.pessoa));

  const grandes = canceladas
    .filter((v) => v.totalAmount >= LIMITE_CANCELAMENTO_GRANDE)
    .sort((a, b) => b.totalAmount - a.totalAmount || a.saleId.localeCompare(b.saleId))
    .slice(0, MAX_GRANDES)
    .map((v) => ({
      saleId: v.saleId,
      data: toCalendarDateKey(v.movementDate),
      hora: v.saleHour,
      turno: v.shift.trim(),
      pessoas: v.people,
      valor: round2(v.totalAmount),
      pessoa: nome(v.cancelledBy),
      motivo: limpar(v.cancelReason) || null,
      refeita: pares.has(v.saleId)
    }));

  return {
    periodo,
    cobertura: { vendasComDetalhe: cancelamentos.cobertura.vendasComDetalhe },
    funil: {
      faturado: round2(faturado),
      cancelado: round2(valorCancelado),
      refeito: round2(valorRefeito),
      semRefacao: round2(semRefacao),
      itensCancelados: round2(valorItens),
      descontos: round2(valorDescontos),
      perdaTotal: round2(perdaTotal),
      perdaPct: round4(razao(perdaTotal, faturado)),
      // Sem abater a provável refação (que é provável, não certa): o teto da perda.
      perdaTeto: round2(perdaTeto),
      // Parte do cancelado em vendas de valor muito alto: já está dentro de `cancelado`.
      grandes: round2(valorGrandes),
      // Quantas são (a lista `grandes` mostra só as maiores).
      grandesVendas: todasGrandes.length
    },
    refacao: {
      vendas: refeitas.length,
      valor: round2(valorRefeito),
      pctDoCancelado: round4(razao(valorRefeito, valorCancelado)),
      janelaMinutos: JANELA_REFACAO_MINUTOS,
      toleranciaValor: TOLERANCIA_VALOR_REFACAO
    },
    limiteGrande: LIMITE_CANCELAMENTO_GRANDE,
    grandes,
    porPessoa,
    cancelamentos,
    itens,
    descontos
  };
}
