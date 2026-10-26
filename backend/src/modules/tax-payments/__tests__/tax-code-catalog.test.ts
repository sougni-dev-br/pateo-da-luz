import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../config/database.js", () => ({
  prisma: { taxCodeCatalog: { findMany: vi.fn(), createMany: vi.fn() } },
}));

import { prisma } from "../../../config/database.js";
import { aplicarCatalogoDeCodigos } from "../tax-code-catalog.js";

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

  test("código novo entra no catálogo, uma vez, com a denominação informada", async () => {
    const r = await aplicarCatalogoDeCodigos("DARF", [linha("5952", "RETENCAO CSLL/COFINS/PIS"), linha("5952", "repetido")]);
    expect(r[0].description).toBe("RETENCAO CSLL/COFINS/PIS");
    expect(catalogo.createMany).toHaveBeenCalledWith({
      data: [{ documentType: "DARF", code: "5952", description: "RETENCAO CSLL/COFINS/PIS" }],
      skipDuplicates: true,
    });
  });

  test("mistura de conhecido e novo: só o novo é gravado", async () => {
    catalogo.findMany.mockResolvedValue([{ code: "1082", description: "CONTR PREV" }]);
    await aplicarCatalogoDeCodigos("DARF", [linha("1082", "x"), linha("9999", "NOVO")]);
    expect(catalogo.createMany.mock.calls[0][0].data).toEqual([{ documentType: "DARF", code: "9999", description: "NOVO" }]);
  });

  test("linhas sem código (FGTS) não consultam nem gravam nada", async () => {
    const r = await aplicarCatalogoDeCodigos("FGTS", [linha(null, "FGTS Mensal")]);
    expect(r[0].description).toBe("FGTS Mensal");
    expect(catalogo.findMany).not.toHaveBeenCalled();
    expect(catalogo.createMany).not.toHaveBeenCalled();
  });

  test("o mesmo código em outro tipo de guia não é confundido (o catálogo é por tipo)", async () => {
    await aplicarCatalogoDeCodigos("GPS / INSS", [linha("1001", "OUTRA COISA")]);
    expect(catalogo.findMany.mock.calls[0][0].where.documentType).toBe("GPS / INSS");
    expect(catalogo.createMany.mock.calls[0][0].data[0]).toMatchObject({ documentType: "GPS / INSS", code: "1001" });
  });
});
