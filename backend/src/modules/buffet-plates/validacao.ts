import { Prisma } from "@prisma/client";
import type { z } from "zod";

// Mensagens de validação das plaquinhas em português e sem nome técnico de campo:
// "sections.0.items.2.nameEn: Required" vira "Seção 1, prato 3: nome em inglês obrigatório".
const CAMPOS: Record<string, string> = {
  name: "nome", namePt: "nome em português", nameEn: "nome em inglês", category: "categoria", isActive: "ativo",
  kind: "tipo da lista", format: "formato", theme: "cor", layout: "distribuição", face: "face", qty: "quantidade",
  items: "pratos", itemId: "prato", itemIds: "pratos", sections: "seções", titlePt: "título", titleEn: "título em inglês",
  copies: "displays", eventDate: "data", servedOn: "data", faceWidthMm: "largura", faceHeightMm: "altura",
  listId: "lista", listName: "nome da lista",
};

function onde(path: (string | number)[]) {
  const partes: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i] === "sections" && typeof path[i + 1] === "number") partes.push(`Seção ${(path[i + 1] as number) + 1}`);
    if (path[i] === "items" && typeof path[i + 1] === "number") partes.push(`prato ${(path[i + 1] as number) + 1}`);
  }
  return partes.join(", ");
}

export function mensagemDeValidacao(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Dados inválidos.";
  const campo = [...issue.path].reverse().find((p): p is string => typeof p === "string") ?? "";
  const nome = CAMPOS[campo] ?? "campo";
  let texto = issue.message;
  // Mensagem própria do schema (ex.: "categoria inválida") fica; só a padrão do zod, em inglês, é trocada.
  if (issue.code === "invalid_enum_value" && /^Invalid/.test(issue.message)) texto = `${nome}: opção inválida`;
  else if (issue.code === "invalid_type") texto = issue.received === "undefined" ? `${nome} obrigatório` : `${nome}: valor inválido`;
  const local = onde(issue.path);
  return local ? `${local}: ${texto}` : texto;
}

type ResponseLike = { status: (code: number) => { json: (body: unknown) => void } };

export function parseCorpo<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown, response: ResponseLike): T | null {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  response.status(400).json({ message: mensagemDeValidacao(parsed.error) });
  return null;
}

/** Registro apagado por outra pessoa entre a leitura e a escrita: vira 404, não 500. */
export const naoEncontrado = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
