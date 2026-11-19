import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(resolve(import.meta.dirname, "../../../../scripts/auditar-combinado.ts"), "utf8");

// A auditoria nunca grava: a conexão é somente leitura e o script só chama leituras (a garantia final é do Postgres).
describe("scripts/auditar-combinado.ts é somente leitura", () => {
  it("abre a conexão com default_transaction_read_only=on", () => {
    expect(script).toContain("default_transaction_read_only%3Don");
  });
  it("não chama nenhuma escrita do Prisma nem aplica complemento", () => {
    expect(script).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw\w*)\(/);
    expect(script).not.toMatch(/aplicar:\s*true/);
    expect(script).not.toMatch(/sincronizar|somarCombinadoAoExtrato|gravarInformadas/);
  });
});
