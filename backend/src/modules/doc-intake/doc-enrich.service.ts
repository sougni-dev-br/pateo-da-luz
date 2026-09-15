// Cruzamento do rascunho com o cadastro: de quem e este documento, para qual
// empresa, ja existe lancamento igual, e quais documentos descrevem o MESMO titulo.
//
// Tudo aqui e consulta — nenhuma escrita.

import { prisma } from "../../config/database.js";
import { findPurchaseReferenceMatches, type PurchaseReferenceMatch } from "../purchases/purchase-duplicate-utils.js";
import type { Aviso, DocumentoExtraido } from "./doc-extract.service.js";
import { onlyDigits } from "./document-validators.js";

export type SugestaoFornecedor = {
  id: string;
  nome: string;
  cadastrado: true;
} | { cadastrado: false };

export type DocumentoEnriquecido = DocumentoExtraido & {
  fornecedor: SugestaoFornecedor;
  empresa: { id: string; nome: string } | null;
  duplicatas: Array<{ id: string; invoiceNumber: string | null; purchaseDate: Date; totalAmount: string; status: string }>;
  podeConfirmar: boolean;
};

async function acharEmpresaPorCnpj(cnpjDigits: string | null) {
  if (!cnpjDigits) return null;
  // Sao poucas empresas (3): comparar em memoria evita depender do formato
  // gravado na coluna, que varia entre mascarado e so digitos.
  const empresas = await prisma.company.findMany({ select: { id: true, tradeName: true, cnpj: true } });
  const alvo = empresas.find((empresa) => onlyDigits(empresa.cnpj) === cnpjDigits);
  return alvo ? { id: alvo.id, nome: alvo.tradeName } : null;
}

async function acharFornecedorPorCnpj(cnpjDigits: string | null): Promise<SugestaoFornecedor> {
  if (!cnpjDigits) return { cadastrado: false };
  // regexp_replace no banco porque Supplier.document tem mascara inconsistente
  // (uns com pontuacao, outros so digitos) e sao milhares de linhas.
  // A classe e [^0-9] e nao \\D de proposito: dentro da template string,
  // \\D nao e escape valido em JS e chega no Postgres como a letra D. A query
  // passava a remover os D do texto em vez da pontuacao, e nenhum fornecedor com
  // CNPJ mascarado casava — deu falso negativo com a Controlid, que esta cadastrada.
  const encontrados = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT id, name FROM "Supplier"
    WHERE regexp_replace(COALESCE(document, ''), '[^0-9]', '', 'g') = ${cnpjDigits}
    ORDER BY "isActive" DESC
    LIMIT 1
  `;
  const alvo = encontrados[0];
  return alvo ? { id: alvo.id, nome: alvo.name, cadastrado: true } : { cadastrado: false };
}

/**
 * Segunda rede contra lancamento em dobro. A primeira (numero da nota) depende de
 * Purchase.normalizedInvoiceNumber, que 10 das 434 compras com nota nao tem — os
 * titulos gerados por ciclo de fornecedor (FATURA-*, CICLO-*) entram sem ele e
 * ficam invisiveis aquela checagem. Fornecedor + valor + vencimento pega esses.
 */
async function acharTitulosSemelhantes(input: {
  supplierId: string;
  valorTotal: number | null;
  dataVencimento: Date | null;
}) {
  if (input.valorTotal === null || !input.dataVencimento) return [];

  const parcelas = await prisma.paymentInstallment.findMany({
    where: {
      dueDate: input.dataVencimento,
      amount: input.valorTotal,
      purchase: { supplierId: input.supplierId, status: "ACTIVE" },
    },
    select: {
      purchaseId: true,
      dueDate: true,
      purchase: { select: { invoiceNumber: true, totalAmount: true, status: true } },
    },
    take: 5,
  });

  return parcelas.map((parcela) => ({
    id: parcela.purchaseId,
    invoiceNumber: parcela.purchase.invoiceNumber,
    purchaseDate: parcela.dueDate ?? new Date(0),
    totalAmount: String(parcela.purchase.totalAmount),
    status: parcela.purchase.status,
  }));
}

export async function enriquecerDocumento(documento: DocumentoExtraido): Promise<DocumentoEnriquecido> {
  const avisos: Aviso[] = [...documento.avisos];

  const [fornecedor, empresa] = await Promise.all([
    acharFornecedorPorCnpj(documento.emissor.cnpjDigits),
    acharEmpresaPorCnpj(documento.destinatario.cnpjDigits),
  ]);

  if (!fornecedor.cadastrado) {
    avisos.push({
      nivel: "ATENCAO",
      codigo: "FORNECEDOR_NAO_CADASTRADO",
      mensagem: `Fornecedor ${documento.emissor.nome ?? "?"} (${documento.emissor.cnpj ?? "sem CNPJ"}) nao esta cadastrado — sera preciso cadastrar antes de lancar.`,
    });
  }

  if (documento.destinatario.cnpjDigits && !empresa) {
    // O documento pode ser de outra pessoa. Bloqueio: lancar despesa de terceiro
    // no DRE e exatamente o tipo de erro que este modulo existe para evitar.
    avisos.push({
      nivel: "BLOQUEIO",
      codigo: "DESTINATARIO_NAO_E_NOSSO",
      mensagem: `O documento esta em nome de ${documento.destinatario.nome ?? documento.destinatario.cnpj} , que nao e nenhuma das empresas cadastradas.`,
    });
  }

  let duplicatas: DocumentoEnriquecido["duplicatas"] = [];
  if (fornecedor.cadastrado && documento.numeroDocumento) {
    const encontradas = await findPurchaseReferenceMatches(prisma, {
      supplierId: fornecedor.id,
      invoiceNumber: documento.numeroDocumento,
    });
    duplicatas = encontradas.matches.map((item: PurchaseReferenceMatch) => ({
      id: item.id,
      invoiceNumber: item.invoiceNumber,
      purchaseDate: item.purchaseDate,
      totalAmount: item.totalAmount,
      status: item.status,
    }));
    // So a compra ATIVA bloqueia. Uma nota lancada e depois cancelada precisa
    // poder ser relancada — bloquear ai deixaria o usuario preso sem saida.
    if (encontradas.activeDuplicate) {
      avisos.push({
        nivel: "BLOQUEIO",
        codigo: "JA_LANCADO",
        mensagem: `Ja existe lancamento ativo deste fornecedor com a nota ${documento.numeroDocumento}.`,
      });
    } else if (encontradas.cancelledDuplicate) {
      avisos.push({
        nivel: "ATENCAO",
        codigo: "LANCADO_E_CANCELADO",
        mensagem: `Esta nota ja foi lancada e cancelada antes — confira se o relancamento e proposital.`,
      });
    }
  }

  if (fornecedor.cadastrado && duplicatas.length === 0) {
    const semelhantes = await acharTitulosSemelhantes({
      supplierId: fornecedor.id,
      valorTotal: documento.valorTotal,
      dataVencimento: documento.dataVencimento,
    });
    if (semelhantes.length > 0) {
      duplicatas = semelhantes;
      // ATENCAO e nao BLOQUEIO: dois titulos iguais no mesmo vencimento existem
      // de verdade (parcelas gemeas). Quem confere decide olhando a lista.
      avisos.push({
        nivel: "ATENCAO",
        codigo: "TITULO_SEMELHANTE",
        mensagem: `Ja existe titulo deste fornecedor com o mesmo valor e o mesmo vencimento. Confira se nao e o mesmo documento.`,
      });
    }
  }

  return {
    ...documento,
    avisos,
    fornecedor,
    empresa,
    duplicatas,
    podeConfirmar: !avisos.some((aviso) => aviso.nivel === "BLOQUEIO"),
  };
}
