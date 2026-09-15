import { describe, expect, test } from "vitest";
import { identificarArquivo, TipoArquivoNaoSuportadoError } from "../tipo-arquivo.js";

const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ", "latin1");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp", "latin1"), Buffer.from("heic", "latin1")]);

describe("identificarArquivo", () => {
  test("reconhece PDF", () => {
    expect(identificarArquivo(PDF, "nota.pdf")).toMatchObject({ tipo: "PDF", mimeType: "application/pdf" });
  });

  test("reconhece foto JPEG, que é o formato da câmera", () => {
    expect(identificarArquivo(JPEG, "IMG_0042.jpg")).toMatchObject({ tipo: "IMAGEM", mimeType: "image/jpeg" });
  });

  test("reconhece PNG e WebP", () => {
    expect(identificarArquivo(PNG, "print.png").mimeType).toBe("image/png");
    expect(identificarArquivo(WEBP, "foto.webp").mimeType).toBe("image/webp");
  });

  test("reconhece HEIC do iPhone", () => {
    expect(identificarArquivo(HEIC, "IMG_0042.HEIC")).toMatchObject({ tipo: "IMAGEM", mimeType: "image/heic" });
  });
});

describe("identificarArquivo — não confia na extensão", () => {
  test("foto renomeada como .pdf é tratada como foto", () => {
    // Acontece de verdade: a pessoa renomeia o arquivo achando que converte.
    // Mandar como application/pdf faria a leitura falhar sem explicação útil.
    expect(identificarArquivo(JPEG, "nota.pdf").tipo).toBe("IMAGEM");
  });

  test("PDF com extensão de imagem é tratado como PDF", () => {
    expect(identificarArquivo(PDF, "documento.jpg").tipo).toBe("PDF");
  });

  test("arquivo sem extensão nenhuma é identificado pelo conteúdo", () => {
    expect(identificarArquivo(JPEG, "documento").tipo).toBe("IMAGEM");
  });
});

describe("identificarArquivo — recusa o que não sabe ler", () => {
  test("recusa arquivo de tipo desconhecido com mensagem clara", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(() => identificarArquivo(zip, "notas.zip")).toThrow(TipoArquivoNaoSuportadoError);
    expect(() => identificarArquivo(zip, "notas.zip")).toThrow(/notas\.zip/);
  });

  test("recusa arquivo vazio em vez de mandar nada ao modelo", () => {
    expect(() => identificarArquivo(Buffer.alloc(0), "vazio.pdf")).toThrow(TipoArquivoNaoSuportadoError);
  });

  test("recusa texto solto", () => {
    expect(() => identificarArquivo(Buffer.from("apenas um texto qualquer"), "nota.txt")).toThrow(TipoArquivoNaoSuportadoError);
  });
});
