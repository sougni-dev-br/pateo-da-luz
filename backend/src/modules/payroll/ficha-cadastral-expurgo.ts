// Prazo de guarda (LGPD), decisões do dono em 04/10/2026: ficha cancelada é apagada 90 dias
// depois do cancelamento; ficha com o link vencido (a pessoa não terminou e ninguém gerou outro
// link), 90 dias depois do vencimento. Saem dados e fotos (os arquivos vão junto, em cascata).
// Ficha concluída fica: é a comprovação do que foi gravado no cadastro. Ficha que a pessoa já
// enviou (FINALIZADA) não vence: espera a conferência do RH.
import crypto from "node:crypto";
import { prisma } from "../../config/database.js";

export const DIAS_GUARDA = 90;
const DIA_MS = 24 * 60 * 60 * 1000;
const LOTE = 100;
const PRIMEIRA_RODADA_MS = 5 * 60 * 1000; // depois do boot, sem disputar a subida do servidor
const INTERVALO_MS = DIA_MS;

/**
 * Um lote, tudo ou nada: apaga (devolvendo o que saiu de fato), tira da auditoria antiga o que
 * identificava a pessoa (nome, motivo da devolução, IP, aparelho) e registra o expurgo só com
 * ids e contagens. Se o registro falhar, nada é apagado.
 */
async function expurgarLote(limite: Date): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // A condição está no próprio DELETE: ficha renovada (novo link, devolução) não sai.
    const apagadas = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      DELETE FROM "FichaCadastral" WHERE id IN (
        SELECT id FROM "FichaCadastral"
        WHERE (status = 'CANCELADA' AND "canceladaEm" < ${limite})
           OR (status IN ('ENVIADA', 'PREENCHENDO') AND "expiraEm" < ${limite})
        ORDER BY id LIMIT ${LOTE}
      )
      RETURNING id, status::text AS status`;
    if (apagadas.length === 0) return 0;
    const ids = apagadas.map((f) => f.id);
    await tx.$executeRaw`
      UPDATE "AuditLog"
      SET "previousValue" = NULL, "newValue" = '{"apagadoPeloExpurgo": true}'::jsonb, "ipAddress" = NULL, "userAgent" = NULL
      WHERE ("entity" = 'FichaCadastral' AND "entityId" = ANY(${ids}))
         OR ("entity" = 'FichaCadastralArquivo' AND "newValue"->>'fichaId' = ANY(${ids}))`;
    const registro = {
      apagadas: ids.length, ids,
      canceladas: apagadas.filter((f) => f.status === "CANCELADA").length,
      vencidas: apagadas.filter((f) => f.status !== "CANCELADA").length,
      prazoDias: DIAS_GUARDA, antesDe: limite.toISOString(),
    };
    await tx.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entity", "newValue")
      VALUES (${crypto.randomUUID()}, 'FICHA_CADASTRAL_EXPURGO', 'FichaCadastral', CAST(${JSON.stringify(registro)} AS jsonb))`;
    return ids.length;
  });
}

/** Apaga as canceladas e as vencidas há mais de 90 dias, em lotes. Devolve quantas saíram. */
export async function expurgarFichas(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_GUARDA * DIA_MS);
  let total = 0;
  for (;;) {
    const n = await expurgarLote(limite);
    total += n;
    if (n < LOTE) return total;
  }
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
