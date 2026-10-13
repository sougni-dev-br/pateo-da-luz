import { prisma } from "../../../config/database.js";
import { assertPeriodWritableForDate } from "../../cmv-real/cmv-real.service.js";
import { isPeriodLockedError } from "../../cmv-real/period-locked-error.js";

interface ZerarDiasSemVendaArgs {
  sourcePlatform: "NOVENTA_NOVE" | "IFOOD";
  // Prefixo dos ids determinísticos desta loja (ex.: "nnfood-<lojaId>-"). Nunca toca outra origem.
  prefixoId: string;
  year: number;
  month: number;
  // Ids dos lançamentos de dias que TÊM venda faturada, inclusive os que a trava impediu de gravar:
  // um dia travado com venda continua sendo "dia com venda" e não pode ser zerado.
  idsPreservados: string[];
  contexto: string;
}

// Dia que perdeu todas as vendas faturadas é ZERADO, não ignorado (o lançamento antigo sobrevivia com
// o valor inflado). Zerar é uma escrita no razão como qualquer outra, então respeita a trava de
// período: o dia travado é pulado e devolvido em `bloqueados`, o aberto é zerado. Erro que não seja
// trava (banco fora, timeout) sobe, para o passo falhar visivelmente em vez de zerar às cegas.
export async function zerarDiasSemVenda(args: ZerarDiasSemVendaArgs): Promise<{ zerados: number; bloqueados: string[] }> {
  const candidatos = await prisma.revenueEntry.findMany({
    where: {
      sourcePlatform: args.sourcePlatform,
      competenceYear: args.year,
      competenceMonth: args.month,
      status: "ACTIVE",
      id: { startsWith: args.prefixoId, notIn: args.idsPreservados },
      OR: [{ grossAmount: { not: 0 } }, { netAmount: { not: 0 } }, { tickets: { not: 0 } }]
    },
    select: { id: true, date: true }
  });

  const liberados: string[] = [];
  const bloqueados: string[] = [];
  for (const candidato of candidatos) {
    try {
      await assertPeriodWritableForDate(candidato.date, args.contexto);
      liberados.push(candidato.id);
    } catch (error: unknown) {
      if (!isPeriodLockedError(error)) throw error;
      bloqueados.push(candidato.date.toISOString().slice(0, 10));
    }
  }
  if (liberados.length === 0) return { zerados: 0, bloqueados };

  const resultado = await prisma.revenueEntry.updateMany({
    where: {
      id: { in: liberados },
      sourcePlatform: args.sourcePlatform,
      status: "ACTIVE",
      OR: [{ grossAmount: { not: 0 } }, { netAmount: { not: 0 } }, { tickets: { not: 0 } }]
    },
    data: { grossAmount: 0, discounts: 0, platformFees: 0, netAmount: 0, tickets: 0 }
  });
  return { zerados: resultado.count, bloqueados };
}
