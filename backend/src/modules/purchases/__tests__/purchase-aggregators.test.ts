import { describe, expect, it } from "vitest";
import {
  AGGREGATOR_WORKFLOW_STATUSES,
  excludeAggregatorsSql,
  excludeAggregatorsWhere,
  isAggregatorWorkflowStatus,
} from "../purchase-aggregators.js";

// Fechar um ciclo de fornecedor (ou uma fatura de cartao) cria uma Purchase sem
// item nenhum, no valor do que as compras individuais ja somam. Quem esquecer de
// exclui-la de uma soma de "totalAmount" conta a despesa duas vezes — foram
// R$ 67.045,32 de compra inexistente entre jun e ago/2026. Estes testes existem
// para que a regra nao seja afrouxada sem alguem perceber.

describe("agregadores de pagamento", () => {
  it("reconhece ciclo de fornecedor e fatura de cartao como agregador", () => {
    expect(isAggregatorWorkflowStatus("SUPPLIER_CYCLE")).toBe(true);
    expect(isAggregatorWorkflowStatus("CARD_STATEMENT")).toBe(true);
  });

  it("nao confunde compra de verdade com agregador", () => {
    expect(isAggregatorWorkflowStatus("confirmed")).toBe(false);
    expect(isAggregatorWorkflowStatus("draft")).toBe(false);
    expect(isAggregatorWorkflowStatus(null)).toBe(false);
    expect(isAggregatorWorkflowStatus(undefined)).toBe(false);
  });

  it("cobre os dois tipos de agregador, nunca so um", () => {
    expect([...AGGREGATOR_WORKFLOW_STATUSES].sort()).toEqual([
      "CARD_STATEMENT",
      "SUPPLIER_CYCLE",
    ]);
  });

  describe("fragmento SQL", () => {
    it("filtra pelo workflowStatus e pelos dois vinculos", () => {
      const { sql } = excludeAggregatorsSql();
      expect(sql).toContain("SUPPLIER_CYCLE");
      expect(sql).toContain("CARD_STATEMENT");
      // O EXISTS e a rede de seguranca para agregador cujo workflowStatus tenha
      // sido alterado; ha em producao um cujo generatedPurchaseId se perdeu, por
      // isso as duas checagens precisam coexistir.
      expect(sql).toContain('"SupplierBillingCycle"');
      expect(sql).toContain('"CreditCardStatement"');
      expect(sql).toContain("generatedPurchaseId");
    });

    it("trata workflowStatus nulo como compra de verdade, nao como agregador", () => {
      // Sem o COALESCE, `NULL NOT IN (...)` e NULL — e a compra antiga, que nao
      // tem workflowStatus, sumiria de todo relatorio.
      expect(excludeAggregatorsSql().sql).toContain("COALESCE");
    });

    it("qualifica as colunas com o alias recebido", () => {
      expect(excludeAggregatorsSql("p").sql).toContain('"p"."workflowStatus"');
      expect(excludeAggregatorsSql().sql).toContain('"Purchase"."workflowStatus"');
    });
  });

  it("o filtro do Prisma Client exclui os dois workflowStatus", () => {
    expect(excludeAggregatorsWhere).toEqual({
      NOT: { workflowStatus: { in: ["SUPPLIER_CYCLE", "CARD_STATEMENT"] } },
    });
  });
});
