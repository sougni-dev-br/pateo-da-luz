import { describe, expect, test, vi } from "vitest";
import { Prisma } from "@prisma/client";

// F-14: os códigos sequenciais (CNT-, INV-, REQ-...) sao gerados com "pega o
// ultimo e soma 1", fora de transacao. Dois usuarios criando ao mesmo tempo
// chegam ao mesmo numero; o indice UNIQUE impede a duplicata, mas o segundo
// recebia erro 500. O helper transforma o conflito em nova tentativa.
//
// Reimplementado aqui porque inventory.routes.ts importa o Prisma no topo do
// modulo e nao carrega em teste unitario sem banco.

const CONFLITO_UNIQUE = "P2002";

async function comCodigoUnico<T>(
  gerarCodigo: () => Promise<string>,
  usarCodigo: (code: string) => Promise<T>,
  tentativas = 5
): Promise<T> {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    const code = await gerarCodigo();
    try {
      return await usarCodigo(code);
    } catch (error) {
      const conflito =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === CONFLITO_UNIQUE;
      if (!conflito) throw error;
      ultimoErro = error;
    }
  }
  throw ultimoErro;
}

const conflitoUnique = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: CONFLITO_UNIQUE,
    clientVersion: "5.22.0"
  });

describe("comCodigoUnico", () => {
  test("sem conflito, usa o primeiro codigo e nao repete", async () => {
    const gerar = vi.fn().mockResolvedValue("INV-2026-0001");
    const usar = vi.fn().mockResolvedValue("ok");
    await expect(comCodigoUnico(gerar, usar)).resolves.toBe("ok");
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(usar).toHaveBeenCalledTimes(1);
  });

  test("conflito de unicidade gera novo codigo e tenta de novo", async () => {
    // Simula a corrida: outro usuario levou o 0001 no meio do caminho.
    const gerar = vi.fn()
      .mockResolvedValueOnce("INV-2026-0001")
      .mockResolvedValueOnce("INV-2026-0002");
    const usar = vi.fn()
      .mockRejectedValueOnce(conflitoUnique())
      .mockResolvedValueOnce("criado");

    await expect(comCodigoUnico(gerar, usar)).resolves.toBe("criado");
    expect(gerar).toHaveBeenCalledTimes(2);
    expect(usar).toHaveBeenNthCalledWith(1, "INV-2026-0001");
    expect(usar).toHaveBeenNthCalledWith(2, "INV-2026-0002");
  });

  test("erro que nao e conflito sobe na hora, sem repetir", async () => {
    // Retentar um erro real mascararia o problema e multiplicaria o efeito.
    const gerar = vi.fn().mockResolvedValue("INV-2026-0001");
    const usar = vi.fn().mockRejectedValue(new Error("coluna nao existe"));
    await expect(comCodigoUnico(gerar, usar)).rejects.toThrow("coluna nao existe");
    expect(usar).toHaveBeenCalledTimes(1);
  });

  test("conflito insistente desiste depois do limite", async () => {
    const gerar = vi.fn().mockResolvedValue("INV-2026-0001");
    const usar = vi.fn().mockRejectedValue(conflitoUnique());
    await expect(comCodigoUnico(gerar, usar, 3)).rejects.toMatchObject({ code: CONFLITO_UNIQUE });
    expect(usar).toHaveBeenCalledTimes(3);
  });
});

describe("splitAmountInCents", () => {
  // F-13: a divisao anterior dava o mesmo valor a todas as parcelas e o resto
  // ficava sem dono — R$ 100 em 3x somava 99,99 numa coluna Decimal(12,2).
  function split(totalAmount: number, count: number): number[] {
    if (count <= 0) return [];
    const totalCents = Math.round(totalAmount * 100);
    const baseCents = Math.floor(totalCents / count);
    const extraCents = totalCents - baseCents * count;
    return Array.from({ length: count }, (_, i) => (baseCents + (i === 0 ? extraCents : 0)) / 100);
  }
  const soma = (v: number[]) => Math.round(v.reduce((s, x) => s + x, 0) * 100) / 100;

  test("divisao exata mantem parcelas iguais", () => {
    expect(split(120, 3)).toEqual([40, 40, 40]);
  });

  test("resto de centavo vai para a primeira parcela", () => {
    expect(split(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(soma(split(100, 3))).toBe(100);
  });

  test("a soma fecha com o total em qualquer divisao", () => {
    for (const total of [100, 1706.78, 0.03, 999.99, 54562.79]) {
      for (const n of [1, 2, 3, 4, 5, 6, 7, 12]) {
        expect(soma(split(total, n))).toBe(Math.round(total * 100) / 100);
      }
    }
  });

  test("uma parcela recebe o total inteiro", () => {
    expect(split(1706.78, 1)).toEqual([1706.78]);
  });
});
