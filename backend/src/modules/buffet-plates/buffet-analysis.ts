// Análise do buffet a partir das pesagens: por dia e por prato, quanto foi produzido, quanto sobrou, quanto foi
// consumido, o custo disso e o que isso dá por pessoa. Funções puras, sem banco.
//
// Regra central: só dá para saber o consumo de um prato num dia se a SOBRA dele foi pesada. Sem sobra pesada
// (nem uma panela vazia, que vale 0), o consumo fica desconhecido: assumir "não sobrou nada" inflaria o consumo.

export type PesagemDoDia = { date: string; itemId: string; phase: "PRODUCAO" | "SOBRA"; netG: number };
export type PdvDoDia = { date: string; people: number; revenue: number };

/** Mínimo de dias com sobra pesada para falar em padrão do prato. */
export const MIN_DIAS_COM_SOBRA = 3;
/** Sobra a partir da qual o prato está sendo produzido demais. */
export const SOBRA_ALTA = 0.25;
/** Sobra tão pequena que o prato pode ter acabado antes do fim do serviço. */
export const SOBRA_MUITO_BAIXA = 0.03;

export type SinalDoPrato = "SOBRA_ALTA" | "PODE_FALTAR" | "POUCOS_DIAS";

export type DiaAnalisado = {
  date: string;
  people: number | null;
  revenue: number | null;
  producedG: number;
  /** Só dos pratos com sobra pesada naquele dia. */
  leftoverG: number;
  consumedG: number;
  itemsProduced: number;
  itemsWithLeftover: number;
  /** Custos só dos pratos com custo conhecido; nulos quando nenhum prato do dia tem custo. */
  producedCost: number | null;
  leftoverCost: number | null;
  consumedCost: number | null;
  itemsWithCost: number;
  gPerPerson: number | null;
  costPerPerson: number | null;
  revenuePerPerson: number | null;
  marginPerPerson: number | null;
};

export type PratoAnalisado = {
  itemId: string;
  days: number;
  daysWithLeftover: number;
  /** Dias com sobra pesada E pessoas no PDV: de onde sai o "por pessoa". */
  daysForPerPerson: number;
  producedG: number;
  leftoverG: number;
  consumedG: number;
  /** Sobra ÷ produzido, nos dias com sobra pesada. */
  leftoverPct: number | null;
  /** Gramas consumidas por pessoa que passou pelo buffet, nos dias com sobra pesada e com pessoas. */
  gPerPerson: number | null;
  costPerKg: number | null;
  leftoverCost: number | null;
  consumedCost: number | null;
  costPerPerson: number | null;
  signals: SinalDoPrato[];
};

export type ResumoAnalisado = {
  days: number;
  daysWithPeople: number;
  /** Dias com pessoas e TODOS os pratos com custo: só eles entram no custo e na margem por pessoa. */
  daysWithFullCost: number;
  people: number;
  producedG: number;
  leftoverG: number;
  consumedG: number;
  leftoverPct: number | null;
  producedCost: number | null;
  leftoverCost: number | null;
  consumedCost: number | null;
  revenue: number | null;
  costPerPerson: number | null;
  revenuePerPerson: number | null;
  marginPerPerson: number | null;
  gPerPerson: number | null;
};

export type Analise = {
  days: DiaAnalisado[];
  items: PratoAnalisado[];
  summary: ResumoAnalisado;
  /** Pratos produzidos no dia pesado mais recente: o cardápio mais atual, ponto de partida do planejamento. */
  lastDayItemIds: string[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number) => Math.round(v * 10000) / 10000;
const inteiro = (v: number) => Math.round(v);
const emReais = (g: number, porKg: number) => (g / 1000) * porKg;

type DiaDoPrato = { date: string; itemId: string; producedG: number; leftoverG: number; hasLeftover: boolean };

function agruparPorDiaEPrato(pesagens: PesagemDoDia[]): DiaDoPrato[] {
  const mapa = new Map<string, DiaDoPrato>();
  for (const p of pesagens) {
    const chave = `${p.date}|${p.itemId}`;
    const atual = mapa.get(chave) ?? { date: p.date, itemId: p.itemId, producedG: 0, leftoverG: 0, hasLeftover: false };
    if (p.phase === "PRODUCAO") atual.producedG += p.netG;
    else { atual.leftoverG += p.netG; atual.hasLeftover = true; }
    mapa.set(chave, atual);
  }
  // Sobra sem produção pesada no mesmo dia é pesagem incompleta: não entra em nenhuma conta.
  // A sobra também não passa do produzido (reposição não pesada): senão produzido ≠ sobra + consumido e a sobra% passa de 100%.
  return [...mapa.values()].filter((d) => d.producedG > 0).map((d) => ({ ...d, leftoverG: Math.min(d.leftoverG, d.producedG) }));
}

export function analisarBuffet(pesagens: PesagemDoDia[], pdv: PdvDoDia[], custoPorKg: Map<string, number | null>): Analise {
  const diasDoPrato = agruparPorDiaEPrato(pesagens);
  const pdvPorDia = new Map(pdv.map((d) => [d.date, d]));
  const porDia = new Map<string, DiaDoPrato[]>();
  for (const d of diasDoPrato) porDia.set(d.date, [...(porDia.get(d.date) ?? []), d]);

  const dias: DiaAnalisado[] = [...porDia.keys()].sort().map((date) => {
    const itens = porDia.get(date) ?? [];
    const comSobra = itens.filter((i) => i.hasLeftover);
    const comCusto = itens.filter((i) => (custoPorKg.get(i.itemId) ?? null) !== null);
    const people = pdvPorDia.get(date)?.people ?? null;
    const revenue = pdvPorDia.get(date)?.revenue ?? null;
    const valid = people !== null && people > 0;

    const producedG = itens.reduce((a, i) => a + i.producedG, 0);
    const leftoverG = comSobra.reduce((a, i) => a + i.leftoverG, 0);
    const consumedG = comSobra.reduce((a, i) => a + Math.max(0, i.producedG - i.leftoverG), 0);
    const temCusto = comCusto.length > 0;
    const producedCost = temCusto ? comCusto.reduce((a, i) => a + emReais(i.producedG, custoPorKg.get(i.itemId) ?? 0), 0) : null;
    const leftoverCost = temCusto ? comCusto.filter((i) => i.hasLeftover).reduce((a, i) => a + emReais(i.leftoverG, custoPorKg.get(i.itemId) ?? 0), 0) : null;
    const consumedCost = temCusto ? comCusto.filter((i) => i.hasLeftover).reduce((a, i) => a + emReais(Math.max(0, i.producedG - i.leftoverG), custoPorKg.get(i.itemId) ?? 0), 0) : null;
    // Conta por pessoa só fecha quando o dia está completo: com prato sem sobra pesada o consumo fica subestimado, e com
    // prato sem custo o custo cai e a margem sobe sem motivo.
    const sobraCompleta = comSobra.length === itens.length;
    const custoCompleto = comCusto.length === itens.length;
    const costPerPerson = valid && custoCompleto && producedCost !== null ? producedCost / (people as number) : null;
    const revenuePerPerson = valid && revenue !== null ? revenue / (people as number) : null;
    return {
      date, people, revenue, producedG: inteiro(producedG), leftoverG: inteiro(leftoverG), consumedG: inteiro(consumedG),
      itemsProduced: itens.length, itemsWithLeftover: comSobra.length,
      producedCost: producedCost === null ? null : centavos(producedCost),
      leftoverCost: leftoverCost === null ? null : centavos(leftoverCost),
      consumedCost: consumedCost === null ? null : centavos(consumedCost),
      itemsWithCost: comCusto.length,
      gPerPerson: valid && sobraCompleta ? inteiro(consumedG / (people as number)) : null,
      costPerPerson: costPerPerson === null ? null : centavos(costPerPerson),
      revenuePerPerson: revenuePerPerson === null ? null : centavos(revenuePerPerson),
      marginPerPerson: costPerPerson !== null && revenuePerPerson !== null ? centavos(revenuePerPerson - costPerPerson) : null,
    };
  });

  const ids = [...new Set(diasDoPrato.map((d) => d.itemId))];
  const pratos: PratoAnalisado[] = ids.map((itemId) => {
    const linhas = diasDoPrato.filter((d) => d.itemId === itemId);
    const comSobra = linhas.filter((l) => l.hasLeftover);
    const producedG = linhas.reduce((a, l) => a + l.producedG, 0);
    const producedNosDiasComSobra = comSobra.reduce((a, l) => a + l.producedG, 0);
    const leftoverG = comSobra.reduce((a, l) => a + l.leftoverG, 0);
    const consumedG = comSobra.reduce((a, l) => a + Math.max(0, l.producedG - l.leftoverG), 0);
    const comSobraEPessoas = comSobra.filter((l) => (pdvPorDia.get(l.date)?.people ?? 0) > 0);
    const pessoas = comSobraEPessoas.reduce((a, l) => a + (pdvPorDia.get(l.date)?.people ?? 0), 0);
    const consumidoComPessoas = comSobraEPessoas.reduce((a, l) => a + Math.max(0, l.producedG - l.leftoverG), 0);
    const leftoverPct = producedNosDiasComSobra > 0 ? leftoverG / producedNosDiasComSobra : null;
    const gPerPerson = pessoas > 0 ? consumidoComPessoas / pessoas : null;
    const porKg = custoPorKg.get(itemId) ?? null;

    const sinais: SinalDoPrato[] = [];
    if (comSobra.length < MIN_DIAS_COM_SOBRA) sinais.push("POUCOS_DIAS");
    else if (leftoverPct !== null && leftoverPct >= SOBRA_ALTA) sinais.push("SOBRA_ALTA");
    else if (leftoverPct !== null && leftoverPct <= SOBRA_MUITO_BAIXA) sinais.push("PODE_FALTAR");

    return {
      itemId, days: linhas.length, daysWithLeftover: comSobra.length, daysForPerPerson: comSobraEPessoas.length, producedG: inteiro(producedG), leftoverG: inteiro(leftoverG),
      consumedG: inteiro(consumedG), leftoverPct: leftoverPct === null ? null : pct(leftoverPct),
      gPerPerson: gPerPerson === null ? null : inteiro(gPerPerson), costPerKg: porKg === null ? null : centavos(porKg),
      leftoverCost: porKg === null || comSobra.length === 0 ? null : centavos(emReais(leftoverG, porKg)),
      consumedCost: porKg === null || comSobra.length === 0 ? null : centavos(emReais(consumedG, porKg)),
      costPerPerson: porKg === null || gPerPerson === null ? null : centavos(emReais(gPerPerson, porKg)),
      signals: sinais,
    };
  }).sort((a, b) => b.producedG - a.producedG);

  const diasComPessoas = dias.filter((d) => d.people !== null && d.people > 0);
  const pessoasTotal = diasComPessoas.reduce((a, d) => a + (d.people ?? 0), 0);
  const somaOuNulo = (lista: DiaAnalisado[], f: (d: DiaAnalisado) => number | null) => {
    const v = lista.map(f).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, x) => a + x, 0) : null;
  };
  const producedCost = somaOuNulo(dias, (d) => d.producedCost);
  const leftoverCost = somaOuNulo(dias, (d) => d.leftoverCost);
  const consumedCost = somaOuNulo(dias, (d) => d.consumedCost);
  const revenueComPessoas = somaOuNulo(diasComPessoas, (d) => d.revenue);
  const revenuePerPerson = pessoasTotal > 0 && revenueComPessoas !== null ? revenueComPessoas / pessoasTotal : null;

  // Custo e margem por pessoa: só dos dias com pessoas e com todos os pratos com custo, e a receita desses MESMOS dias.
  const diasCustoCompleto = diasComPessoas.filter((d) => d.itemsProduced > 0 && d.itemsWithCost === d.itemsProduced && d.producedCost !== null);
  const pessoasCusto = diasCustoCompleto.reduce((a, d) => a + (d.people ?? 0), 0);
  const custoCompleto = pessoasCusto > 0 ? diasCustoCompleto.reduce((a, d) => a + (d.producedCost ?? 0), 0) : null;
  const receitaCusto = somaOuNulo(diasCustoCompleto, (d) => d.revenue);
  const costPerPerson = custoCompleto !== null ? custoCompleto / pessoasCusto : null;
  const marginPerPerson = costPerPerson !== null && receitaCusto !== null ? receitaCusto / pessoasCusto - costPerPerson : null;

  // Gramas por pessoa: só dos dias em que todos os pratos tiveram a sobra pesada.
  const diasSobraCompleta = diasComPessoas.filter((d) => d.itemsProduced > 0 && d.itemsWithLeftover === d.itemsProduced);
  const pessoasSobra = diasSobraCompleta.reduce((a, d) => a + (d.people ?? 0), 0);
  const consumidoSobraCompleta = diasSobraCompleta.reduce((a, d) => a + d.consumedG, 0);
  const leftoverG = dias.reduce((a, d) => a + d.leftoverG, 0);
  const consumedG = dias.reduce((a, d) => a + d.consumedG, 0);
  const producedG = dias.reduce((a, d) => a + d.producedG, 0);
  const producedNosDiasComSobra = diasDoPrato.filter((d) => d.hasLeftover).reduce((a, d) => a + d.producedG, 0);

  return {
    days: dias,
    items: pratos,
    lastDayItemIds: dias.length ? (porDia.get(dias[dias.length - 1].date) ?? []).map((i) => i.itemId) : [],
    summary: {
      days: dias.length, daysWithPeople: diasComPessoas.length, daysWithFullCost: diasCustoCompleto.length, people: pessoasTotal, producedG: inteiro(producedG), leftoverG: inteiro(leftoverG),
      consumedG: inteiro(consumedG), leftoverPct: producedNosDiasComSobra > 0 ? pct(leftoverG / producedNosDiasComSobra) : null,
      producedCost: producedCost === null ? null : centavos(producedCost),
      leftoverCost: leftoverCost === null ? null : centavos(leftoverCost),
      consumedCost: consumedCost === null ? null : centavos(consumedCost),
      revenue: revenueComPessoas === null ? null : centavos(revenueComPessoas),
      costPerPerson: costPerPerson === null ? null : centavos(costPerPerson),
      revenuePerPerson: revenuePerPerson === null ? null : centavos(revenuePerPerson),
      marginPerPerson: marginPerPerson === null ? null : centavos(marginPerPerson),
      gPerPerson: pessoasSobra > 0 ? inteiro(consumidoSobraCompleta / pessoasSobra) : null,
    },
  };
}
