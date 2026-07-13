import { prisma } from "../../../../config/database.js";

// Sync real 99 Food — STUB.
//
// Enquanto a plataforma 99 Food não aprovar o app do Pateo em
// developer-food.99app.com (status atual: "Em análise") não temos:
//   - documentação oficial dos endpoints financeiros
//   - AppShopID real das lojas
//   - contrato dos payloads (orders, settlements, fees)
//
// Este stub apenas registra um log falho pra deixar rastro na UI. O
// service principal (runSmartSync em noventa-nove.service.ts) só chama
// este arquivo quando detecta credencial + AppShopID reais; enquanto
// isso o mock cobre tudo.
//
// Quando 99 aprovar, este arquivo deve ganhar corpo espelhando
// ifood-real-sync.service.ts: buscar pedidos, settlements e fees do
// mês, persistir em NoventaNoveSale/Settlement/Fee, gerar Receivable
// pra cada settlement PAID e NoventaNoveMonthlyExpense com o breakdown
// das taxas.

export type RealSyncResult = {
  totalStores: number;
  storesSynced: number;
  errors: Array<{ storeId: string; storeLabel: string; message: string }>;
  itemsProcessed: number;
};

export async function runRealSync(params: {
  year: number;
  month: number;
  triggeredByUserId: string | null;
}): Promise<RealSyncResult> {
  const startedAt = new Date();
  await prisma.noventaNoveSyncLog.create({
    data: {
      syncType: "REAL",
      startedAt,
      finishedAt: new Date(),
      status: "SKIPPED",
      itemsProcessed: 0,
      errorMessage:
        "Sync real 99 Food ainda não implementado — aguardando aprovação em developer-food.99app.com e spec oficial da API.",
      triggeredByUserId: params.triggeredByUserId
    }
  });
  return {
    totalStores: 0,
    storesSynced: 0,
    errors: [
      {
        storeId: "-",
        storeLabel: "99 Food",
        message: "Aguardando aprovação do app em developer-food.99app.com. Rodando apenas mock por enquanto."
      }
    ],
    itemsProcessed: 0
  };
}
