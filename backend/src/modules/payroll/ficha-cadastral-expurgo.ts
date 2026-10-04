// Prazo de guarda (LGPD), decisões do dono em 04/10/2026: ficha cancelada é apagada 90 dias
// depois do cancelamento; ficha com o link vencido (a pessoa não terminou e ninguém gerou outro
// link), 90 dias depois do vencimento. Saem dados e fotos (os arquivos vão junto, em cascata).
// Ficha concluída fica: é a comprovação do que foi gravado no cadastro. Ficha que a pessoa já
// enviou (FINALIZADA) não vence: espera a conferência do RH.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog } from "../security/security-utils.js";

export const DIAS_GUARDA = 90;
const DIA_MS = 24 * 60 * 60 * 1000;
const PRIMEIRA_RODADA_MS = 5 * 60 * 1000; // depois do boot, sem disputar a subida do servidor
const INTERVALO_MS = DIA_MS;

function vencidasHaMaisDe(limite: Date): Prisma.FichaCadastralWhereInput {
  return {
    OR: [
      { status: "CANCELADA", canceladaEm: { lt: limite } },
      // "Gerar novo link" e "Devolver" renovam o expiraEm: ficha em uso não cai aqui.
      { status: { in: ["ENVIADA", "PREENCHENDO"] }, expiraEm: { lt: limite } },
    ],
  };
}

/** Apaga as canceladas e as vencidas há mais de 90 dias. Devolve quantas saíram. */
export async function expurgarFichas(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_GUARDA * DIA_MS);
  const alvo = await prisma.fichaCadastral.findMany({ where: vencidasHaMaisDe(limite), select: { id: true, status: true } });
  if (alvo.length === 0) return 0;
  const ids = alvo.map((f) => f.id);
  // A condição se repete no delete: ficha que mudou entre a leitura e aqui (novo link) não sai.
  const { count } = await prisma.fichaCadastral.deleteMany({ where: { id: { in: ids }, ...vencidasHaMaisDe(limite) } });
  // Só ids, motivo e prazo: o registro do expurgo não pode guardar o dado que foi apagado.
  await auditLog({
    action: "FICHA_CADASTRAL_EXPURGO", entity: "FichaCadastral",
    newValue: {
      apagadas: count, ids,
      canceladas: alvo.filter((f) => f.status === "CANCELADA").length,
      vencidas: alvo.filter((f) => f.status !== "CANCELADA").length,
      prazoDias: DIAS_GUARDA, antesDe: limite.toISOString(),
    },
  });
  return count;
}

let timer: ReturnType<typeof setTimeout> | null = null;

function agendar(atraso: number): void {
  timer = setTimeout(() => {
    expurgarFichas()
      .then((n) => { if (n > 0) console.info(`[ficha-expurgo] ${n} ficha(s) cancelada(s) ou vencida(s) há mais de ${DIAS_GUARDA} dias apagada(s).`); })
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
