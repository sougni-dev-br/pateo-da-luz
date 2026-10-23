// Regras puras da coleta de óleo: validação da entrada e totais. Sem banco, para testar direto.

export const VOLUME_MAXIMO_LITROS = 5000;
export const VALOR_MAXIMO = 100_000;
export const COLETOR_PADRAO = "Retióleo";
// Limite inferior das datas: a tela lista por ano a partir daqui, então uma data mais antiga ficaria invisível.
export const ANO_MINIMO = 2024;
export const ANO_MAXIMO = 2100;

export type EntradaDeColeta = {
  collectionDate: string;
  collectorName: string;
  certificateNumber: string | null;
  volumeLiters: number;
  amount: number;
  notes: string | null;
};

export type ResultadoDaEntrada = { ok: true; dados: EntradaDeColeta } | { ok: false; erro: string };

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const NUMERO_COM_DUAS_CASAS = /^\d+(\.\d{1,2})?$/;

/** Hoje no calendário de São Paulo (o servidor roda em UTC: depois das 21h o dia UTC já é o seguinte). */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

/**
 * Número não negativo, com até duas casas, vindo como número ou texto ("70", "70,5").
 * Milhar ("1.250,00") não é aceito de propósito. Mais de duas casas é recusado em vez de arredondado,
 * porque o certificado só traz centavos e arredondar em ponto flutuante erra o último.
 */
export function lerNumero(valor: unknown): number | null {
  const texto = typeof valor === "number" ? (Number.isFinite(valor) ? String(valor) : "") : typeof valor === "string" ? valor.trim().replace(",", ".") : "";
  return NUMERO_COM_DUAS_CASAS.test(texto) ? Number(texto) : null;
}

export function dataIsoValida(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (!DATA_ISO.test(texto)) return null;
  const d = new Date(`${texto}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texto) return null;
  const ano = d.getUTCFullYear();
  return ano >= ANO_MINIMO && ano <= ANO_MAXIMO ? texto : null;
}

/** Um dia a frente de hoje: cobre diferença de fuso sem deixar lançar coleta do futuro. */
export function passaDeAmanha(dataIso: string, hojeIso: string): boolean {
  const limite = new Date(`${hojeIso}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + 1);
  return new Date(`${dataIso}T00:00:00Z`) > limite;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "retioleo " e "RETIÓLEO" são o mesmo coletor: sem isto o par coletor + certificado deixa a mesma coleta entrar duas vezes. */
export function normalizarColetor(valor: string): string {
  const limpo = valor.trim().replace(/\s+/g, " ");
  return semAcento(limpo) === semAcento(COLETOR_PADRAO) ? COLETOR_PADRAO : limpo;
}

/** Texto opcional: aceita só texto de verdade ("[object Object]" não vira dado). */
function lerTexto(valor: unknown): string | null {
  if (valor === undefined || valor === null) return "";
  return typeof valor === "string" ? valor.trim() : null;
}

export function validarEntrada(corpo: Record<string, unknown>, hojeIso: string): ResultadoDaEntrada {
  const data = dataIsoValida(corpo.collectionDate);
  if (!data) return { ok: false, erro: "Informe a data da coleta." };
  if (passaDeAmanha(data, hojeIso)) return { ok: false, erro: "A data da coleta não pode ser futura." };

  const volume = lerNumero(corpo.volumeLiters);
  if (volume === null || volume <= 0) return { ok: false, erro: "Informe o volume coletado, em litros (até 2 casas decimais)." };
  if (volume > VOLUME_MAXIMO_LITROS) return { ok: false, erro: `Volume acima de ${VOLUME_MAXIMO_LITROS} litros: confira o certificado.` };

  const valor = lerNumero(corpo.amount);
  if (valor === null) return { ok: false, erro: "Informe o valor pago pela coleta, em reais (sem negativo, até 2 casas decimais)." };
  if (valor > VALOR_MAXIMO) return { ok: false, erro: "Valor acima do esperado: confira o certificado." };

  const coletor = lerTexto(corpo.collectorName);
  const certificado = lerTexto(corpo.certificateNumber);
  const observacao = lerTexto(corpo.notes);
  if (coletor === null || certificado === null || observacao === null) return { ok: false, erro: "Os campos de texto precisam ser texto." };

  const nomeDoColetor = normalizarColetor(coletor) || COLETOR_PADRAO;
  if (nomeDoColetor.length > 80) return { ok: false, erro: "Nome do coletor muito longo." };
  if (certificado.length > 30) return { ok: false, erro: "Número do certificado muito longo." };
  if (observacao.length > 500) return { ok: false, erro: "Observação muito longa (máximo 500 caracteres)." };

  return {
    ok: true,
    dados: {
      collectionDate: data,
      collectorName: nomeDoColetor,
      certificateNumber: certificado.toUpperCase() || null,
      volumeLiters: volume,
      amount: valor,
      notes: observacao || null
    }
  };
}

export type SituacaoDaColeta = "PENDING" | "PARTIAL" | "RECEIVED" | "CANCELLED";

/**
 * A situação do PIX vem do título no Contas a Receber (a baixa é feita lá). Coleta cancelada, ou com o
 * título cancelado lá, sai de tudo; título que não existe mais (apagado) segue como pendente.
 */
export function situacaoDaColeta(canceladaAqui: boolean, statusDoTitulo: string | null): SituacaoDaColeta {
  if (canceladaAqui || statusDoTitulo === "CANCELLED") return "CANCELLED";
  if (statusDoTitulo === "RECEIVED") return "RECEIVED";
  if (statusDoTitulo === "PARTIALLY_RECEIVED") return "PARTIAL";
  return "PENDING";
}

/** Descrição do título no Contas a Receber: identifica a coleta sem precisar abrir esta tela. */
export function descricaoDoTitulo(d: Pick<EntradaDeColeta, "collectorName" | "certificateNumber" | "volumeLiters">): string {
  const certificado = d.certificateNumber ? ` · CDF ${d.certificateNumber}` : "";
  return `Coleta de óleo · ${d.collectorName}${certificado} · ${d.volumeLiters.toLocaleString("pt-BR")} L`;
}

export type ColetaParaTotal = { collectionDate: string; volumeLiters: number; amount: number; paidAmount: number; status: string };

export type TotaisDoMes = { month: string; collections: number; liters: number; amount: number };

export type ResumoDasColetas = {
  collections: number;
  liters: number;
  amount: number;
  /** R$ por litro, médio do período; null sem volume. */
  pricePerLiter: number | null;
  /** Coletas com PIX por chegar (pendentes e parciais) e quanto ainda falta. */
  pendingCount: number;
  pendingAmount: number;
  receivedCount: number;
  /** O que de fato entrou: o valor baixado no Contas a Receber. */
  receivedAmount: number;
  lastCollectionDate: string | null;
  months: TotaisDoMes[];
};

const arredonda = (n: number) => Math.round(n * 100) / 100;

/** Cancelada não conta em nada. */
export function resumir(coletas: ColetaParaTotal[]): ResumoDasColetas {
  const validas = coletas.filter((c) => c.status !== "CANCELLED");
  const porMes = new Map<string, TotaisDoMes>();
  let litros = 0;
  let valor = 0;
  let pendentes = 0;
  let faltante = 0;
  let recebidas = 0;
  let entrou = 0;
  let ultima: string | null = null;

  for (const c of validas) {
    litros += c.volumeLiters;
    valor += c.amount;
    entrou += c.paidAmount;
    if (c.status === "RECEIVED") recebidas += 1;
    else {
      pendentes += 1;
      faltante += Math.max(0, c.amount - c.paidAmount);
    }
    if (!ultima || c.collectionDate > ultima) ultima = c.collectionDate;
    const mes = c.collectionDate.slice(0, 7);
    const linha = porMes.get(mes) ?? { month: mes, collections: 0, liters: 0, amount: 0 };
    linha.collections += 1;
    linha.liters += c.volumeLiters;
    linha.amount += c.amount;
    porMes.set(mes, linha);
  }

  return {
    collections: validas.length,
    liters: arredonda(litros),
    amount: arredonda(valor),
    pricePerLiter: litros > 0 ? arredonda(valor / litros) : null,
    pendingCount: pendentes,
    pendingAmount: arredonda(faltante),
    receivedCount: recebidas,
    receivedAmount: arredonda(entrou),
    lastCollectionDate: ultima,
    months: [...porMes.values()]
      .map((m) => ({ ...m, liters: arredonda(m.liters), amount: arredonda(m.amount) }))
      .sort((a, b) => b.month.localeCompare(a.month))
  };
}
