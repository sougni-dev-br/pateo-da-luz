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

export type LeituraKeeta = { dias: DiaKeeta[]; erros: string[]; avisos: string[] };

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

/** Tetos que protegem a gravação: arquivo gigante ou valor absurdo viram erro de leitura, não erro de banco. */
const MAX_DIAS_POR_ARQUIVO = 400;
const PRIMEIRO_DIA_ACEITO = "2024-01-01";
const VALOR_MAXIMO_POR_DIA = 10_000_000;
/** Repasse acima do bruto em tantos dias assim deixa de ser exceção e vira sinal de colunas trocadas. */
const MIN_ANOMALIAS_PARA_RECUSAR = 3;
const PROPORCAO_MAXIMA_DE_ANOMALIAS = 0.25;

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

export function lerTabelaKeeta(tabela: unknown[][], hoje: string = new Date().toISOString().slice(0, 10)): LeituraKeeta {
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
    return { dias: [], erros: [`Colunas obrigatórias não encontradas: ${lista}.`], avisos: [] };
  }

  const corpo = tabela.slice(indiceCabecalho + 1).filter((l) => !ehLinhaVazia(l));
  if (corpo.length > MAX_DIAS_POR_ARQUIVO) {
    return { dias: [], erros: [`O arquivo tem mais de ${MAX_DIAS_POR_ARQUIVO} dias. Envie um período menor (um mês por vez).`], avisos: [] };
  }

  const dias: DiaKeeta[] = [];
  const erros: string[] = [];
  const vistos = new Set<string>();
  const acimaDoBruto: Array<{ date: string; netAmount: number; grossAmount: number }> = [];

  for (const linha of corpo) {
    if (ehLinhaVazia(linha)) continue;
    const bruto = linha[colunas.data!];
    if (normalizar(bruto) === "total") continue;

    const date = paraData(bruto);
    const rotulo = String(bruto ?? "").trim() || "(sem data)";
    if (!date) {
      erros.push(`Linha "${rotulo}": data inválida.`);
      continue;
    }
    if (date < PRIMEIRO_DIA_ACEITO || date > hoje) {
      erros.push(`Linha ${diaBr(date)}: data fora do período aceito (de 2024 até hoje).`);
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
    if (vendas > VALOR_MAXIMO_POR_DIA || repasse > VALOR_MAXIMO_POR_DIA) {
      erros.push(`Linha ${diaBr(date)}: valor acima do limite de ${VALOR_MAXIMO_POR_DIA.toLocaleString("pt-BR")}; confira as colunas.`);
      continue;
    }
    const grossAmount = arredondar(vendas - promocao);
    const netAmount = arredondar(repasse);
    if (grossAmount < 0) {
      erros.push(`Linha ${diaBr(date)}: a despesa (${arredondar(promocao)}) é maior que as vendas (${arredondar(vendas)}); confira as colunas.`);
      continue;
    }
    // O repasse pode passar do bruto num dia fraco (a plataforma credita outros ganhos, como entrega):
    // o dia entra com retenção negativa e um aviso. Só o conjunto diz se as colunas estão trocadas.
    if (netAmount > grossAmount + CENTAVO) {
      acimaDoBruto.push({ date, netAmount, grossAmount });
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

  if (acimaDoBruto.length >= MIN_ANOMALIAS_PARA_RECUSAR && acimaDoBruto.length / dias.length > PROPORCAO_MAXIMA_DE_ANOMALIAS) {
    return {
      dias: [],
      erros: [
        `Em ${acimaDoBruto.length} de ${dias.length} dias o repasse é maior que o bruto: as colunas Vendas de itens e Ganhos líquidos parecem trocadas.`
      ],
      avisos: []
    };
  }
  const avisos = acimaDoBruto.map(
    (a) => `Dia ${diaBr(a.date)}: o repasse (${a.netAmount}) ficou acima do bruto (${a.grossAmount}); o dia entra com retenção negativa.`
  );

  return { dias: dias.sort((a, b) => a.date.localeCompare(b.date)), erros, avisos };
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
