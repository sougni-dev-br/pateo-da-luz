// Prazo de guarda (LGPD): ficha cancelada é apagada 90 dias depois do cancelamento — dados e
// fotos dos documentos (os arquivos saem junto, em cascata). Decisão do dono em 04/10/2026.
// Ficha concluída fica: é a comprovação do que foi gravado no cadastro.
import { prisma } from "../../config/database.js";
import { auditLog } from "../security/security-utils.js";

export const DIAS_GUARDA_CANCELADA = 90;
const DIA_MS = 24 * 60 * 60 * 1000;
const PRIMEIRA_RODADA_MS = 5 * 60 * 1000; // depois do boot, sem disputar a subida do servidor
const INTERVALO_MS = DIA_MS;

/** Apaga as canceladas há mais de 90 dias. Devolve quantas saíram. */
export async function expurgarFichasCanceladas(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_GUARDA_CANCELADA * DIA_MS);
  const vencidas = await prisma.fichaCadastral.findMany({
    where: { status: "CANCELADA", canceladaEm: { lt: limite } },
    select: { id: true },
  });
  if (vencidas.length === 0) return 0;
  const ids = vencidas.map((f) => f.id);
  // A condição se repete no delete: ficha que mudou entre a leitura e aqui não sai.
  const { count } = await prisma.fichaCadastral.deleteMany({ where: { id: { in: ids }, status: "CANCELADA", canceladaEm: { lt: limite } } });
  // Só os ids e o prazo: o registro do expurgo não pode guardar o dado que foi apagado.
  await auditLog({
    action: "FICHA_CADASTRAL_EXPURGO", entity: "FichaCadastral",
    newValue: { apagadas: count, ids, prazoDias: DIAS_GUARDA_CANCELADA, canceladasAntesDe: limite.toISOString() },
  });
  return count;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function agendar(atraso: number): void {
  timer = setTimeout(() => {
    expurgarFichasCanceladas()
      .then((n) => { if (n > 0) console.info(`[ficha-expurgo] ${n} ficha(s) cancelada(s) há mais de ${DIAS_GUARDA_CANCELADA} dias apagada(s).`); })
      .catch((error) => console.error("[ficha-expurgo] falhou:", error instanceof Error ? error.message : error))
      .finally(() => agendar(INTERVALO_MS));
  }, atraso);
  // Não segura o processo vivo só por causa deste timer (o app.listen segura).
  timer.unref?.();
}

/** Chamado no boot (server.ts): primeira rodada em 5 min, depois uma por dia. */
export function iniciarExpurgoFichas(): void {
  if (timer) return;
  agendar(PRIMEIRA_RODADA_MS);
}
