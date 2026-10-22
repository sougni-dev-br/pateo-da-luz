// Conciliação do extrato do banco (texto colado) com as linhas da fatura.
// Só contas puras: a tela decide o que fazer com o resultado.

export type LinhaDoExtrato = {
  texto: string;
  descricao: string;
  dia: number | null;
  mes: number | null;
  valor: number;
};

export type ItemParaConciliar = {
  id: string;
  value: string | number;
  itemDate: string | null;
  description: string;
};

export type ParConciliado<T extends ItemParaConciliar> = {
  linha: LinhaDoExtrato;
  itemId: string;
  item: T;
  /** "data": valor e data batem (±3 dias); "valor": só o valor bate. */
  certeza: "data" | "valor";
};

export type ResultadoDaConciliacao<T extends ItemParaConciliar> = {
  pares: ParConciliado<T>[];
  soNoExtrato: LinhaDoExtrato[];
  soNoSistema: T[];
};

const VALOR_BR = /-?\s?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)/g;
const DATA_INICIAL = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+/;
const TOLERANCIA_EM_DIAS = 3;

function emCentavos(valor: number | string): number {
  return Math.round(Number(valor) * 100);
}

export function lerExtrato(texto: string): LinhaDoExtrato[] {
  const linhas: LinhaDoExtrato[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const limpa = bruta.replace(/R\$/g, "").trim();
    if (!limpa) continue;
    const valores = limpa.match(VALOR_BR);
    if (!valores) continue;
    const ultimo = valores[valores.length - 1];
    const valor = Number(ultimo.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
    const data = limpa.match(DATA_INICIAL);
    const semData = data ? limpa.slice(data[0].length) : limpa;
    const descricao = semData.slice(0, semData.lastIndexOf(ultimo)).trim();
    linhas.push({
      texto: bruta.trim(),
      descricao,
      dia: data ? Number(data[1]) : null,
      mes: data ? Number(data[2]) : null,
      valor
    });
  }
  return linhas;
}

function diasEntre(linha: LinhaDoExtrato, itemDate: string | null): number | null {
  if (linha.dia == null || linha.mes == null || !itemDate) return null;
  const [ano, mes, dia] = itemDate.slice(0, 10).split("-").map(Number);
  const doItem = Date.UTC(ano, mes - 1, dia);
  // O extrato não traz o ano: usa o do item, e testa também o ano seguinte/anterior (virada de ano).
  const candidatos = [ano - 1, ano, ano + 1].map((a) => Date.UTC(a, linha.mes! - 1, linha.dia!));
  return Math.min(...candidatos.map((c) => Math.abs(c - doItem))) / 86_400_000;
}

export function conciliarExtrato<T extends ItemParaConciliar>(
  linhas: LinhaDoExtrato[],
  itens: T[]
): ResultadoDaConciliacao<T> {
  const livres = new Map(itens.map((item) => [item.id, item]));
  const pares: ParConciliado<T>[] = [];
  const soNoExtrato: LinhaDoExtrato[] = [];

  const consumir = (linha: LinhaDoExtrato, item: T, certeza: "data" | "valor") => {
    livres.delete(item.id);
    pares.push({ linha, itemId: item.id, item, certeza });
  };

  // 1ª passada: valor e data (a linha mais exata vence a mais distante).
  const semPar: LinhaDoExtrato[] = [];
  for (const linha of linhas) {
    const doMesValor = [...livres.values()].filter((item) => emCentavos(item.value) === emCentavos(linha.valor));
    const comData = doMesValor
      .map((item) => ({ item, dias: diasEntre(linha, item.itemDate) }))
      .filter((c): c is { item: T; dias: number } => c.dias !== null && c.dias <= TOLERANCIA_EM_DIAS)
      .sort((a, b) => a.dias - b.dias);
    if (comData.length > 0) consumir(linha, comData[0].item, "data");
    else semPar.push(linha);
  }

  // 2ª passada: o que sobrou casa só por valor (o mais antigo primeiro).
  for (const linha of semPar) {
    const candidatos = [...livres.values()]
      .filter((item) => emCentavos(item.value) === emCentavos(linha.valor))
      .sort((a, b) => String(a.itemDate ?? "").localeCompare(String(b.itemDate ?? "")));
    if (candidatos.length > 0) consumir(linha, candidatos[0], "valor");
    else soNoExtrato.push(linha);
  }

  return { pares, soNoExtrato, soNoSistema: [...livres.values()] };
}
