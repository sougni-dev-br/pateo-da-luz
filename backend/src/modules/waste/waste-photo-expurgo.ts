// Prazo de guarda das fotos de desperdício: 90 dias (mesmo prazo das fichas cadastrais). O
// lançamento fica; só a imagem sai, para o banco não crescer com fotos. Uma rodada por dia.
import { prisma } from "../../config/database.js";
import { FOTO_DIAS_DE_GUARDA } from "./waste-photo.js";

const DIA_MS = 24 * 60 * 60 * 1000;
const PRIMEIRA_RODADA_MS = 10 * 60 * 1000; // depois do boot, sem disputar a subida do servidor

/** Apaga as fotos com mais de 90 dias. Devolve quantas saíram. */
export async function expurgarFotosDeDesperdicio(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - FOTO_DIAS_DE_GUARDA * DIA_MS);
  const { count } = await prisma.wasteEntryPhoto.deleteMany({ where: { createdAt: { lt: limite } } });
  return count;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function agendar(atraso: number): void {
  timer = setTimeout(() => {
    expurgarFotosDeDesperdicio()
      // Loga também quando não havia nada: sem isso não dá para distinguir "rodou e não achou" de "nunca rodou".
      .then((n) => console.info(`[desperdicio-fotos] expurgo diário: ${n} foto(s) com mais de ${FOTO_DIAS_DE_GUARDA} dias apagada(s).`))
      .catch((erro) => console.error("[desperdicio-fotos] expurgo falhou:", erro instanceof Error ? (erro.stack ?? erro.message) : erro))
      .finally(() => agendar(DIA_MS));
  }, atraso);
  // Não segura o processo vivo só por causa deste timer (o app.listen segura).
  timer.unref?.();
}

/** Chamado no boot (server.ts). */
export function iniciarExpurgoFotosDeDesperdicio(): void {
  if (timer) return;
  agendar(PRIMEIRA_RODADA_MS);
}
