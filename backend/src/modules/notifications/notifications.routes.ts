import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/database.js";
import { forceLogout, getQrDataUrl, getStatus, initBaileys } from "./baileys.service.js";
import { buildDailySummary } from "./daily-summary.service.js";
import {
  createRecipient,
  createRecipientSchema,
  deleteRecipient,
  listActivePhones,
  listRecipients,
  updateRecipient,
  updateRecipientSchema
} from "./recipients.service.js";
import { sendWhatsAppText } from "./whatsapp.service.js";

// Robustez do trigger — 3 camadas de proteção contra perda de envio:
// (1) RETRY: se Baileys não está open, aguarda até MAX_WAIT_MS até conectar.
// (2) IDEMPOTÊNCIA: cada (date, recipientId) só recebe UM envio bem-sucedido
//     por dia. Registro em DailySummarySent. Se o cron dispara 2x no mesmo
//     dia, o 2º pula quem já foi enviado.
// (3) O 3º disparo redundante do cron externo (22:00 + 22:15) mora fora
//     do código — é configuração do cron-job.org.
//
// MAX_WAIT_MS calibrado para caber no timeout do cron-job.org tier free
// (30s). Deixa ~5-8s de folga para build de summary + envio + rede.
const MAX_WAIT_MS = 20_000;
const POLL_INTERVAL_MS = 3_000;

async function waitForBaileysOpen(): Promise<{ ok: true } | { ok: false; status: string; waitedMs: number }> {
  const start = Date.now();
  let last = getStatus().status;
  while (Date.now() - start < MAX_WAIT_MS) {
    if (last === "open") return { ok: true };
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    last = getStatus().status;
  }
  if (last === "open") return { ok: true };
  return { ok: false, status: last, waitedMs: Date.now() - start };
}

// Este módulo expõe dois grupos de rotas:
//
//   1. notificationsPublicRouter — chamada por cron externo (cron-job.org),
//      autenticada por token no header X-Daily-Summary-Token.
//        POST /notifications/daily-summary/trigger
//
//   2. notificationsAdminRouter — usada pela UI do ERP, autenticada por
//      sessão + menuId='notifications' via requireMenuAccess.
//        GET/POST/PATCH/DELETE  /notifications/whatsapp/recipients[/:id]
//        GET   /notifications/whatsapp/status
//        GET   /notifications/whatsapp/qr
//        POST  /notifications/whatsapp/restart
//        POST  /notifications/whatsapp/test-send   (envia msg avulsa pro CRUD)
//
// Ambos são montados no app.ts em pontos diferentes (público antes do
// requireMenuAccess global, admin depois).

// ─── Public: trigger via cron ─────────────────────────────────────────────

export const notificationsPublicRouter = Router();

const triggerSchema = z.object({
  // Opcional: forçar uma data específica (YYYY-MM-DD). Default = hoje em SP.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Opcional: se true, retorna o texto no response body mas NÃO envia.
  dryRun: z.boolean().optional()
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireToken(request: import("express").Request, response: import("express").Response): boolean {
  const expected = process.env.DAILY_SUMMARY_TOKEN?.trim();
  if (!expected) {
    response.status(503).json({ message: "DAILY_SUMMARY_TOKEN não configurado. Rotas desabilitadas." });
    return false;
  }
  const provided = String(request.header("x-daily-summary-token") || "").trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    response.status(401).json({ message: "Token inválido." });
    return false;
  }
  return true;
}

notificationsPublicRouter.post("/daily-summary/trigger", async (request, response) => {
  if (!requireToken(request, response)) return;

  const parsed = triggerSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return response.status(400).json({
      message: "Payload inválido.",
      issues: parsed.error.flatten()
    });
  }

  const { date, dryRun } = parsed.data;

  try {
    const summary = await buildDailySummary(date);

    if (dryRun) {
      return response.json({
        ok: true,
        dryRun: true,
        date: summary.date,
        text: summary.text
      });
    }

    // Fonte primária de destinatários: tabela WhatsAppRecipient (ativos).
    // Se estiver vazia, cai no fallback WHATSAPP_TO do .env — comportamento
    // do piloto antes da UI de destinatários.
    const recipients = await listActivePhones();
    const fallback = process.env.WHATSAPP_TO?.trim();

    if (recipients.length === 0 && !fallback) {
      return response.status(503).json({
        message: "Nenhum destinatário cadastrado nem WHATSAPP_TO configurado — resumo gerado mas não enviado.",
        date: summary.date,
        text: summary.text
      });
    }

    const targets =
      recipients.length > 0
        ? recipients.map((r) => ({ id: r.id, name: r.name, phone: r.phone }))
        : [{ id: "env", name: "WHATSAPP_TO", phone: fallback! }];

    // Camada 2 — Idempotência: checa quem já recebeu hoje ANTES de gastar
    // recursos aguardando conexão. Se todo mundo já recebeu, retorna 200
    // imediatamente (cron pode chamar quantas vezes quiser).
    const alreadySentRows = await prisma.dailySummarySent.findMany({
      where: {
        date: summary.date,
        recipientId: { in: targets.map((t) => t.id) }
      },
      select: { recipientId: true, messageId: true }
    });
    const alreadySentMap = new Map(alreadySentRows.map((r) => [r.recipientId, r.messageId]));
    const pending = targets.filter((t) => !alreadySentMap.has(t.id));

    if (pending.length === 0) {
      return response.json({
        ok: true,
        date: summary.date,
        totalRecipients: targets.length,
        sent: 0,
        failed: 0,
        alreadySent: targets.length,
        results: targets.map((t) => ({
          recipientId: t.id,
          name: t.name,
          ok: true,
          alreadySent: true,
          messageId: alreadySentMap.get(t.id) ?? null
        }))
      });
    }

    // Camada 1 — Retry: aguarda Baileys ficar open (até 60s). Só entra
    // no wait se ainda tem alguém pendente pra enviar.
    const wait = await waitForBaileysOpen();
    if (!wait.ok) {
      return response.status(503).json({
        ok: false,
        date: summary.date,
        totalRecipients: targets.length,
        sent: 0,
        pending: pending.length,
        alreadySent: targets.length - pending.length,
        message: `WhatsApp não conectou em ${Math.round(wait.waitedMs / 1000)}s (status=${wait.status}). Tentativa registrada; próximo cron pode reenviar.`
      });
    }

    // Envio SEQUENCIAL — WhatsApp anti-spam prefere ritmo humano.
    // Uma falha isolada não bloqueia os outros; agregamos tudo no response.
    const results: Array<{
      recipientId: string;
      name: string;
      ok: boolean;
      alreadySent?: boolean;
      messageId?: string | null;
      error?: string;
    }> = [];

    // Adiciona pré-computados como "alreadySent".
    for (const t of targets) {
      if (alreadySentMap.has(t.id)) {
        results.push({
          recipientId: t.id,
          name: t.name,
          ok: true,
          alreadySent: true,
          messageId: alreadySentMap.get(t.id) ?? null
        });
      }
    }

    for (const t of pending) {
      const send = await sendWhatsAppText(t.phone, summary.text);
      if (send.ok) {
        results.push({ recipientId: t.id, name: t.name, ok: true, messageId: send.messageId ?? null });
        // Grava a idempotência DEPOIS do envio bem-sucedido. Se der crash
        // aqui, o pior caso é reenviar no próximo trigger — nunca duplica
        // dentro da mesma chamada.
        await prisma.dailySummarySent
          .create({
            data: {
              date: summary.date,
              recipientId: t.id,
              recipientName: t.name,
              phone: t.phone,
              messageId: send.messageId ?? null
            }
          })
          .catch((error) => {
            // Race: outro processo pode ter gravado nesse meio-tempo (unique
            // constraint viola). Não é problema — significa idempotência OK.
            console.warn(`[daily-summary] gravação de idempotência falhou (race?): ${error?.message}`);
          });
      } else {
        const err = "skipped" in send && send.skipped ? send.reason : send.error;
        results.push({ recipientId: t.id, name: t.name, ok: false, error: err });
      }
    }

    const sentNow = results.filter((r) => r.ok && !r.alreadySent).length;
    const alreadySent = results.filter((r) => r.alreadySent).length;
    const failed = results.filter((r) => !r.ok).length;
    const httpStatus = failed === 0 ? 200 : sentNow + alreadySent === 0 ? 502 : 207;

    return response.status(httpStatus).json({
      ok: failed === 0,
      date: summary.date,
      totalRecipients: targets.length,
      sent: sentNow,
      alreadySent,
      failed,
      results
    });
  } catch (error) {
    console.error("[daily-summary] falha ao gerar/enviar", error);
    const message = error instanceof Error ? error.message : "Erro interno.";
    return response.status(500).json({ ok: false, message });
  }
});

// ─── Admin: CRUD + WhatsApp session (behind session auth) ─────────────────

export const notificationsAdminRouter = Router();
// O middleware global requireMenuAccess (em app.ts, DEPOIS deste router)
// resolve menuId='notifications' para paths /notifications/whatsapp/* e
// gate por permissão. Não precisamos repetir aqui — se puséssemos, rodaria
// duas vezes por request.

// ── Destinatários ─────────────────────────────────────────────────────────

notificationsAdminRouter.get("/whatsapp/recipients", async (_request, response) => {
  const recipients = await listRecipients();
  response.json({ recipients });
});

notificationsAdminRouter.post("/whatsapp/recipients", async (request, response) => {
  const parsed = createRecipientSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return response.status(400).json({
      message: "Dados inválidos.",
      issues: parsed.error.flatten()
    });
  }
  const created = await createRecipient(parsed.data);
  response.status(201).json({ recipient: created });
});

notificationsAdminRouter.patch("/whatsapp/recipients/:id", async (request, response) => {
  const parsed = updateRecipientSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return response.status(400).json({
      message: "Dados inválidos.",
      issues: parsed.error.flatten()
    });
  }
  const updated = await updateRecipient(request.params.id, parsed.data);
  if (!updated) return response.status(404).json({ message: "Destinatário não encontrado." });
  response.json({ recipient: updated });
});

notificationsAdminRouter.delete("/whatsapp/recipients/:id", async (request, response) => {
  const deleted = await deleteRecipient(request.params.id);
  if (!deleted) return response.status(404).json({ message: "Destinatário não encontrado." });
  response.status(204).send();
});

// ── WhatsApp session (Baileys) ────────────────────────────────────────────

notificationsAdminRouter.get("/whatsapp/status", (_request, response) => {
  response.json(getStatus());
});

notificationsAdminRouter.get("/whatsapp/qr", async (request, response) => {
  const dataUrl = await getQrDataUrl();
  if (!dataUrl) {
    return response.status(404).json({
      message: "Nenhum QR ativo agora.",
      status: getStatus()
    });
  }
  if (request.query.format === "html") {
    response.type("html").send(
      `<!doctype html><html><head><meta charset="utf-8"><title>WhatsApp QR — Pateo</title>
<style>body{margin:0;padding:40px;background:#111;color:#eee;font-family:system-ui;text-align:center}
img{background:#fff;padding:16px;border-radius:12px}h1{font-size:18px;font-weight:500}
p{color:#aaa;font-size:13px;max-width:360px;margin:16px auto}</style></head>
<body><h1>Escaneie no WhatsApp do restaurante</h1>
<img src="${dataUrl}" alt="QR"/>
<p>Aparelhos conectados → Conectar um aparelho.</p>
</body></html>`
    );
    return;
  }
  response.json({ dataUrl, status: getStatus() });
});

notificationsAdminRouter.post("/whatsapp/restart", async (_request, response) => {
  await initBaileys().catch((error) => console.error("[whatsapp] restart falhou", error));
  response.json({ ok: true, status: getStatus() });
});

// Logout — desliga o dispositivo atual do WhatsApp e força QR novo.
// Usado quando o admin quer trocar de aparelho ou re-parear. AÇÃO
// DESTRUTIVA: até o próximo scan, mensagens do resumo diário não são
// enviadas. O front confirma antes de chamar.
notificationsAdminRouter.post("/whatsapp/logout", async (_request, response) => {
  try {
    await forceLogout();
    response.json({ ok: true, status: getStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao desconectar.";
    console.error("[whatsapp] logout falhou", error);
    response.status(500).json({ ok: false, message });
  }
});

// Envio avulso de teste — a UI usa isso pra validar que o canal está vivo
// antes de esperar 23h. Corpo: { recipientId?, phone?, text? }.
// Se recipientId → busca o phone; senão usa phone direto. text default =
// "Teste — Pateo da Luz — <hora atual SP>".
const testSendSchema = z.object({
  recipientId: z.string().optional(),
  phone: z.string().optional(),
  text: z.string().max(4000).optional()
});

notificationsAdminRouter.post("/whatsapp/test-send", async (request, response) => {
  const parsed = testSendSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return response.status(400).json({ message: "Payload inválido." });
  }
  const { recipientId, phone: rawPhone, text } = parsed.data;

  let targetPhone: string | null = rawPhone?.replace(/\D/g, "") || null;
  let targetName = "avulso";
  if (recipientId) {
    const list = await listRecipients();
    const found = list.find((r) => r.id === recipientId);
    if (!found) return response.status(404).json({ message: "Destinatário não encontrado." });
    targetPhone = found.phone;
    targetName = found.name;
  }
  if (!targetPhone) {
    return response.status(400).json({ message: "Informe recipientId ou phone." });
  }

  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const message =
    text?.trim() ||
    `_*Pateo da Luz — teste de canal*_\nCanal WhatsApp ativo. ${now}`;

  const result = await sendWhatsAppText(targetPhone, message);
  if (!result.ok) {
    const detail = "skipped" in result && result.skipped ? result.reason : result.error;
    return response.status(502).json({ ok: false, name: targetName, error: detail });
  }
  response.json({ ok: true, name: targetName, messageId: result.messageId ?? null });
});
