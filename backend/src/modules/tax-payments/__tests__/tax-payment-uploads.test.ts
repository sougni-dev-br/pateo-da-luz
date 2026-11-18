import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { limparUploadsAntigos } from "../tax-payment-uploads.js";

describe("limpeza dos uploads da importação", () => {
  let pasta: string;
  const HORA = 60 * 60 * 1000;

  beforeEach(() => { pasta = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-impostos-")); });
  afterEach(() => fs.rmSync(pasta, { recursive: true, force: true }));

  function arquivo(nome: string, horasAtras: number) {
    const caminho = path.join(pasta, nome);
    fs.writeFileSync(caminho, "x");
    const data = new Date(Date.now() - horasAtras * HORA);
    fs.utimesSync(caminho, data, data);
    return caminho;
  }

  test("apaga o que passou de 2 horas e deixa o recente", async () => {
    const velho = arquivo("a".repeat(32), 5);
    const recente = arquivo("c".repeat(32), 0.5);

    expect(await limparUploadsAntigos(pasta)).toBe(1);
    expect(fs.existsSync(velho)).toBe(false);
    expect(fs.existsSync(recente)).toBe(true);
  });

  test("a reserva '.processando' só vira lixo depois de 6 horas (importação em andamento não perde o arquivo)", async () => {
    const emUso = arquivo("b".repeat(32) + ".processando", 3);
    const preso = arquivo("e".repeat(32) + ".processando", 7);

    expect(await limparUploadsAntigos(pasta)).toBe(1);
    expect(fs.existsSync(emUso)).toBe(true);
    expect(fs.existsSync(preso)).toBe(false);
  });

  test("não mexe em subpasta e aceita um prazo diferente", async () => {
    fs.mkdirSync(path.join(pasta, "sub"));
    const velho = arquivo("d".repeat(32), 1.5);
    expect(await limparUploadsAntigos(pasta)).toBe(0);
    expect(fs.existsSync(path.join(pasta, "sub"))).toBe(true);
    expect(await limparUploadsAntigos(pasta, HORA)).toBe(1);
    expect(fs.existsSync(velho)).toBe(false);
  });

  test("pasta que ainda não existe não é erro", async () => {
    expect(await limparUploadsAntigos(path.join(pasta, "nao-existe"))).toBe(0);
  });
});
