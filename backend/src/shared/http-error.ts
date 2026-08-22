import { Prisma } from "@prisma/client";

export type HttpErrorDescription = {
  status: number;
  /** Texto que vai para o cliente. Nunca carrega detalhe de schema. */
  message: string;
  /** Detalhe tecnico, so para o log do servidor. */
  detail: string | null;
};

const GENERIC = "Erro interno do servidor.";

function fieldsFrom(meta: Record<string, unknown> | undefined) {
  const target = meta?.target;
  if (Array.isArray(target)) return target.join(", ");
  if (typeof target === "string") return target;
  if (typeof meta?.field_name === "string") return meta.field_name;
  return null;
}

/**
 * Converte um erro em status HTTP e mensagem para o cliente.
 *
 * O handler global respondia sempre 500 com `error.message`. Como quase nada
 * era validado antes, a mensagem que chegava ao navegador era a do Prisma —
 * nome de tabela, de coluna e de constraint. Alem de vazar a estrutura
 * interna, era ilegivel para quem estava usando a tela.
 */
export function describeHttpError(error: unknown): HttpErrorDescription {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const detail = `${error.code} ${error.message}`;
    const fields = fieldsFrom(error.meta as Record<string, unknown> | undefined);

    switch (error.code) {
      case "P2002":
        return {
          status: 409,
          message: fields
            ? `Ja existe um registro com esse valor em ${fields}.`
            : "Ja existe um registro com esse valor.",
          detail
        };
      case "P2025":
        return { status: 404, message: "Registro nao encontrado.", detail };
      case "P2003":
        return {
          status: 400,
          message: fields
            ? `O registro referenciado em ${fields} nao existe.`
            : "Um dos registros referenciados nao existe.",
          detail
        };
      case "P2000":
        return { status: 400, message: "Um dos valores informados e longo demais.", detail };
      case "P2011":
      case "P2012":
        return {
          status: 400,
          message: fields ? `Campo obrigatorio nao informado: ${fields}.` : "Campo obrigatorio nao informado.",
          detail
        };
      default:
        return { status: 500, message: GENERIC, detail };
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // A mensagem desse erro e um dump do schema esperado — util no log,
    // inutil (e indiscreto) na tela.
    return { status: 400, message: "Dados invalidos na requisicao.", detail: error.message };
  }

  if (error instanceof Error) {
    // Erro lancado de proposito pelo proprio codigo: a mensagem foi escrita
    // para ser lida, entao passa adiante.
    return { status: 500, message: error.message || GENERIC, detail: error.stack ?? null };
  }

  return { status: 500, message: GENERIC, detail: error === null ? null : String(error) };
}
