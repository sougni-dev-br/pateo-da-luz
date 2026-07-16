import { z } from "zod";
import { prisma } from "../../config/database.js";

// Serviço de destinatários do resumo diário WhatsApp.
// Camada thin sobre o Prisma — validação Zod, normalização de telefone,
// lookup de ativos. UI vive em /configuracoes/notificacoes.

// Schema Zod: aceita telefone com "-", "(", ")", "+", espaço. Normalizamos
// para só dígitos antes de gravar. Exige entre 10 e 15 dígitos (DDI+DDD+
// número), o intervalo E.164 razoável para Brasil e internacional.
const phoneField = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length >= 10 && s.length <= 15, {
    message: "Telefone deve ter entre 10 e 15 dígitos (incluindo DDI/DDD)."
  });

export const createRecipientSchema = z.object({
  name: z.string().trim().min(1, "Nome obrigatório.").max(120),
  phone: phoneField,
  notes: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().optional()
});

export const updateRecipientSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneField.optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional()
});

export type RecipientView = {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function toView(row: {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): RecipientView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listRecipients(): Promise<RecipientView[]> {
  const rows = await prisma.whatsAppRecipient.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }]
  });
  return rows.map(toView);
}

// Usada pelo daily-summary trigger. Retorna só ativos, ordenados por nome
// (envio determinístico — se um destinatário for adicionado depois, ele
// aparece na próxima execução, sem afetar a ordem dos existentes).
export async function listActivePhones(): Promise<Array<{ id: string; name: string; phone: string }>> {
  const rows = await prisma.whatsAppRecipient.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true }
  });
  return rows;
}

export async function createRecipient(input: z.infer<typeof createRecipientSchema>): Promise<RecipientView> {
  const row = await prisma.whatsAppRecipient.create({
    data: {
      name: input.name,
      phone: input.phone,
      notes: input.notes ?? null,
      isActive: input.isActive ?? true
    }
  });
  return toView(row);
}

export async function updateRecipient(
  id: string,
  input: z.infer<typeof updateRecipientSchema>
): Promise<RecipientView | null> {
  try {
    const row = await prisma.whatsAppRecipient.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });
    return toView(row);
  } catch (error) {
    // Prisma lança P2025 quando o registro não existe. Convertemos em null
    // para o caller retornar 404 em vez de 500.
    if ((error as { code?: string }).code === "P2025") return null;
    throw error;
  }
}

export async function deleteRecipient(id: string): Promise<boolean> {
  try {
    await prisma.whatsAppRecipient.delete({ where: { id } });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") return false;
    throw error;
  }
}
