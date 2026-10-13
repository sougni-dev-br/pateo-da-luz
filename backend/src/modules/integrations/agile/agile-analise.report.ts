import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";

// Calculo dos relatorios de analise do salao (cancelamentos e vendas por pessoa).
// Funcoes puras: recebem as linhas ja lidas do banco e devolvem o que a tela mostra.
// Os numeros chegam como `number` (o servico converte o Decimal do Prisma antes).

export type Periodo = { inicio: string; fim: string };

export type VendaAnalise = {
  saleId: string;
  movementDate: Date;
  shift: string;
  saleStatus: string;
  saleHour: string | null;
  people: number;
  totalAmount: number;
  cancelledBy: string | null;
  cancelReason: string | null;
};

export type ItemAnalise = {
  saleId: string;
  launchedBy: string | null;
  productGroup: string | null;
  quantity: number;
  totalAmount: number;
};

const SITUACAO_RECEBIDA = "RECEBIDA";
const NAO_INFORMADO = "(não informado)";
const SEM_GRUPO = "(sem grupo)";
const SEM_HORA = "—";
const MAX_MAIORES = 10;
const MAX_MIX = 5;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const razao = (parte: number, todo: number) => (todo > 0 ? round4(parte / todo) : 0);
const limpar = (nome: string | null) => (nome ?? "").replace(/\s+/g, " ").trim();

const ehCancelada = (v: VendaAnalise) => v.saleStatus !== SITUACAO_RECEBIDA;

export function montarCancelamentos(vendas: VendaAnalise[], periodo: Periodo) {
  const canceladas = vendas.filter(ehCancelada);
  const valorCancelado = canceladas.reduce((s, v) => s + v.totalAmount, 0);
  const valorFaturado = vendas.filter((v) => !ehCancelada(v)).reduce((s, v) => s + v.totalAmount, 0);

  const porPessoaMap = new Map<string, { canceladas: number; valor: number }>();
  for (const v of canceladas) {
    const nome = limpar(v.cancelledBy) || NAO_INFORMADO;
    const atual = porPessoaMap.get(nome) ?? { canceladas: 0, valor: 0 };
    porPessoaMap.set(nome, { canceladas: atual.canceladas + 1, valor: atual.valor + v.totalAmount });
  }
  const porPessoa = [...porPessoaMap.entries()]
    .map(([pessoa, x]) => ({ pessoa, canceladas: x.canceladas, valor: round2(x.valor), participacao: razao(x.valor, valorCancelado) }))
    .sort((a, b) => b.valor - a.valor || a.pessoa.localeCompare(b.pessoa));

  const agrupar = (chave: (v: VendaAnalise) => string) => {
    const mapa = new Map<string, { vendas: number; canceladas: number; valor: number }>();
    for (const v of vendas) {
      const k = chave(v);
      const atual = mapa.get(k) ?? { vendas: 0, canceladas: 0, valor: 0 };
      atual.vendas += 1;
      if (ehCancelada(v)) {
        atual.canceladas += 1;
        atual.valor += v.totalAmount;
      }
      mapa.set(k, atual);
    }
    return mapa;
  };

  const porTurno = [...agrupar((v) => v.shift.trim()).entries()]
    .map(([turno, x]) => ({ turno, vendas: x.vendas, canceladas: x.canceladas, taxa: razao(x.canceladas, x.vendas), valor: round2(x.valor) }))
    .sort((a, b) => a.turno.localeCompare(b.turno));

  const porHora = [...agrupar((v) => (v.saleHour ? v.saleHour.slice(0, 2) : SEM_HORA)).entries()]
    .map(([hora, x]) => ({ hora, vendas: x.vendas, canceladas: x.canceladas, taxa: razao(x.canceladas, x.vendas), valor: round2(x.valor) }))
    // "—" (sem hora) vai para o fim; as horas em ordem crescente.
    .sort((a, b) => (a.hora === SEM_HORA ? 1 : b.hora === SEM_HORA ? -1 : a.hora.localeCompare(b.hora)));

  const porDia = [...agrupar((v) => toCalendarDateKey(v.movementDate)).entries()]
    .map(([data, x]) => ({ data, vendas: x.vendas, canceladas: x.canceladas, taxa: razao(x.canceladas, x.vendas), valor: round2(x.valor) }))
    .sort((a, b) => a.data.localeCompare(b.data));

  const maiores = [...canceladas]
    .sort((a, b) => b.totalAmount - a.totalAmount || a.saleId.localeCompare(b.saleId))
    .slice(0, MAX_MAIORES)
    .map((v) => ({
      saleId: v.saleId,
      data: toCalendarDateKey(v.movementDate),
      hora: v.saleHour,
      turno: v.shift.trim(),
      pessoa: limpar(v.cancelledBy) || NAO_INFORMADO,
      pessoas: v.people,
      valor: round2(v.totalAmount),
      motivo: limpar(v.cancelReason) || null
    }));

  const dias = porDia.map((d) => d.data);

  return {
    periodo,
    // O que de fato tem detalhe: antes de o agente enviar a venda detalhada o periodo
    // fica vazio, e a tela precisa dizer isso em vez de mostrar "0 cancelamentos".
    cobertura: {
      vendasComDetalhe: vendas.length,
      primeiroDia: dias[0] ?? null,
      ultimoDia: dias[dias.length - 1] ?? null
    },
    resumo: {
      vendas: vendas.length,
      canceladas: canceladas.length,
      taxaCancelamento: razao(canceladas.length, vendas.length),
      valorCancelado: round2(valorCancelado),
      valorFaturado: round2(valorFaturado),
      semMotivo: canceladas.filter((v) => limpar(v.cancelReason) === "").length
    },
    porPessoa,
    porTurno,
    porHora,
    porDia,
    maiores
  };
}

export function montarVendasPorPessoa(itens: ItemAnalise[], periodo: Periodo) {
  type Acumulado = { valor: number; itens: number; vendas: Set<string>; grupos: Map<string, number> };
  const porPessoa = new Map<string, Acumulado>();
  let itensSemPessoa = 0;
  let valorSemPessoa = 0;

  for (const item of itens) {
    const nome = limpar(item.launchedBy);
    if (nome === "") {
      itensSemPessoa += 1;
      valorSemPessoa += item.totalAmount;
      continue;
    }
    const acc = porPessoa.get(nome) ?? { valor: 0, itens: 0, vendas: new Set<string>(), grupos: new Map<string, number>() };
    acc.valor += item.totalAmount;
    acc.itens += item.quantity;
    acc.vendas.add(item.saleId);
    const grupo = limpar(item.productGroup) || SEM_GRUPO;
    acc.grupos.set(grupo, (acc.grupos.get(grupo) ?? 0) + item.totalAmount);
    porPessoa.set(nome, acc);
  }

  const valorTotal = [...porPessoa.values()].reduce((s, p) => s + p.valor, 0);

  const pessoas = [...porPessoa.entries()]
    .map(([pessoa, p]) => ({
      pessoa,
      valor: round2(p.valor),
      participacao: razao(p.valor, valorTotal),
      itens: p.itens,
      vendas: p.vendas.size,
      // Ticket = valor lancado pela pessoa / vendas em que ela lancou algo. Mesa dividida
      // entre duas pessoas conta nas duas, entao nao e o ticket da mesa inteira.
      ticketMedio: p.vendas.size > 0 ? round2(p.valor / p.vendas.size) : 0,
      itensPorVenda: p.vendas.size > 0 ? round2(p.itens / p.vendas.size) : 0,
      mix: [...p.grupos.entries()]
        .map(([grupo, valor]) => ({ grupo, valor: round2(valor), participacao: razao(valor, p.valor) }))
        .sort((a, b) => b.valor - a.valor || a.grupo.localeCompare(b.grupo))
        .slice(0, MAX_MIX)
    }))
    .sort((a, b) => b.valor - a.valor || a.pessoa.localeCompare(b.pessoa));

  return {
    periodo,
    cobertura: { itensComPessoa: itens.length - itensSemPessoa, itensSemPessoa },
    resumo: {
      pessoas: pessoas.length,
      valorTotal: round2(valorTotal),
      valorSemPessoa: round2(valorSemPessoa),
      itensSemPessoa
    },
    pessoas
  };
}
