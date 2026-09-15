// Identificacao do tipo de arquivo pelos bytes iniciais.
//
// Pela ASSINATURA e nao pela extensao de proposito: foto de celular chega com
// nome esquisito, com extensao trocada, ou sem extensao nenhuma. Mandar ao
// modelo um mimeType errado faz a leitura falhar sem explicacao util.

export type TipoArquivo = "PDF" | "IMAGEM";

export type ArquivoIdentificado = {
  tipo: TipoArquivo;
  /** mimeType real, para enviar ao modelo. */
  mimeType: string;
  rotulo: string;
};

const ASSINATURAS: Array<{ tipo: TipoArquivo; mimeType: string; rotulo: string; casa: (b: Buffer) => boolean }> = [
  {
    tipo: "PDF", mimeType: "application/pdf", rotulo: "PDF",
    casa: (b) => b.length > 4 && b.subarray(0, 4).toString("latin1") === "%PDF",
  },
  {
    tipo: "IMAGEM", mimeType: "image/jpeg", rotulo: "foto JPEG",
    casa: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    tipo: "IMAGEM", mimeType: "image/png", rotulo: "imagem PNG",
    casa: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    tipo: "IMAGEM", mimeType: "image/webp", rotulo: "imagem WebP",
    casa: (b) => b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    // Formato padrao da camera do iPhone. O bloco "ftyp" comeca no byte 4 e a
    // marca (heic/heix/hevc/mif1) vem logo depois.
    tipo: "IMAGEM", mimeType: "image/heic", rotulo: "foto HEIC (iPhone)",
    casa: (b) => {
      if (b.length < 12 || b.subarray(4, 8).toString("latin1") !== "ftyp") return false;
      const marca = b.subarray(8, 12).toString("latin1");
      return ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(marca);
    },
  },
];

export class TipoArquivoNaoSuportadoError extends Error {
  constructor(nomeArquivo: string) {
    super(`"${nomeArquivo}" não é um PDF nem uma foto reconhecida (aceitos: PDF, JPEG, PNG, WebP, HEIC).`);
    this.name = "TipoArquivoNaoSuportadoError";
  }
}

export function identificarArquivo(buffer: Buffer, nomeArquivo: string): ArquivoIdentificado {
  const encontrado = ASSINATURAS.find((assinatura) => assinatura.casa(buffer));
  if (!encontrado) throw new TipoArquivoNaoSuportadoError(nomeArquivo);
  return { tipo: encontrado.tipo, mimeType: encontrado.mimeType, rotulo: encontrado.rotulo };
}
