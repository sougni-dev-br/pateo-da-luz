import { logger } from "./logger.js";

// Cliente do ERP (Render). Autentica por X-Keeta-Token. Retenta rede e 5xx; 4xx não (não vai passar
// de novo). O ERP é idempotente: reenviar o mesmo relatório não duplica nada.

const NAO_RETENTAVEIS = new Set([400, 401, 403, 404, 422]);
const TIMEOUT_ENVIO_MS = 5 * 60 * 1000;
const TIMEOUT_HEARTBEAT_MS = 15 * 1000;

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BackendClient {
  constructor({ baseUrl, ingestToken, retryMaxAttempts = 3, retryDelayMs = 300000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.ingestToken = ingestToken;
    this.retryMaxAttempts = retryMaxAttempts;
    this.retryDelayMs = retryDelayMs;
  }

  async enviarRelatorio(buffer, nomeDoArquivo) {
    let ultimoErro = null;
    for (let tentativa = 1; tentativa <= this.retryMaxAttempts; tentativa += 1) {
      try {
        logger.info(`ERP: enviando ${nomeDoArquivo} (tentativa ${tentativa}/${this.retryMaxAttempts})`, { bytes: buffer.length });
        const formulario = new FormData();
        formulario.append("file", new Blob([buffer]), nomeDoArquivo);
        const resposta = await fetch(`${this.baseUrl}/integrations/keeta-agente/sync`, {
          method: "POST",
          headers: { "X-Keeta-Token": this.ingestToken },
          body: formulario,
          signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS)
        });
        const texto = await resposta.text();
        if (resposta.ok) return JSON.parse(texto);
        if (NAO_RETENTAVEIS.has(resposta.status)) {
          throw new ErroDefinitivo(`O ERP recusou o relatório (HTTP ${resposta.status}): ${texto.slice(0, 300)}`);
        }
        ultimoErro = new Error(`HTTP ${resposta.status}: ${texto.slice(0, 200)}`);
      } catch (err) {
        if (err instanceof ErroDefinitivo) throw err;
        ultimoErro = err;
      }
      logger.warn("ERP: falha transitória", { mensagem: ultimoErro?.message });
      if (tentativa < this.retryMaxAttempts) await dormir(this.retryDelayMs);
    }
    throw new Error(`O ERP não respondeu após ${this.retryMaxAttempts} tentativas: ${ultimoErro?.message}`);
  }

  /** Sinal de vida: uma tentativa, timeout curto, falha ignorada (não pode derrubar a execução). */
  async heartbeat(payload) {
    try {
      const resposta = await fetch(`${this.baseUrl}/integrations/keeta-agente/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Keeta-Token": this.ingestToken },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_HEARTBEAT_MS)
      });
      if (!resposta.ok) logger.warn("ERP: heartbeat recusado", { status: resposta.status });
    } catch (err) {
      logger.warn("ERP: heartbeat não enviado", { mensagem: err.message });
    }
  }
}

class ErroDefinitivo extends Error {}
