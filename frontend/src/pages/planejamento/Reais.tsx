import { useOculto } from "./useOculto";

// Dinheiro do Planejamento: o sinal fica colado ao número ("−R$ 47.542"), com o traço de menos de verdade (U+2212) e o
// mesmo peso do número, para as colunas lerem de uma vez. Nas tabelas o "R$" sai da célula (a unidade vai no
// cabeçalho ou na legenda) e fica só o número. Respeita o "ocultar valores" do sistema, como o Money.

const MENOS = "−";

type Props = { valor: number | null | undefined; casas?: number; moeda?: boolean; sinalPositivo?: boolean; className?: string };

export function textoEmReais(valor: number, casas = 0, moeda = true, sinalPositivo = false): string {
  const numero = Math.abs(valor).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const zero = Number(numero.replace(/\./g, "").replace(",", ".")) === 0;
  const sinal = zero ? "" : valor < 0 ? MENOS : sinalPositivo ? "+" : "";
  return `${sinal}${moeda ? "R$ " : ""}${numero}`;
}

export function Reais({ valor, casas = 0, moeda = true, sinalPositivo = false, className }: Props) {
  const hidden = useOculto();
  const classe = ["plan-reais", className].filter(Boolean).join(" ");
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return <span className={classe}>—</span>;
  if (hidden) return <span className={classe} aria-label="valor oculto">{moeda ? "R$ " : ""}••••</span>;
  return <span className={classe}>{textoEmReais(valor, casas, moeda, sinalPositivo)}</span>;
}

/** Valor curto para rótulos de gráfico: 92.300 → "92k", −78.277 → "−78k", 1.250.000 → "1,3M". */
export function compacto(valor: number, sinalPositivo = false): string {
  const abs = Math.abs(valor);
  const sinal = valor < 0 && abs >= 0.5 ? MENOS : valor > 0 && sinalPositivo && abs >= 0.5 ? "+" : "";
  if (abs >= 999_500) return `${sinal}${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `${sinal}${Math.round(abs / 1_000).toLocaleString("pt-BR")}k`;
  return `${sinal}${Math.round(abs).toLocaleString("pt-BR")}`;
}

/** Valor curto por extenso para frases: −78.277 → "−78 mil". */
export function emMil(valor: number): string {
  const abs = Math.abs(valor);
  const sinal = valor < 0 ? MENOS : "";
  if (abs >= 999_500) return `${sinal}${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${sinal}${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: abs >= 10_000 ? 0 : 1 })} mil`;
  return `${sinal}${Math.round(abs).toLocaleString("pt-BR")}`;
}
