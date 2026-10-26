import { describe, expect, test } from "vitest";
import { lojasComProblema, mensagemDoSyncLog, type StorePerResult } from "../noventa-nove-real-sync.service.js";

function loja(parcial: Partial<StorePerResult>): StorePerResult {
  return {
    storeId: "s1",
    storeLabel: "Frei Caneca",
    externalId: "PATEO-FREI-CANECA",
    status: "SUCCESS",
    itemsPersisted: { sales: 0, settlements: 0, fees: 0 },
    message: "",
    ...parcial
  };
}

describe("lojasComProblema", () => {
  test("SUCCESS e SKIPPED não são problema (loja aguardando autorização é estado normal)", () => {
    expect(lojasComProblema([loja({ status: "SUCCESS" }), loja({ status: "SKIPPED" })])).toEqual([]);
  });

  test("PARTIAL e ERROR entram, com o nome da loja e a mensagem", () => {
    const r = lojasComProblema([
      loja({ status: "PARTIAL", message: "Falhas parciais: billData: 99 Food retornou 429" }),
      loja({ status: "ERROR", storeLabel: "Peposo", message: "nenhuma fonte respondeu" })
    ]);
    expect(r).toEqual([
      "Frei Caneca: Falhas parciais: billData: 99 Food retornou 429",
      "Peposo: nenhuma fonte respondeu"
    ]);
  });
});

describe("mensagemDoSyncLog", () => {
  test("tudo certo: sem mensagem", () => {
    expect(mensagemDoSyncLog([loja({ status: "SUCCESS", message: "Persistidos: 10 pedidos." })])).toBeNull();
  });

  test("loja PARTIAL sem aviso ⚠️ deixa a causa no log (antes ficava null)", () => {
    const msg = mensagemDoSyncLog([loja({ status: "PARTIAL", message: "Falhas parciais: settlements: HTTP 503" })]);
    expect(msg).toContain("Frei Caneca");
    expect(msg).toContain("settlements: HTTP 503");
  });

  test("aviso ⚠️ de loja com SUCCESS continua indo para o log", () => {
    const msg = mensagemDoSyncLog([loja({ status: "SUCCESS", message: "⚠️ Borda do mês anterior não sincronizada" })]);
    expect(msg).toContain("Borda do mês anterior");
  });

  test("falha de uma loja não esconde o aviso de outra", () => {
    const msg = mensagemDoSyncLog([
      loja({ status: "ERROR", storeLabel: "A", message: "caiu" }),
      loja({ status: "SUCCESS", storeLabel: "B", message: "⚠️ Loja sem Empresa vinculada" })
    ]);
    expect(msg).toContain("A: caiu");
    expect(msg).toContain("B: ⚠️ Loja sem Empresa vinculada");
  });
});
