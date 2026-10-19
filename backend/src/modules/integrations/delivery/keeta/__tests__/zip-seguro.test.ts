import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { ErroDeImportacao } from "../erro-de-importacao.js";
import { LIMITE_DESCOMPRIMIDO_BYTES, verificarTamanhoDoZip } from "../zip-seguro.js";

async function xlsxPequeno(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("0");
  ws.addRow(["Data", "Vendas de itens"]);
  ws.addRow([20260901, 100]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Reescreve, no diretório central do zip, o tamanho descomprimido declarado de cada entrada. */
function declararTamanho(zip: Buffer, bytes: number): Buffer {
  const copia = Buffer.from(zip);
  for (let i = 0; i <= copia.length - 4; i += 1) {
    if (copia.readUInt32LE(i) === 0x02014b50) copia.writeUInt32LE(bytes, i + 24);
  }
  return copia;
}

describe("verificarTamanhoDoZip", () => {
  test("aceita um xlsx pequeno de verdade e devolve o tamanho descomprimido", async () => {
    const total = verificarTamanhoDoZip(await xlsxPequeno());
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(LIMITE_DESCOMPRIMIDO_BYTES);
  });

  test("recusa zip que declara tamanho descomprimido acima do limite (zip bomb)", async () => {
    const bomba = declararTamanho(await xlsxPequeno(), 200 * 1024 * 1024);
    expect(() => verificarTamanhoDoZip(bomba)).toThrow(ErroDeImportacao);
  });

  test("recusa arquivo que não é zip, sem expor detalhe interno", () => {
    expect(() => verificarTamanhoDoZip(Buffer.from("isto nao e um zip"))).toThrow(/não é um \.xlsx válido/);
  });
});
