import { sendText, type SendResult as BaileysSendResult } from "./baileys.service.js";

// Fachada sobre o Baileys embarcado no backend.
// Antes essa camada falava HTTP com o OpenWA — agora só delega para o
// serviço Baileys local. Mantém a mesma assinatura pública que o resto
// do backend (daily-summary.service, notifications.routes) já espera.
//
// Variáveis de ambiente relevantes:
//   WHATSAPP_TO           — destino default (usado pelo cron do resumo)
//   WHATSAPP_SESSION_NAME — nome lógico da sessão (default "pateo")

type SendResult =
  | { ok: true; skipped?: false; messageId?: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

function fromBaileys(result: BaileysSendResult): SendResult {
  if (result.ok) return { ok: true, messageId: result.messageId };
  if (result.skipped) return { ok: false, skipped: true, reason: result.reason };
  return { ok: false, error: result.reason };
}

export async function sendWhatsAppText(to: string, text: string): Promise<SendResult> {
  if (!to || !to.trim()) {
    const reason = "WHATSAPP_TO vazio — mensagem não enviada";
    console.warn(`[whatsapp] ${reason}`);
    return { ok: false, skipped: true, reason };
  }
  return fromBaileys(await sendText(to, text));
}
