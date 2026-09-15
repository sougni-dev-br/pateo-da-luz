// Provider de LLM para leitura de documentos.
//
// Interface propria em vez do SDK do fornecedor por dois motivos concretos:
// (1) o modelo muda — gemini-2.5-flash responde 404 nesta conta e o 3.6-flash
// responde 200, entao o nome precisa ser configuravel sem recompilar;
// (2) se um dia a conta gratuita acabar, troca-se a implementacao sem tocar no
// servico de extracao.
//
// A chave NUNCA entra em URL (fica no header x-goog-api-key) para nao vazar em
// log de proxy, historico de shell ou mensagem de erro.

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.6-flash";
// Modelo reserva. O tier gratuito devolve 503 ("high demand") com frequencia
// real — aconteceu duas vezes no primeiro teste com documento de verdade — e
// insistir no mesmo modelo congestionado nao resolve; trocar resolve.
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash";
const DEFAULT_TIMEOUT_MS = 60_000;

// 503 (sobrecarga) e 429 (cota do minuto) sao transitorios. Sem retry, um pico
// do Google vira "falhou" na frente de quem esta conferindo a nota.
const STATUS_RETRIAVEIS = new Set([429, 500, 502, 503, 504]);
const MAX_TENTATIVAS_POR_MODELO = 3;
const BACKOFF_BASE_MS = 1_500;

export type LlmJsonRequest = {
  prompt: string;
  /** JSON Schema (dialeto OpenAPI) que o modelo e obrigado a responder. */
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  /**
   * Documento enviado como binario, para PDF escaneado (sem camada de texto).
   * O Gemini le PDF nativamente, entao nao precisamos converter para imagem
   * nem instalar nada — e tambem nao perdemos o layout, que ajuda o modelo a
   * nao confundir prestador com tomador em nota de duas colunas.
   */
  arquivo?: { mimeType: string; base64: string };
};

export type LlmJsonResult<T> = {
  data: T;
  model: string;
  tokensUsed: number | null;
};

export interface LlmProvider {
  readonly name: string;
  generateJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>>;
}

export class LlmRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "LlmRequestError";
  }
}

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly modelos: string[];

  constructor(
    private readonly apiKey: string,
    modelos: string[] = [DEFAULT_MODEL, DEFAULT_FALLBACK_MODEL],
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    // Injetavel para o teste nao gastar 4,5s dormindo em cada cenario de retry.
    private readonly backoffBaseMs: number = BACKOFF_BASE_MS,
  ) {
    this.modelos = modelos.filter(Boolean);
  }

  async generateJson<T>(request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    let ultimoErro: unknown;

    for (const modelo of this.modelos) {
      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_POR_MODELO; tentativa += 1) {
        try {
          return await this.chamar<T>(modelo, request);
        } catch (error) {
          ultimoErro = error;
          const retriavel = error instanceof LlmRequestError && STATUS_RETRIAVEIS.has(error.status);
          // Erro definitivo (400, 401, 404, JSON quebrado) nao melhora tentando
          // de novo nem trocando de modelo: falha logo para nao gastar tempo.
          if (!retriavel) throw error;
          if (tentativa < MAX_TENTATIVAS_POR_MODELO) {
            await espera(this.backoffBaseMs * 2 ** (tentativa - 1)); // 1,5s, 3s
          }
        }
      }
      // Esgotou este modelo: cai para o proximo da lista.
    }

    throw ultimoErro;
  }

  private async chamar<T>(modelo: string, request: LlmJsonRequest): Promise<LlmJsonResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${GEMINI_ENDPOINT}/${modelo}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            parts: request.arquivo
              ? [
                  { text: request.prompt },
                  { inline_data: { mime_type: request.arquivo.mimeType, data: request.arquivo.base64 } },
                ]
              : [{ text: request.prompt }],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: request.schema,
            temperature: 0,
            ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          },
        }),
      });

      if (!response.ok) {
        // O corpo do erro do Google nao contem a chave (ela foi no header),
        // mas truncamos assim mesmo para nao despejar payload em log.
        const detail = (await response.text().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
        throw new LlmRequestError(response.status, `${modelo} respondeu ${response.status}: ${detail}`);
      }

      const payload = await response.json() as GeminiResponse;
      const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");

      if (!text.trim()) {
        throw new LlmRequestError(502, `${modelo} devolveu resposta vazia.`);
      }

      return {
        data: JSON.parse(text) as T,
        model: modelo,
        tokensUsed: payload.usageMetadata?.totalTokenCount ?? null,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LlmRequestError(504, `${modelo} nao respondeu em ${this.timeoutMs / 1000}s.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { totalTokenCount?: number };
};

/** Devolve null quando a chave nao esta configurada — quem chama decide o que fazer. */
export function createLlmProvider(): LlmProvider | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const modelos = [
    process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    process.env.GEMINI_MODEL_FALLBACK?.trim() || DEFAULT_FALLBACK_MODEL,
  ].filter((modelo, indice, lista) => lista.indexOf(modelo) === indice);

  return new GeminiProvider(apiKey, modelos);
}
