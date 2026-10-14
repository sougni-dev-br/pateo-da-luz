import type { AnalisePeriodo, AnaliseVariacao } from "../../api/client";

// Formatação da Análise do Salão: números curtos para decisão, não para conferência de centavos.
// Valores monetários que precisam respeitar "ocultar valores" passam por useFormato().

const MILHAO = 1_000_000;
const DEZ_MIL = 10_000;
const MENOS = "−"; // sinal de menos tipográfico, não hífen

const numero = (n: number, casas: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const inteiro = (n: number) => numero(Math.round(n), 0);
export const decimal1 = (n: number) => numero(n, 1);

// R$ 9.983 · R$ 26,4 mil · R$ 1,2 mi. Acima de 10 mil o milhar não ajuda a decidir, só ocupa linha.
export function reaisCompacto(n: number): string {
  const abs = Math.abs(n);
  const sinal = n < 0 ? MENOS : "";
  // 999.960 arredonda para "1.000,0 mil": passa para milhão antes disso.
  if (abs >= MILHAO - 50) return `${sinal}R$ ${numero(abs / MILHAO, 1)} mi`;
  if (abs >= DEZ_MIL) return `${sinal}R$ ${numero(abs / 1000, 1)} mil`;
  return `${sinal}R$ ${numero(abs, 0)}`;
}

// Valores unitários (preço, custo, margem por prato) com centavos: arredondar R$ 39,90 e R$ 38,60 para R$ 40 e R$ 39 esconde a decisão.
export const reaisCentavos = (n: number) => `${n < 0 ? MENOS : ""}R$ ${numero(Math.abs(n), 2)}`;

export const reaisInteiro = (n: number) => `${n < 0 ? MENOS : ""}R$ ${numero(Math.abs(n), 0)}`;

// razão (0,238) -> "23,8%". Para pontos percentuais já calculados, use pontos().
export const percentual = (razao: number, casas = 1) => `${numero(razao * 100, casas)}%`;

// Diferença entre duas razões, em pontos percentuais: 0,012 -> "+1,2 pp". Menos de 0,05 pp é ruído.
export function textoPontos(razaoDiferenca: number | null): string {
  if (razaoDiferenca === null) return "—";
  const pp = razaoDiferenca * 100;
  if (Math.abs(pp) < 0.05) return "0,0 pp";
  return `${pp > 0 ? "+" : MENOS}${numero(Math.abs(pp), 1)} pp`;
}

export function dataCurta(iso: string | null | undefined, comAno = false): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}${comAno ? `/${iso.slice(0, 4)}` : ""}`;
}

// Mostra o ano só quando o período atravessa a virada: "14/10 a 13/10" de um ano inteiro confunde.
export const intervalo = (p: AnalisePeriodo) => {
  const comAno = p.inicio.slice(0, 4) !== p.fim.slice(0, 4);
  return `${dataCurta(p.inicio, comAno)} a ${dataCurta(p.fim, comAno)}`;
};

// Textos que vêm do servidor trazem reais no meio da frase. Com "ocultar valores" ligado, o valor
// some também ali (R$ 11.000 · R$ 26,4 mil · R$ 1,2 mi).
// "R$ 0" fica: "vendidos a R$ 0" é o fato (nenhum valor lançado), não um valor da operação a esconder.
export const mascararReais = (texto: string) => texto.replace(/R\$\s?(?!0(?!\d|[.,]\d))\d(?:[\d.,]*\d)?(?:\s(?:mil|mi)\b)?/g, "R$ ••••");

export type Direcao = "up" | "down" | "flat";

// Variação abaixo de meio ponto percentual é ruído: seta "estável" em vez de subir ou cair.
export const TOLERANCIA_ESTAVEL = 0.005;

export function direcao(v: AnaliseVariacao | null): Direcao {
  if (!v || v.pct === null) return "flat";
  if (Math.abs(v.pct) < TOLERANCIA_ESTAVEL) return "flat";
  return v.pct > 0 ? "up" : "down";
}

export function textoVariacao(v: AnaliseVariacao | null): string {
  if (!v || v.pct === null) return "sem base de comparação";
  const sinal = Math.abs(v.pct) < TOLERANCIA_ESTAVEL ? "" : v.pct > 0 ? "+" : MENOS;
  return `${sinal}${percentual(Math.abs(v.pct))}`;
}

// Para indicadores em que SUBIR é ruim (perda, cancelamento): mesma direção, cor invertida.
export type Sentido = "bom" | "ruim" | "neutro";
export function sentido(v: AnaliseVariacao | null, subirEBom: boolean): Sentido {
  const d = direcao(v);
  if (d === "flat") return "neutro";
  return (d === "up") === subirEBom ? "bom" : "ruim";
}

export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;
// Semana começando na segunda: é como o restaurante pensa a escala.
export const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0] as const;

export function diaDaSemana(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
// Texto sem acento e em caixa baixa, para buscar por parte do nome.
export const semAcentoEmCaixaBaixa = (s: string) => s.normalize("NFD").replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "").toLowerCase();

// Quantidade consumida por venda ("150", "0,15", "0.750"): como o servidor guarda 4 casas decimais, "0.750" é três
// quartos, não setecentos e cinquenta. Fora do zero à esquerda vale a leitura de sempre (1.500 = mil e quinhentos).
// "1.500" pode ser mil e quinhentos ou um e meio. Para o consumo por venda, que vira custo, a dúvida não se resolve em silêncio.
export const quantidadeAmbigua = (texto: string) => /^[1-9]\d{0,2}\.\d{3}$/.test(texto.trim());

export function lerQuantidade(texto: string): number | null {
  const limpo = texto.trim();
  if (/^0[.,]\d+$/.test(limpo)) return Number(limpo.replace(",", "."));
  return lerNumeroBr(limpo);
}

export const nomeDoMes = (mes: number, ano: number) => `${MESES[mes - 1]} de ${ano}`;

// Lê o que a pessoa digitou ("300.000", "300000,50", "R$ 98,5") como número. null = não é número.
export function lerNumeroBr(texto: string): number | null {
  const limpo = texto.replace(/R\$|%|\s/g, "");
  if (limpo === "") return null;
  let normal: string;
  if (limpo.includes(",")) {
    // Com vírgula decimal, o que vem antes só pode ser inteiro ou agrupado de mil em mil ("1.234,5").
    // "1,234.56" (formato inglês) ou "12.34,5" são recusados em vez de lidos de qualquer jeito.
    if (!/^(\d+|\d{1,3}(\.\d{3})+),\d+$/.test(limpo)) return null;
    normal = limpo.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, "");
  else normal = limpo;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}
