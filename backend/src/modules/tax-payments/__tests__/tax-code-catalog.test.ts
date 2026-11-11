import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { taxCodeCatalog: { findMany: vi.fn(), createMany: vi.fn() } },
}));

import { prisma } from "../../../config/database.js";
import { aplicarCatalogoDeCodigos, guardarCodigosNovos } from "../tax-code-catalog.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const catalogo = (prisma as any).taxCodeCatalog;
const linha = (code: string | null, description: string) => ({ code, description, principal: 10, fine: 0, interest: 0 });

describe("aplicarCatalogoDeCodigos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogo.findMany.mockResolvedValue([]);
  });

  test("código conhecido: a denominação é a do catálogo, mesmo que o cliente mande outra", async () => {
    catalogo.findMany.mockResolvedValue([{ code: "1001", description: "IRPJ - SIMPLES NACIONAL" }]);
    const r = await aplicarCatalogoDeCodigos("Simples Nacional / DAS", [linha("1001", "texto digitado errado")]);
    expect(r[0].description).toBe("IRPJ - SIMPLES NACIONAL");
    expect(catalogo.createMany).not.toHaveBeenCalled();
  });

  test("consulta o catálogo só do tipo da guia e só dos códigos usados", async () => {
    await aplicarCatalogoDeCodigos("DARF", [linha("1082", "A"), linha("1099", "B"), linha("1082", "A de novo")]);
    expect(catalogo.findMany.mock.calls[0][0].where).toEqual({ documentType: "DARF", code: { in: ["1082", "1099"] } });
  });

  test("aplicar só LÊ: código novo não é gravado (guia recusada não deixa lixo no catálogo)", async () => {
    const r = await aplicarCatalogoDeCodigos("DARF", [linha("5952", "RETENCAO CSLL/COFINS/PIS")]);
    expect(r[0].description).toBe("RETENCAO CSLL/COFINS/PIS");
    expect(catalogo.createMany).not.toHaveBeenCalled();
  });

  test("linhas sem código (FGTS) não consultam nada", async () => {
    const r = await aplicarCatalogoDeCodigos("FGTS", [linha(null, "FGTS Mensal")]);
    expect(r[0].description).toBe("FGTS Mensal");
    expect(catalogo.findMany).not.toHaveBeenCalled();
  });

  test("o mesmo código em outro tipo de guia não é confundido (o catálogo é por tipo)", async () => {
    await aplicarCatalogoDeCodigos("GPS / INSS", [linha("1001", "OUTRA COISA")]);
    expect(catalogo.findMany.mock.calls[0][0].where.documentType).toBe("GPS / INSS");
  });
});

describe("guardarCodigosNovos (depois de a guia ser gravada)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogo.findMany.mockResolvedValue([]);
  });

  test("código novo entra no catálogo, uma vez, com a denominação informada", async () => {
    await guardarCodigosNovos("DARF", [linha("5952", "RETENCAO CSLL/COFINS/PIS"), linha("5952", "repetido")]);
    expect(catalogo.createMany).toHaveBeenCalledWith({
      data: [{ documentType: "DARF", code: "5952", description: "RETENCAO CSLL/COFINS/PIS" }],
      skipDuplicates: true,
    });
  });

  test("mistura de conhecido e novo: só o novo é gravado", async () => {
    catalogo.findMany.mockResolvedValue([{ code: "1082" }]);
    await guardarCodigosNovos("DARF", [linha("1082", "x"), linha("9999", "NOVO")]);
    expect(catalogo.createMany.mock.calls[0][0].data).toEqual([{ documentType: "DARF", code: "9999", description: "NOVO" }]);
  });

  test("sem código novo ou sem código algum, não grava nem consulta à toa", async () => {
    await guardarCodigosNovos("FGTS", [linha(null, "FGTS Mensal")]);
    expect(catalogo.findMany).not.toHaveBeenCalled();
    catalogo.findMany.mockResolvedValue([{ code: "1082" }]);
    await guardarCodigosNovos("DARF", [linha("1082", "x")]);
    expect(catalogo.createMany).not.toHaveBeenCalled();
  });

  test("falha ao guardar não derruba a guia já gravada", async () => {
    catalogo.createMany.mockRejectedValueOnce(new Error("banco fora"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(guardarCodigosNovos("DARF", [linha("9999", "NOVO")])).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});
