import type { PlanejamentoComentario, PlanejamentoComentarioMetrica, PlanejamentoComentarioTurno, PlanejamentoTurnos } from "../../../api/client";
import { NOMES_DOS_MESES_CURTOS } from "../formato";
import type { GrandezaDoQuadro } from "../TabelaMensal";

// Lógica pura dos comentários: um "ponto" é mês (null = ano inteiro) + métrica + turno, dentro do ano comparado.

export type PontoDeComentario = {
  mes: number | null;
  metrica: PlanejamentoComentarioMetrica;
  turno: PlanejamentoComentarioTurno;
};

type TurnoDaTela = keyof PlanejamentoTurnos;

const METRICA_DA_GRANDEZA: Record<GrandezaDoQuadro, PlanejamentoComentarioMetrica> = { vendas: "VENDAS", clientes: "CLIENTES", ticket: "TICKET" };
const TURNO_DA_TELA: Record<TurnoDaTela, PlanejamentoComentarioTurno> = { total: "TOTAL", almoco: "ALMOCO", jantar: "JANTAR" };

export const ROTULO_DA_METRICA: Record<PlanejamentoComentarioMetrica, string> = { VENDAS: "Vendas", CLIENTES: "Clientes", TICKET: "Ticket médio" };
export const ROTULO_DO_TURNO: Record<PlanejamentoComentarioTurno, string> = { TOTAL: "total", ALMOCO: "almoço", JANTAR: "jantar" };

export const metricaDaGrandeza = (g: GrandezaDoQuadro): PlanejamentoComentarioMetrica => METRICA_DA_GRANDEZA[g];
export const turnoDaTela = (t: TurnoDaTela): PlanejamentoComentarioTurno => TURNO_DA_TELA[t];

export function grandezaDaMetrica(m: PlanejamentoComentarioMetrica): GrandezaDoQuadro {
  return m === "VENDAS" ? "vendas" : m === "CLIENTES" ? "clientes" : "ticket";
}

export const pontoDoComentario = (c: PlanejamentoComentario): PontoDeComentario => ({ mes: c.mes, metrica: c.metrica, turno: c.turno });

export const chaveDoPonto = (p: PontoDeComentario): string => `${p.mes ?? 0}|${p.metrica}|${p.turno}`;

/** Agrupa mantendo a ordem de chegada (o servidor já ordena mês, métrica, turno, criação). */
export function agruparPorPonto(comentarios: readonly PlanejamentoComentario[]): ReadonlyMap<string, readonly PlanejamentoComentario[]> {
  const mapa = new Map<string, PlanejamentoComentario[]>();
  for (const c of comentarios) {
    const chave = chaveDoPonto(pontoDoComentario(c));
    mapa.set(chave, [...(mapa.get(chave) ?? []), c]);
  }
  return mapa;
}

/** "Out/2026 · Vendas · almoço"; o turno total não aparece. "Ano inteiro · Ticket médio". */
export function rotuloDoPonto(p: PontoDeComentario, anoComparado: number): string {
  const quando = p.mes === null ? "Ano inteiro" : `${NOMES_DOS_MESES_CURTOS[p.mes - 1]}/${anoComparado}`;
  const partes = [quando, ROTULO_DA_METRICA[p.metrica]];
  if (p.turno !== "TOTAL") partes.push(ROTULO_DO_TURNO[p.turno]);
  return partes.join(" · ");
}

/** Mês curto sem ano, para a lista de "outros pontos": "Out · Vendas". */
export function rotuloCurtoDoPonto(p: PontoDeComentario): string {
  const quando = p.mes === null ? "Ano" : NOMES_DOS_MESES_CURTOS[p.mes - 1];
  const partes = [quando, ROTULO_DA_METRICA[p.metrica]];
  if (p.turno !== "TOTAL") partes.push(ROTULO_DO_TURNO[p.turno]);
  return partes.join(" · ");
}

export type PontoComContagem = { ponto: PontoDeComentario; quantidade: number };

/** Os comentários do ano inteiro (na íntegra) e os demais pontos com a contagem de cada um. */
export function contagemDoAno(comentarios: readonly PlanejamentoComentario[]): { anoInteiro: readonly PlanejamentoComentario[]; outros: readonly PontoComContagem[] } {
  const anoInteiro = comentarios.filter((c) => c.mes === null);
  const outros: PontoComContagem[] = [];
  for (const lista of agruparPorPonto(comentarios.filter((c) => c.mes !== null)).values()) {
    outros.push({ ponto: pontoDoComentario(lista[0]), quantidade: lista.length });
  }
  return { anoInteiro, outros };
}

export const textoDaContagem = (n: number): string => `${n} ${n === 1 ? "comentário" : "comentários"}`;
