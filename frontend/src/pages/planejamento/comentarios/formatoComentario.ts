import type { PlanejamentoComparativo } from "../../../api/client";
import { textoDaVariacao } from "../formato";
import { textoEmReais } from "../Reais";
import type { PontoDeComentario } from "./ponto";
import { grandezaDaMetrica } from "./ponto";

const FUSO = "America/Sao_Paulo";

/** "01/11/2026 10:00", no fuso de São Paulo, qualquer que seja o do navegador. */
export function dataEHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(data);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

export type NumerosDoPonto = { base: string; comparado: string; variacao: string };

const TURNO: Record<PontoDeComentario["turno"], "total" | "almoco" | "jantar"> = { TOTAL: "total", ALMOCO: "almoco", JANTAR: "jantar" };

export function valorEmTexto(grandeza: "vendas" | "clientes" | "ticket", valor: number | null, oculto: boolean): string {
  if (valor === null) return "sem dado";
  if (grandeza === "clientes") return valor.toLocaleString("pt-BR");
  if (oculto) return "R$ ••••";
  return textoEmReais(valor, grandeza === "vendas" ? 0 : 2);
}

/** Os números do ponto (mês ou acumulado) para repetir no cabeçalho da gaveta. Mês sem dado devolve null. */
export function numerosDoPonto(dados: PlanejamentoComparativo, ponto: PontoDeComentario, oculto: boolean): NumerosDoPonto | null {
  const g = grandezaDaMetrica(ponto.metrica);
  const t = TURNO[ponto.turno];
  const fonte = ponto.mes === null ? dados.acumulado : dados.meses.find((m) => m.mes === ponto.mes);
  if (!fonte) return null;
  return {
    base: valorEmTexto(g, fonte.base[g][t], oculto),
    comparado: valorEmTexto(g, fonte.comparado[g][t], oculto),
    variacao: textoDaVariacao(fonte.variacao[g][t])
  };
}
