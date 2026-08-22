import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { describeHttpError } from "../http-error.js";

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("mensagem tecnica do prisma", {
    code,
    clientVersion: "5.22.0",
    meta
  });
}

describe("describeHttpError", () => {
  it("traduz violacao de unicidade em 409", () => {
    const result = describeHttpError(prismaError("P2002", { target: ["externalCode"] }));
    expect(result.status).toBe(409);
    expect(result.message).toMatch(/ja existe/i);
    expect(result.message).toContain("externalCode");
  });

  it("traduz registro inexistente em 404", () => {
    const result = describeHttpError(prismaError("P2025"));
    expect(result.status).toBe(404);
    expect(result.message).toContain("nao encontrado");
  });

  it("traduz chave estrangeira invalida em 400", () => {
    const result = describeHttpError(prismaError("P2003", { field_name: "dreCategoryId" }));
    expect(result.status).toBe(400);
    expect(result.message).toContain("nao existe");
  });

  it("traduz campo obrigatorio ausente em 400", () => {
    expect(describeHttpError(prismaError("P2011")).status).toBe(400);
    expect(describeHttpError(prismaError("P2012")).status).toBe(400);
  });

  it("traduz valor longo demais em 400", () => {
    expect(describeHttpError(prismaError("P2000")).status).toBe(400);
  });

  it("nao vaza a mensagem tecnica do prisma", () => {
    // API-11: o handler devolvia error.message cru, entao nome de tabela,
    // coluna e constraint chegavam ao navegador.
    for (const code of ["P2002", "P2025", "P2003", "P2011", "P2000", "P2034"]) {
      const result = describeHttpError(prismaError(code));
      expect(result.message).not.toContain("mensagem tecnica do prisma");
    }
  });

  it("erro desconhecido do prisma vira 500 generico", () => {
    const result = describeHttpError(prismaError("P2034"));
    expect(result.status).toBe(500);
    expect(result.message).toBe("Erro interno do servidor.");
  });

  it("erro comum de aplicacao mantem a mensagem, com status 500", () => {
    // Erro lancado de proposito pelo codigo ("Sequencia nao inicializada")
    // continua util para quem le a tela.
    const result = describeHttpError(new Error("Nao foi possivel gerar codigo automatico do produto."));
    expect(result.status).toBe(500);
    expect(result.message).toBe("Nao foi possivel gerar codigo automatico do produto.");
  });

  it("valor que nao e erro vira 500 generico", () => {
    expect(describeHttpError("qualquer coisa").status).toBe(500);
    expect(describeHttpError(null).message).toBe("Erro interno do servidor.");
  });

  it("expoe o detalhe tecnico separado, para o log", () => {
    const result = describeHttpError(prismaError("P2002", { target: ["name"] }));
    expect(result.detail).toContain("P2002");
  });
});
