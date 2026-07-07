import { logger } from "./logger.js";

// Cliente do backend Render. Autentica via header X-Agile-Token.
// Faz retry em falhas de rede/5xx; NÃO retenta em 4xx (payload inválido
// não vai passar mesmo se tentar de novo).

const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);

export class BackendClient {
  constructor({ baseUrl, ingestToken, retryMaxAttempts = 4, retryDelayMs = 900000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.ingestToken = ingestToken;
    this.retryMaxAttempts = retryMaxAttempts;
    this.retryDelayMs = retryDelayMs;
  }

  async sync(payload) {
    const url = `${this.baseUrl}/integrations/agile/sync`;
    let lastError = null;
    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt += 1) {
      try {
        logger.info(`Backend: enviando sync (tentativa ${attempt}/${this.retryMaxAttempts})`, {
          periodoInicio: payload.periodoInicio,
          periodoFim: payload.periodoFim,
          vendas: payload.vendas.length,
          pagamentos: payload.pagamentos.length,
          itens: payload.itens.length
        });
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
        let response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Agile-Token": this.ingestToken
            },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }

        const text = await response.text();
        if (response.ok) {
          const report = JSON.parse(text);
          logger.info("Backend: sync OK", {
            batchId: report.batchId,
            diasImportados: report.diasImportados,
            totalBruto: report.totalBruto,
            avisos: report.avisos
          });
          return report;
        }

        if (NON_RETRYABLE_STATUSES.has(response.status)) {
          throw new Error(`Backend recusou payload (HTTP ${response.status}): ${text.slice(0, 500)}`);
        }
        lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        logger.warn(`Backend: falha transitória`, { status: response.status });
      } catch (err) {
        // Erro de rede (fetch failed, DNS, timeout). Retenta.
        if (err.message?.includes("recusou payload")) throw err;
        lastError = err;
        logger.warn(`Backend: erro de conexão`, { message: err.message });
      }

      if (attempt < this.retryMaxAttempts) {
        logger.info(`Aguardando ${Math.round(this.retryDelayMs / 60000)} min antes de retry`);
        await sleep(this.retryDelayMs);
      }
    }
    throw lastError ?? new Error("Sync falhou após todas as tentativas.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
