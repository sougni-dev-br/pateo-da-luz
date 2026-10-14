import { ehCancelada, ehRecebida } from "./agile-situacao.js";
import { toCalendarDateKey } from "../../../shared/utils/calendar-date.js";

// Comanda cancelada e REFEITA: o garçom cancela e abre outra com as mesmas pessoas e quase o mesmo
// valor. O dinheiro reaparece numa venda recebida, então não é perda de venda. A regra é de
// proximidade (dia, pessoas, valor, horário), não de prova: a tela chama de "provável refação".
//
// Os limites foram MEDIDOS, não escolhidos: com os dados reais, contou-se quantas canceladas têm
// um "par" no dia certo e quantas têm um par num dia errado (mesmo dia da semana, +7/-7/+14 dias),
// que só pode ser coincidência. Com 120 min e ±10%, ~73% dos pares também apareciam em dias errados
// (precisão estimada de 27%): a regra inflava a "refação" e escondia perda de verdade. Com 10 min e
// ±2% a coincidência cai para ~29% (precisão estimada de ~71%). Daí os limites abaixo. Ainda há
// coincidência possível, então o funil mostra também o total SEM abater a refação.
export const JANELA_REFACAO_MINUTOS = 10;
export const TOLERANCIA_VALOR_REFACAO = 0.02;

export type VendaParaRefacao = {
  saleId: string;
  movementDate: Date;
  saleStatus: string;
  saleHour: string | null;
  people: number;
  totalAmount: number;
};

function minutosDoDia(hora: string | null): number | null {
  if (!hora) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hora);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Devolve, para cada cancelada que tem par, o id da venda recebida que a refez. Cada recebida
// refaz no máximo uma cancelada. Processa da maior cancelada para a menor, e desempata por id,
// para o resultado não depender da ordem em que as linhas chegam.
export function encontrarRefacoes(vendas: VendaParaRefacao[]): Map<string, string> {
  const recebidasPorGrupo = new Map<string, Array<{ saleId: string; minutos: number; valor: number }>>();
  for (const v of vendas) {
    const minutos = minutosDoDia(v.saleHour);
    if (!ehRecebida(v.saleStatus) || minutos === null || v.people <= 0) continue;
    const chave = `${toCalendarDateKey(v.movementDate)}|${v.people}`;
    const lista = recebidasPorGrupo.get(chave) ?? [];
    lista.push({ saleId: v.saleId, minutos, valor: v.totalAmount });
    recebidasPorGrupo.set(chave, lista);
  }

  const canceladas = vendas
    .filter((v) => ehCancelada(v.saleStatus) && v.people > 0 && v.totalAmount > 0 && minutosDoDia(v.saleHour) !== null)
    .sort((a, b) => b.totalAmount - a.totalAmount || a.saleId.localeCompare(b.saleId));

  const usadas = new Set<string>();
  const pares = new Map<string, string>();
  for (const c of canceladas) {
    const minutosC = minutosDoDia(c.saleHour) as number;
    const candidatas = recebidasPorGrupo.get(`${toCalendarDateKey(c.movementDate)}|${c.people}`) ?? [];
    let melhor: { saleId: string; dMin: number; dValor: number } | null = null;
    for (const r of candidatas) {
      if (usadas.has(r.saleId)) continue;
      const dMin = Math.abs(r.minutos - minutosC);
      const dValor = Math.abs(r.valor - c.totalAmount);
      // Compara em centavos inteiros: 200 * 1.1 em ponto flutuante passa de 220.
      if (dMin > JANELA_REFACAO_MINUTOS || Math.round(dValor * 100) > Math.round(c.totalAmount * TOLERANCIA_VALOR_REFACAO * 100)) continue;
      if (!melhor || dMin < melhor.dMin || (dMin === melhor.dMin && (dValor < melhor.dValor || (dValor === melhor.dValor && r.saleId < melhor.saleId)))) {
        melhor = { saleId: r.saleId, dMin, dValor };
      }
    }
    if (melhor) {
      usadas.add(melhor.saleId);
      pares.set(c.saleId, melhor.saleId);
    }
  }
  return pares;
}
