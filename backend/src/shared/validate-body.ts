import type { z } from "zod";

/**
 * Primeira falha de validacao em texto legivel: "campo: motivo".
 *
 * O padrao anterior respondia "Payload invalido" com o dump de
 * `error.flatten()` — o cliente recebia a estrutura toda e o usuario, na tela,
 * nao ficava sabendo qual campo corrigir.
 */
export function firstValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Dados invalidos na requisicao.";

  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

type ResponseLike = {
  status: (code: number) => { json: (body: unknown) => void };
};

/**
 * Valida o corpo e, em caso de falha, ja responde 400 com a mensagem legivel.
 * Devolve null quando invalido — a rota so precisa fazer `if (!data) return;`.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown, response: ResponseLike): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    response.status(400).json({ message: firstValidationMessage(parsed.error) });
    return null;
  }
  return parsed.data;
}
