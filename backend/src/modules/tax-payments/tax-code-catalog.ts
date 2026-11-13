import { prisma } from "../../config/database.js";
import type { ItemGuia } from "./tax-payment-items.js";

// O catálogo manda: se o código já existe para o tipo da guia, a denominação é a do catálogo (a tela trava o campo, e o
// servidor garante o mesmo para qualquer cliente). Só LÊ: nada é gravado aqui, para que uma guia recusada (número
// repetido, mês fechado...) não deixe código nem denominação errados no catálogo.
export async function aplicarCatalogoDeCodigos(documentType: string, itens: ItemGuia[]): Promise<ItemGuia[]> {
  const codigos = [...new Set(itens.map((i) => i.code).filter((c): c is string => Boolean(c)))];
  if (codigos.length === 0) return itens;

  const conhecidos = (await prisma.taxCodeCatalog.findMany({
    where: { documentType, code: { in: codigos } },
    select: { code: true, description: true },
  })) ?? [];
  const porCodigo = new Map(conhecidos.map((c) => [c.code, c.description]));

  return itens.map((i) => {
    const doCatalogo = i.code ? porCodigo.get(i.code) : undefined;
    return doCatalogo ? { ...i, description: doCatalogo } : i;
  });
}

// Código novo, com a denominação informada, entra no catálogo para as próximas guias. Roda DEPOIS de a guia ser gravada
// com sucesso; se falhar, a guia já está salva e o código é aprendido na próxima vez (por isso não propaga o erro).
export async function guardarCodigosNovos(documentType: string, itens: ItemGuia[]): Promise<void> {
  const codigos = [...new Set(itens.map((i) => i.code).filter((c): c is string => Boolean(c)))];
  if (codigos.length === 0) return;
  try {
    const conhecidos = (await prisma.taxCodeCatalog.findMany({
      where: { documentType, code: { in: codigos } },
      select: { code: true },
    })) ?? [];
    const sabidos = new Set(conhecidos.map((c) => c.code));
    const novos = new Map<string, string>();
    for (const i of itens) {
      if (i.code && !sabidos.has(i.code) && !novos.has(i.code)) novos.set(i.code, i.description);
    }
    if (novos.size === 0) return;
    await prisma.taxCodeCatalog.createMany({
      data: [...novos.entries()].map(([code, description]) => ({ documentType, code, description })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error("[impostos] não consegui guardar os códigos novos no catálogo:", error);
  }
}
