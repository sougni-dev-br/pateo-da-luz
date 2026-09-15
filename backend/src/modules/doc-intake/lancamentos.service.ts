// Prestacao de contas do modulo: o que foi lancado pela leitura de documentos.
//
// Existe por uma razao concreta: quem liga um caminho automatico de lancamento
// precisa poder responder "o que entrou por ali?" e, se algo der errado,
// reverter em bloco. Sem isso, um lote ruim se confunde com o que foi digitado
// a mao e vira arqueologia.

import { prisma } from "../../config/database.js";

/** Prefixo gravado em Purchase.sourceFile por este modulo. */
export const ORIGEM_LEITURA = "doc-intake:";

export type LancamentoDaLeitura = {
  id: string;
  purchaseNumber: string | null;
  invoiceNumber: string | null;
  purchaseDate: Date;
  totalAmount: string;
  status: string;
  fornecedor: string;
  empresa: string | null;
  /** Arquivos que originaram o lancamento. */
  arquivos: string;
  criadoEm: Date;
};

export async function listarLancamentosDaLeitura(params: {
  desde?: Date | null;
  incluirCanceladas?: boolean;
  limite?: number;
}): Promise<LancamentoDaLeitura[]> {
  const limite = Math.min(Math.max(params.limite ?? 100, 1), 500);

  const compras = await prisma.purchase.findMany({
    where: {
      sourceFile: { startsWith: ORIGEM_LEITURA },
      ...(params.incluirCanceladas ? {} : { status: "ACTIVE" }),
      ...(params.desde ? { createdAt: { gte: params.desde } } : {}),
    },
    select: {
      id: true,
      purchaseNumber: true,
      invoiceNumber: true,
      purchaseDate: true,
      totalAmount: true,
      status: true,
      sourceFile: true,
      createdAt: true,
      supplier: { select: { name: true } },
      company: { select: { tradeName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limite,
  });

  return compras.map((compra) => ({
    id: compra.id,
    purchaseNumber: compra.purchaseNumber,
    invoiceNumber: compra.invoiceNumber,
    purchaseDate: compra.purchaseDate,
    totalAmount: String(compra.totalAmount),
    status: compra.status,
    fornecedor: compra.supplier.name,
    empresa: compra.company?.tradeName ?? null,
    arquivos: (compra.sourceFile ?? "").slice(ORIGEM_LEITURA.length),
    criadoEm: compra.createdAt,
  }));
}
