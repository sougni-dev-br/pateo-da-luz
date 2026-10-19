// Importação do faturamento da Keeta a partir de arquivo exportado do portal.
//
// A Keeta não tem integração com o ERP (ver keeta-resumo.ts). Este módulo é a ponte:
// lê o relatório diário do portal e devolve dias prontos para gravar. Só contas e
// leitura de tabela — nada de banco aqui, para poder ser testado.
//
// Regra de base (decisão de 19/09/2026, igual à da 99 — ver memória keeta-importada-abr-set):
//   bruto     = Vendas de itens − promoção bancada pela loja
//   retenção  = bruto − repasse            (comissão e taxas; vai em platformFees)
//   líquido   = repasse (Ganhos líquidos)
// A data é a de CONCLUSÃO do pedido, que é a competência — não a de liquidação da fatura.

export type DiaKeeta = {
  date: string;
  orders: number;
  grossAmount: number;
  netAmount: number;
  platformFees: number;
};

export type LeituraKeeta = { dias: DiaKeeta[]; erros: string[] };

export type DiaExistente = {
  id: string;
  date: string;
  orders: number;
  grossAmount: number;
  netAmount: number;
};

export type AcaoDoDia = "CRIAR" | "ALTERAR" | "IGUAL" | "CONFLITO";
export type ItemDoPlano = { dia: DiaKeeta; acao: AcaoDoDia; existenteId: string | null };

const CENTAVO = 0.01;

/** Nomes de coluna aceitos, já normalizados (minúsculo, sem acento). */
const COLUNAS = {
  data: ["data", "dia", "date", "data de conclusao", "data do pedido"],
  vendas: ["vendas de itens", "vendas"],
  promocao: ["despesa", "promocao da loja", "promocao bancada pela loja", "subsidio da loja", "promocao"],
  repasse: ["ganhos liquidos", "repasse", "valor liquido"],
  pedidos: ["pedidos", "pedidos validos", "numero de pedidos"]
} as const;

type ColunaKey = keyof typeof COLUNAS;
const OBRIGATORIAS: Array<{ key: ColunaKey; rotulo: string }> = [
  { key: "data", rotulo: "Data" },
  { key: "vendas", rotulo: "Vendas de itens" },
  { key: "repasse", rotulo: "Ganhos líquidos" }
];

function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function paraNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = String(valor ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (!texto) return null;
  const temVirgula = texto.includes(",");
  const limpo = temVirgula ? texto.replace(/\./g, "").replace(",", ".") : texto;
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

function dataValida(ano: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

function paraData(valor: unknown): string | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  const texto = String(valor ?? "").trim();
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return dataValida(Number(br[3]), Number(br[2]), Number(br[1]));
  const compacta = texto.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compacta) return dataValida(Number(compacta[1]), Number(compacta[2]), Number(compacta[3]));
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return dataValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

function diaBr(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

function mapearColunas(linha: unknown[]): Partial<Record<ColunaKey, number>> {
  const mapa: Partial<Record<ColunaKey, number>> = {};
  linha.forEach((celula, indice) => {
    const nome = normalizar(celula);
    for (const key of Object.keys(COLUNAS) as ColunaKey[]) {
      if (mapa[key] === undefined && (COLUNAS[key] as readonly string[]).includes(nome)) mapa[key] = indice;
    }
  });
  return mapa;
}

function ehLinhaVazia(linha: unknown[]): boolean {
  return linha.every((c) => String(c ?? "").trim() === "");
}

export function lerTabelaKeeta(tabela: unknown[][]): LeituraKeeta {
  // O cabeçalho é a primeira linha que reconhece data + vendas; o que vem antes é título.
  const indiceCabecalho = tabela.findIndex((linha) => {
    const m = mapearColunas(linha);
    return m.data !== undefined && m.vendas !== undefined;
  });
  const cabecalho = indiceCabecalho >= 0 ? tabela[indiceCabecalho] : tabela.find((l) => !ehLinhaVazia(l));
  const colunas = cabecalho ? mapearColunas(cabecalho) : {};
  const faltando = OBRIGATORIAS.filter((o) => colunas[o.key] === undefined).map((o) => o.rotulo);
  if (indiceCabecalho < 0 || faltando.length > 0) {
    const lista = (faltando.length > 0 ? faltando : OBRIGATORIAS.map((o) => o.rotulo)).join(", ");
    return { dias: [], erros: [`Colunas obrigatórias não encontradas: ${lista}.`] };
  }

  const dias: DiaKeeta[] = [];
  const erros: string[] = [];
  const vistos = new Set<string>();

  for (const linha of tabela.slice(indiceCabecalho + 1)) {
    if (ehLinhaVazia(linha)) continue;
    const bruto = linha[colunas.data!];
    if (normalizar(bruto) === "total") continue;

    const date = paraData(bruto);
    const rotulo = String(bruto ?? "").trim() || "(sem data)";
    if (!date) {
      erros.push(`Linha "${rotulo}": data inválida.`);
      continue;
    }
    if (vistos.has(date)) {
      erros.push(`Linha ${diaBr(date)}: data repetida no arquivo.`);
      continue;
    }

    const vendas = paraNumero(linha[colunas.vendas!]);
    const repasse = paraNumero(linha[colunas.repasse!]);
    const promocao = colunas.promocao === undefined ? 0 : paraNumero(linha[colunas.promocao]) ?? 0;
    const pedidos = colunas.pedidos === undefined ? 0 : paraNumero(linha[colunas.pedidos]) ?? 0;

    if (vendas === null || repasse === null || vendas < 0 || repasse < 0 || promocao < 0 || pedidos < 0) {
      erros.push(`Linha ${diaBr(date)}: valor ausente ou negativo.`);
      continue;
    }
    const grossAmount = arredondar(vendas - promocao);
    const netAmount = arredondar(repasse);
    if (grossAmount < 0 || netAmount > grossAmount + CENTAVO) {
      erros.push(`Linha ${diaBr(date)}: o repasse (${netAmount}) é maior que o bruto (${grossAmount}); confira as colunas.`);
      continue;
    }

    vistos.add(date);
    dias.push({
      date,
      orders: Math.round(pedidos),
      grossAmount,
      netAmount,
      platformFees: arredondar(grossAmount - netAmount)
    });
  }

  return { dias: dias.sort((a, b) => a.date.localeCompare(b.date)), erros };
}

/** CSV simples: BOM, aspas, delimitador `;` (padrão brasileiro) ou `,`. */
export function parseCsvKeeta(conteudo: string): string[][] {
  const texto = conteudo.replace(/^﻿/, "");
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? "";
  const delimitador = primeiraLinha.includes(";") ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let entreAspas = false;

  const fecharCampo = () => { linha.push(campo); campo = ""; };
  const fecharLinha = () => { fecharCampo(); linhas.push(linha); linha = []; };

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]!;
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') entreAspas = false;
      else campo += c;
    } else if (c === '"') entreAspas = true;
    else if (c === delimitador) fecharCampo();
    else if (c === "\n") fecharLinha();
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || linha.length > 0) fecharLinha();
  return linhas;
}

function iguais(a: number, b: number): boolean {
  return Math.abs(a - b) < CENTAVO / 2;
}

/** Cruza o arquivo com o que já está no razão. Um dia com 2+ lançamentos ativos não é tocado. */
export function planejarImportacao(dias: DiaKeeta[], existentes: DiaExistente[]): ItemDoPlano[] {
  const porDia = new Map<string, DiaExistente[]>();
  for (const e of existentes) porDia.set(e.date, [...(porDia.get(e.date) ?? []), e]);

  return dias.map((dia): ItemDoPlano => {
    const doDia = porDia.get(dia.date) ?? [];
    if (doDia.length === 0) return { dia, acao: "CRIAR", existenteId: null };
    if (doDia.length > 1) return { dia, acao: "CONFLITO", existenteId: null };
    const atual = doDia[0]!;
    const igual = iguais(atual.grossAmount, dia.grossAmount)
      && iguais(atual.netAmount, dia.netAmount)
      && atual.orders === dia.orders;
    return { dia, acao: igual ? "IGUAL" : "ALTERAR", existenteId: atual.id };
  });
}
