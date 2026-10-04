// Leitura (OCR) das fotos dos documentos, no navegador de quem confere a ficha. As imagens não
// saem do sistema: só o programa de leitura e o dicionário de português são baixados (uma vez,
// depois ficam no cache do navegador). Bibliotecas carregadas só quando o RH pede a leitura.
import { getArquivoFichaCadastral, type FichaCadastralArquivo } from "../../../api/client";
import type { TextosLidos } from "./conferenciaDocumentos";

/** Documentos de onde dá para tirar dados da ficha (a foto do rosto e "Outro" ficam de fora). */
export const TIPOS_LIDOS = new Set(["DOC_FOTO", "CPF", "CTPS", "TITULO", "COMPROVANTE_ENDERECO", "CERTIDAO", "RESERVISTA"]);

const LARGURA_IDEAL = 1800;
const PAGINAS_PDF = 3;

/** Escala para ~1800 px de largura e passa para tons de cinza com mais contraste: o OCR erra menos. */
async function prepararImagem(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const escala = Math.min(2.5, LARGURA_IDEAL / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.filter = "grayscale(1) contrast(1.35)";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

type Ocr = { reconhecer: (img: HTMLCanvasElement) => Promise<string>; encerrar: () => Promise<void> };

async function abrirOcr(): Promise<Ocr> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por");
  return {
    reconhecer: async (img) => (await worker.recognize(img)).data.text,
    encerrar: async () => { await worker.terminate(); },
  };
}

async function textoDoPdf(blob: Blob, ocr: () => Promise<Ocr>): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    return await lerPdfAberto(await tarefa.promise, ocr);
  } finally {
    await tarefa.destroy();
  }
}

type PdfAberto = Awaited<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>;

async function lerPdfAberto(doc: PdfAberto, ocr: () => Promise<Ocr>): Promise<string> {
  const partes: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, PAGINAS_PDF); p++) {
    const pagina = await doc.getPage(p);
    const conteudo = await pagina.getTextContent();
    // Junta por linha (mesma altura) para os campos ficarem na ordem em que aparecem.
    const linhas = new Map<number, string[]>();
    for (const item of conteudo.items) {
      if (!("str" in item)) continue;
      const y = Math.round(item.transform[5]);
      linhas.set(y, [...(linhas.get(y) ?? []), item.str]);
    }
    partes.push([...linhas.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.join(" ")).join("\n"));
  }
  const texto = partes.join("\n").trim();
  if (texto.length >= 30) return texto;
  // PDF escaneado (sem texto): desenha a 1ª página e lê como imagem.
  const pagina = await doc.getPage(1);
  const viewport = pagina.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await pagina.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return (await ocr()).reconhecer(canvas);
}

export type Progresso = { feitos: number; total: number; atual: string | null };

/**
 * Lê os documentos da ficha e devolve o texto por tipo. Um arquivo que falhar (foto corrompida,
 * formato estranho) não derruba os outros: só não entra na conferência.
 */
export async function lerDocumentos(
  fichaId: string, arquivos: FichaCadastralArquivo[], rotulos: Record<string, string>, onProgresso: (p: Progresso) => void,
  cancelado: () => boolean = () => false,
): Promise<{ textos: TextosLidos; falhas: string[] }> {
  const alvo = arquivos.filter((a) => TIPOS_LIDOS.has(a.tipo));
  const textos: TextosLidos = {};
  const falhas: string[] = [];
  // Promessa guardada: se o leitor não carregar (sem internet), os outros arquivos não tentam de novo.
  let ocr: Promise<Ocr> | null = null;
  const pegarOcr = () => (ocr ??= abrirOcr());
  try {
    for (const [i, a] of alvo.entries()) {
      if (cancelado()) break;
      onProgresso({ feitos: i, total: alvo.length, atual: rotulos[a.tipo] ?? a.tipo });
      try {
        const blob = await getArquivoFichaCadastral(fichaId, a.id);
        const texto = a.mimeType === "application/pdf"
          ? await textoDoPdf(blob, pegarOcr)
          : await (await pegarOcr()).reconhecer(await prepararImagem(blob));
        textos[a.tipo] = [textos[a.tipo], texto].filter(Boolean).join("\n");
      } catch {
        falhas.push(`${rotulos[a.tipo] ?? a.tipo} (${a.nomeOriginal})`);
      }
    }
    // Nada lido porque o leitor nem carregou: o erro dele explica melhor que "não deu para abrir".
    if (ocr && Object.keys(textos).length === 0) await ocr;
    onProgresso({ feitos: alvo.length, total: alvo.length, atual: null });
    return { textos, falhas };
  } finally {
    if (ocr) await (ocr as Promise<Ocr>).then((o) => o.encerrar(), () => undefined);
  }
}
