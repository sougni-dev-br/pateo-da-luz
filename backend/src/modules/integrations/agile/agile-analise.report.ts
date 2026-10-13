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

export type ItemCanceladoAnalise = {
  saleId: string;
  movementDate: Date;
  // Hora da VENDA (o item nao tem hora propria).
  saleHour: string | null;
  productName: string;
  productGroup: string | null;
  quantity: number;
  totalAmount: number;
  launchedBy: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};

export type VendaDescontoAnalise = {
  saleId: string;
  movementDate: Date;
  shift: string;
  saleHour: string | null;
  people: number;
  // null = linha gravada antes de o agente enviar o desconto (sem dado, nao zero).
  subtotalAmount: number | null;
  discountAmount: number | null;
  totalAmount: number;
  discountLabel: string | null;
  // Quem registrou o desconto (campo func_cancelou do PDV; hipotese a confirmar).
  registeredBy: string | null;
};

const SITUACAO_RECEBIDA = "RECEBIDA";
const SEM_TIPO = "(tipo não informado)";
const LIMITE_DESCONTO_ALTO = 0.5;
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

// Itens cancelados DENTRO de vendas que foram pagas (a venda inteira cancelada e outro
// relatorio: montarCancelamentos). `valorItensRecebidos` e o valor dos itens que ficaram
// na conta no mesmo periodo e serve de denominador da taxa.
export function montarItensCancelados(
  itens: ItemCanceladoAnalise[],
  valorItensRecebidos: number,
  periodo: Periodo,
  // Itens cancelados que ficaram de fora porque a venda deles nao foi gravada em AgileSale.
  itensSemVenda = 0
) {
  const valorCancelado = itens.reduce((s, i) => s + i.totalAmount, 0);
  const nome = (n: string | null) => limpar(n) || NAO_INFORMADO;

  const porPessoa = (campo: "launchedBy" | "cancelledBy") => {
    const mapa = new Map<string, { itens: number; valor: number; vendas: Set<string> }>();
    for (const i of itens) {
      const k = nome(i[campo]);
      const atual = mapa.get(k) ?? { itens: 0, valor: 0, vendas: new Set<string>() };
      atual.itens += 1;
      atual.valor += i.totalAmount;
      atual.vendas.add(i.saleId);
      mapa.set(k, atual);
    }
    return [...mapa.entries()]
      .map(([pessoa, x]) => ({ pessoa, itens: x.itens, vendas: x.vendas.size, valor: round2(x.valor), participacao: razao(x.valor, valorCancelado) }))
      // "(nao informado)" sempre por ultimo: nao e uma pessoa, e ninguem deve le-lo como o
      // funcionario que mais cancela so porque o agente ainda nao mandou o nome.
      .sort((a, b) => Number(a.pessoa === NAO_INFORMADO) - Number(b.pessoa === NAO_INFORMADO) || b.valor - a.valor || a.pessoa.localeCompare(b.pessoa));
  };

  const produtos = new Map<string, { grupo: string; linhas: number; quantidade: number; valor: number }>();
  for (const i of itens) {
    const k = limpar(i.productName) || "(sem nome)";
    const atual = produtos.get(k) ?? { grupo: limpar(i.productGroup) || SEM_GRUPO, linhas: 0, quantidade: 0, valor: 0 };
    atual.linhas += 1;
    atual.quantidade += i.quantity;
    atual.valor += i.totalAmount;
    produtos.set(k, atual);
  }

  const horas = new Map<string, { itens: number; valor: number }>();
  for (const i of itens) {
    const k = i.saleHour ? i.saleHour.slice(0, 2) : SEM_HORA;
    const atual = horas.get(k) ?? { itens: 0, valor: 0 };
    horas.set(k, { itens: atual.itens + 1, valor: atual.valor + i.totalAmount });
  }

  const comOsDoisNomes = itens.filter((i) => limpar(i.launchedBy) !== "" && limpar(i.cancelledBy) !== "");
  const dias = [...new Set(itens.map((i) => toCalendarDateKey(i.movementDate)))].sort();

  return {
    periodo,
    cobertura: { itensCancelados: itens.length, itensSemVenda, primeiroDia: dias[0] ?? null, ultimoDia: dias[dias.length - 1] ?? null },
    resumo: {
      itens: itens.length,
      vendasAfetadas: new Set(itens.map((i) => i.saleId)).size,
      valorCancelado: round2(valorCancelado),
      valorItensRecebidos: round2(valorItensRecebidos),
      taxaValor: razao(valorCancelado, valorCancelado + valorItensRecebidos),
      // Itens sem "quem cancelou": linhas gravadas antes de o agente enviar o campo.
      semQuemCancelou: itens.filter((i) => limpar(i.cancelledBy) === "").length,
      semMotivo: itens.filter((i) => limpar(i.cancelReason) === "").length,
      // Lancou e cancelou o mesmo item: so conta quando os dois nomes existem.
      mesmaPessoa: comOsDoisNomes.filter((i) => limpar(i.launchedBy) === limpar(i.cancelledBy)).length,
      comOsDoisNomes: comOsDoisNomes.length
    },
    porQuemLancou: porPessoa("launchedBy"),
    porQuemCancelou: porPessoa("cancelledBy"),
    porProduto: [...produtos.entries()]
      .map(([produto, x]) => ({ produto, grupo: x.grupo, linhas: x.linhas, quantidade: x.quantidade, valor: round2(x.valor) }))
      .sort((a, b) => b.valor - a.valor || a.produto.localeCompare(b.produto))
      .slice(0, MAX_MAIORES),
    porHora: [...horas.entries()]
      .map(([hora, x]) => ({ hora, itens: x.itens, valor: round2(x.valor) }))
      .sort((a, b) => (a.hora === SEM_HORA ? 1 : b.hora === SEM_HORA ? -1 : a.hora.localeCompare(b.hora))),
    maiores: [...itens]
      .sort((a, b) => b.totalAmount - a.totalAmount || a.saleId.localeCompare(b.saleId))
      .slice(0, MAX_MAIORES)
      .map((i) => ({
        saleId: i.saleId,
        data: toCalendarDateKey(i.movementDate),
        hora: i.saleHour,
        produto: limpar(i.productName),
        quantidade: i.quantity,
        valor: round2(i.totalAmount),
        quemLancou: nome(i.launchedBy),
        quemCancelou: nome(i.cancelledBy),
        motivo: limpar(i.cancelReason) || null
      }))
  };
}

// Descontos nas vendas PAGAS. A base do percentual e o subtotal dos itens: no PDV,
// vl_total = subtotal + servico - desconto (conferido em 74 de 74 vendas com desconto).
// Linha com subtotal/desconto null e "sem dado": fica fora das contas e e contada a parte,
// porque tratar como zero diria "nenhum desconto" onde so falta a informacao.
export function montarDescontos(vendas: VendaDescontoAnalise[], periodo: Periodo) {
  const comDado = vendas.filter((v) => v.subtotalAmount !== null && v.discountAmount !== null);
  const comDesconto = comDado.filter((v) => (v.discountAmount ?? 0) > 0);
  const subtotal = (v: VendaDescontoAnalise) => v.subtotalAmount ?? 0;
  const desconto = (v: VendaDescontoAnalise) => v.discountAmount ?? 0;
  const valorDescontos = comDesconto.reduce((s, v) => s + desconto(v), 0);
  const valorSubtotal = comDado.reduce((s, v) => s + subtotal(v), 0);

  const agrupar = (chave: (v: VendaDescontoAnalise) => string) => {
    const mapa = new Map<string, { vendas: number; valor: number; subtotal: number }>();
    for (const v of comDesconto) {
      const k = chave(v);
      const atual = mapa.get(k) ?? { vendas: 0, valor: 0, subtotal: 0 };
      mapa.set(k, { vendas: atual.vendas + 1, valor: atual.valor + desconto(v), subtotal: atual.subtotal + subtotal(v) });
    }
    return [...mapa.entries()].map(([nome, x]) => ({
      nome,
      vendas: x.vendas,
      valor: round2(x.valor),
      participacao: razao(x.valor, valorDescontos),
      percentualMedio: razao(x.valor, x.subtotal)
    }));
  };
  const ordenar = <T extends { nome: string; valor: number }>(linhas: T[], semNome: string) =>
    linhas.sort((a, b) => Number(a.nome === semNome) - Number(b.nome === semNome) || b.valor - a.valor || a.nome.localeCompare(b.nome));

  const turnos = new Map<string, { vendas: number; vendasComDesconto: number; valor: number }>();
  for (const v of comDado) {
    const k = v.shift.trim();
    const atual = turnos.get(k) ?? { vendas: 0, vendasComDesconto: 0, valor: 0 };
    const tem = desconto(v) > 0;
    turnos.set(k, { vendas: atual.vendas + 1, vendasComDesconto: atual.vendasComDesconto + (tem ? 1 : 0), valor: atual.valor + (tem ? desconto(v) : 0) });
  }

  const dias = [...new Set(comDado.map((v) => toCalendarDateKey(v.movementDate)))].sort();

  return {
    periodo,
    cobertura: {
      vendasComDado: comDado.length,
      vendasSemDado: vendas.length - comDado.length,
      primeiroDia: dias[0] ?? null,
      ultimoDia: dias[dias.length - 1] ?? null
    },
    resumo: {
      vendasRecebidas: comDado.length,
      vendasComDesconto: comDesconto.length,
      taxaVendas: razao(comDesconto.length, comDado.length),
      valorDescontos: round2(valorDescontos),
      valorSubtotal: round2(valorSubtotal),
      percentualSobreSubtotal: razao(valorDescontos, valorSubtotal),
      descontoMedio: comDesconto.length > 0 ? round2(valorDescontos / comDesconto.length) : 0,
      // Desconto que come mais da metade da conta merece olhar individual.
      // Subtotal zero com desconto (item lancado a zero) tambem entra: o desconto passa da conta inteira.
      acimaDe50: comDesconto.filter((v) => subtotal(v) <= 0 || desconto(v) / subtotal(v) > LIMITE_DESCONTO_ALTO).length,
      semPessoa: comDesconto.filter((v) => limpar(v.registeredBy) === "").length,
      semTipo: comDesconto.filter((v) => limpar(v.discountLabel) === "").length
    },
    porTipo: ordenar(agrupar((v) => limpar(v.discountLabel) || SEM_TIPO), SEM_TIPO).map(({ nome, ...x }) => ({ tipo: nome, ...x })),
    porPessoa: ordenar(agrupar((v) => limpar(v.registeredBy) || NAO_INFORMADO), NAO_INFORMADO).map(({ nome, ...x }) => ({ pessoa: nome, ...x })),
    porTurno: [...turnos.entries()]
      .map(([turno, x]) => ({ turno, vendas: x.vendas, vendasComDesconto: x.vendasComDesconto, taxa: razao(x.vendasComDesconto, x.vendas), valor: round2(x.valor) }))
      .sort((a, b) => a.turno.localeCompare(b.turno)),
    maiores: [...comDesconto]
      .sort((a, b) => desconto(b) - desconto(a) || a.saleId.localeCompare(b.saleId))
      .slice(0, MAX_MAIORES)
      .map((v) => ({
        saleId: v.saleId,
        data: toCalendarDateKey(v.movementDate),
        hora: v.saleHour,
        turno: v.shift.trim(),
        pessoas: v.people,
        subtotal: round2(subtotal(v)),
        desconto: round2(desconto(v)),
        percentual: razao(desconto(v), subtotal(v)),
        tipo: limpar(v.discountLabel) || SEM_TIPO,
        pessoa: limpar(v.registeredBy) || NAO_INFORMADO
      }))
  };
}
