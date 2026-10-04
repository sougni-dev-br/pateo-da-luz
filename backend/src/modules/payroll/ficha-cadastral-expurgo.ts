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
/** Devolve quantas foram escolhidas (decide se há outro lote) e quantas saíram de fato. */
async function expurgarLote(limite: Date): Promise<{ lote: number; apagadas: number }> {
  return prisma.$transaction(async (tx) => {
    // Escolhe o lote travando as linhas; outra instância rodando ao mesmo tempo pula estas.
    const escolhidas = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "FichaCadastral"
      WHERE (status = 'CANCELADA' AND "canceladaEm" < ${limite})
         OR (status IN ('ENVIADA', 'PREENCHENDO') AND "expiraEm" < ${limite})
      ORDER BY id LIMIT ${LOTE}
      FOR UPDATE SKIP LOCKED`;
    if (escolhidas.length === 0) return { lote: 0, apagadas: 0 };
    // Os arquivos somem na cascata: os ids saem antes, para limpar a auditoria pelo índice.
    const arquivos = await tx.$queryRaw<Array<{ id: string; fichaId: string }>>`
      SELECT id, "fichaId" FROM "FichaCadastralArquivo" WHERE "fichaId" = ANY(${escolhidas.map((f) => f.id)})`;
    // A condição se repete: ficha renovada (novo link, devolução) entre a escolha e aqui não sai.
    const apagadas = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      DELETE FROM "FichaCadastral"
      WHERE id = ANY(${escolhidas.map((f) => f.id)})
        AND ((status = 'CANCELADA' AND "canceladaEm" < ${limite})
          OR (status IN ('ENVIADA', 'PREENCHENDO') AND "expiraEm" < ${limite}))
      RETURNING id, status::text AS status`;
    if (apagadas.length === 0) return { lote: escolhidas.length, apagadas: 0 };
    const ids = apagadas.map((f) => f.id);
    const idsArquivos = arquivos.filter((a) => ids.includes(a.fichaId)).map((a) => a.id);
    await tx.$executeRaw`
      UPDATE "AuditLog"
      SET "previousValue" = NULL, "newValue" = '{"apagadoPeloExpurgo": true}'::jsonb, "ipAddress" = NULL, "userAgent" = NULL
      WHERE ("entity" = 'FichaCadastral' AND "entityId" = ANY(${ids}))
         OR ("entity" = 'FichaCadastralArquivo' AND "entityId" = ANY(${idsArquivos}))`;
    const registro = {
      apagadas: ids.length, ids,
      canceladas: apagadas.filter((f) => f.status === "CANCELADA").length,
      vencidas: apagadas.filter((f) => f.status !== "CANCELADA").length,
      prazoDias: DIAS_GUARDA, antesDe: limite.toISOString(),
    };
    await tx.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "entity", "newValue")
      VALUES (${crypto.randomUUID()}, 'FICHA_CADASTRAL_EXPURGO', 'FichaCadastral', CAST(${JSON.stringify(registro)} AS jsonb))`;
    return { lote: escolhidas.length, apagadas: ids.length };
    // Lote com muitas fotos passa dos 5 s padrão: a transação seria desfeita todo dia.
  }, { timeout: 120_000, maxWait: 10_000 });
}

/** Apaga as canceladas e as vencidas há mais de 90 dias, em lotes. Devolve quantas saíram. */
export async function expurgarFichas(agora = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_GUARDA * DIA_MS);
  let total = 0;
  for (;;) {
    const { lote, apagadas } = await expurgarLote(limite);
    total += apagadas;
    if (lote < LOTE) return total;
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
