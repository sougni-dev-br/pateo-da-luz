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
export const mascararReais = (texto: string) => texto.replace(/R\$\s?\d(?:[\d.,]*\d)?(?:\s(?:mil|mi)\b)?/g, "R$ ••••");

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
