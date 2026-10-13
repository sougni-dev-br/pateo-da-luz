import { prisma } from "../../config/database.js";
import { sendWhatsAppText } from "../notifications/whatsapp.service.js";
import { listActivePhones } from "../notifications/recipients.service.js";
import { INCLUDE_DO_ITEM, linhaDoResumo, nomesDosSetores } from "./waste.service.js";
import { resumirDesperdicio } from "./waste.js";
import { decidirAlerta, mensagemDoAlerta } from "./waste-alert.js";

const SINGLETON = "singleton";
const dateOnly = (dia: string) => new Date(`${dia}T00:00:00.000Z`);
const diaDe = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Avisa por WhatsApp quando o desperdício do dia chega ao limite. Chamado depois de cada
 * lançamento, sem esperar: falha de envio nunca pode derrubar o registro de quem lançou.
 *
 * O dia é "reservado" antes do envio, com um update condicional: dois lançamentos simultâneos
 * não mandam duas mensagens. Se ninguém recebeu (WhatsApp fora do ar, sem destinatário), a
 * reserva é devolvida e o próximo lançamento tenta de novo.
 */
export async function avisarSePassouDoLimite(dia: string, hoje: string): Promise<"ENVIADO" | "NAO_PRECISA" | "SEM_DESTINATARIO"> {
  const config = await prisma.wasteSettings.findUnique({ where: { id: SINGLETON } });
  const limite = config?.dailyAlertValue == null ? null : Number(config.dailyAlertValue);
  const ultimoAlerta = diaDe(config?.lastAlertDay ?? null);
  // Sem limite, ou já avisado hoje: não relê o dia inteiro a cada lançamento só para concluir que não precisa.
  if (limite == null || (dia === hoje && ultimoAlerta === hoje)) return "NAO_PRECISA";

  const entradas = await prisma.wasteEntry.findMany({ where: { occurredOn: dateOnly(dia), cancelledAt: null }, include: INCLUDE_DO_ITEM });
  const setores = await nomesDosSetores(entradas.map((e) => e.sectorId));
  const resumo = resumirDesperdicio(entradas.map((e) => linhaDoResumo(e, setores, true)));

  if (!decidirAlerta({ limite, totalDoDia: resumo.total.valor, diaDoLancamento: dia, hoje, ultimoAlerta })) return "NAO_PRECISA";

  const reserva = await prisma.wasteSettings.updateMany({
    where: { id: SINGLETON, OR: [{ lastAlertDay: null }, { lastAlertDay: { not: dateOnly(hoje) } }] },
    data: { lastAlertDay: dateOnly(hoje) },
  });
  if (reserva.count === 0) return "NAO_PRECISA";

  // Da reserva em diante, qualquer falha (banco, envio) devolve o dia: sem isso o aviso se perderia
  // em silêncio e nenhum lançamento seguinte tentaria de novo.
  const devolverReserva = () =>
    prisma.wasteSettings.updateMany({ where: { id: SINGLETON, lastAlertDay: dateOnly(hoje) }, data: { lastAlertDay: config?.lastAlertDay ?? null } });

  try {
    const texto = mensagemDoAlerta({
      total: resumo.total.valor,
      limite,
      lancamentos: resumo.total.lancamentos,
      principalMotivo: resumo.porMotivo[0]?.valor ? resumo.porMotivo[0].nome : null,
    });
    const destinatarios = await listActivePhones();
    const envios = await Promise.all(destinatarios.map(async (d) => {
      try {
        const resultado = await sendWhatsAppText(d.phone, texto);
        if (!resultado.ok) console.warn(`[desperdicio] aviso não enviado a ${d.name}: ${"reason" in resultado ? resultado.reason : "error" in resultado ? resultado.error : "falha desconhecida"}`);
        return resultado;
      } catch (falha) {
        console.warn(`[desperdicio] aviso não enviado a ${d.name}:`, falha instanceof Error ? falha.message : falha);
        return { ok: false as const };
      }
    }));

    if (!envios.some((e) => e.ok)) {
      await devolverReserva();
      return "SEM_DESTINATARIO";
    }
    return "ENVIADO";
  } catch (falha) {
    // Se nem a devolução funcionar, o dia fica marcado como avisado sem aviso: isso precisa aparecer no log.
    await devolverReserva().catch((erroDaDevolucao) => console.error("[desperdicio] não consegui devolver a reserva do aviso do dia:", erroDaDevolucao instanceof Error ? erroDaDevolucao.message : erroDaDevolucao));
    throw falha;
  }
}
