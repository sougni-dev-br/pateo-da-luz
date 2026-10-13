import { describe, expect, test } from "vitest";
import { FOTO_TAMANHO_MAXIMO, validarFoto } from "../waste-photo.js";

// JPEG mínimo para os testes: cabeçalho FF D8 FF, miolo e marcador final FF D9.
const jpeg = (tamanho: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(Math.max(tamanho - 6, 1), 7), Buffer.from([0xff, 0xd9])]);

describe("validarFoto", () => {
  test("aceita JPEG pequeno e calcula o sha256", () => {
    const r = validarFoto(jpeg(2000));
    expect(r).toMatchObject({ ok: true, mimeType: "image/jpeg", tamanho: 2000 });
    expect(r.ok && r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("aceita exatamente o limite e recusa 1 byte a mais", () => {
    expect(validarFoto(jpeg(FOTO_TAMANHO_MAXIMO)).ok).toBe(true);
    expect(validarFoto(jpeg(FOTO_TAMANHO_MAXIMO + 1))).toMatchObject({ ok: false, erro: expect.stringMatching(/300 KB/) });
  });

  test("recusa JPEG cortado, sem o marcador final", () => {
    const cortado = jpeg(2000).subarray(0, 1999);
    expect(validarFoto(cortado)).toMatchObject({ ok: false, erro: expect.stringMatching(/JPEG/) });
  });

  test("recusa arquivo vazio", () => {
    expect(validarFoto(Buffer.alloc(0))).toMatchObject({ ok: false, erro: expect.stringMatching(/vazia/) });
  });

  test.each([
    ["PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["PDF", Buffer.from("%PDF-1.7 conteudo")],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>")],
    ["texto com extensão de foto", Buffer.from("foto.jpg")],
  ])("recusa %s mesmo que o cliente diga que é imagem", (_nome, conteudo) => {
    expect(validarFoto(conteudo)).toMatchObject({ ok: false, erro: expect.stringMatching(/JPEG/) });
  });
});
