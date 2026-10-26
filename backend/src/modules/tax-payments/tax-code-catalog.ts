import { prisma } from "../../config/database.js";
import type { ItemGuia } from "./tax-payment-items.js";

// O catálogo manda: se o código já existe para o tipo da guia, a denominação é a do catálogo (a tela trava o campo, e o
// servidor garante o mesmo para qualquer cliente). Código novo, com denominação informada, entra no catálogo para as
// próximas guias. Roda antes de gravar a guia: se falhar, nenhuma guia fica pela metade.
export async function aplicarCatalogoDeCodigos(documentType: string, itens: ItemGuia[]): Promise<ItemGuia[]> {
  const codigos = [...new Set(itens.map((i) => i.code).filter((c): c is string => Boolean(c)))];
  if (codigos.length === 0) return itens;

  const conhecidos = (await prisma.taxCodeCatalog.findMany({
    where: { documentType, code: { in: codigos } },
    select: { code: true, description: true },
  })) ?? [];
  const porCodigo = new Map(conhecidos.map((c) => [c.code, c.description]));

  const novos = new Map<string, string>();
  const finais = itens.map((i) => {
    if (!i.code) return i;
    const doCatalogo = porCodigo.get(i.code);
    if (doCatalogo) return { ...i, description: doCatalogo };
    if (!novos.has(i.code)) novos.set(i.code, i.description);
    return i;
  });

  if (novos.size > 0) {
    await prisma.taxCodeCatalog.createMany({
      data: [...novos.entries()].map(([code, description]) => ({ documentType, code, description })),
      skipDuplicates: true,
    });
  }
  return finais;
}
