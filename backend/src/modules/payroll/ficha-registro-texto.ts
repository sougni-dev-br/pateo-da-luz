// Texto da ficha de registro (PDF da contabilidade) com as colunas preservadas, sem depender de
// programa externo. O leitor da ficha (ficha-registro-parser) foi escrito sobre a saída do
// `pdftotext -layout`, que o servidor não tem; aqui o mesmo formato é remontado a partir da
// posição de cada trecho de texto que o pdfjs devolve: trechos na mesma altura formam uma linha,
// e o vão entre dois trechos vira espaços (dois ou mais = troca de coluna).

export type Trecho = { texto: string; x: number; y: number; largura: number; altura: number };

// Trechos cuja altura difere menos que isto estão na mesma linha (em pontos do PDF).
const TOLERANCIA_LINHA = 2.5;
// Largura média de um caractere, relativa à altura da fonte: serve para converter vão em espaços.
const LARGURA_CARACTERE = 0.5;
// Vão até este múltiplo da altura da fonte é espaço comum (1); acima disso é troca de coluna (2 ou mais).
const VAO_ESPACO_COMUM = 1.2;

// Pura: monta as linhas de UMA página a partir dos trechos de texto.
export function linhasDaPagina(trechos: readonly Trecho[]): string[] {
  const validos = trechos.filter((t) => t.texto.trim() !== "");
  // De cima para baixo (y do PDF cresce para cima).
  const porAltura = [...validos].sort((a, b) => b.y - a.y || a.x - b.x);
  const linhas: Trecho[][] = [];
  for (const t of porAltura) {
    const ultima = linhas.at(-1);
    if (ultima && Math.abs(ultima[0].y - t.y) <= TOLERANCIA_LINHA) ultima.push(t);
    else linhas.push([t]);
  }
  const montadas = linhas.map((l) => {
    const ordenada = [...l].sort((a, b) => a.x - b.x);
    let texto = "";
    let fim = 0;
    for (const t of ordenada) {
      if (texto === "") {
        texto = " ".repeat(Math.max(0, Math.round(t.x / (Math.max(t.altura, 1) * LARGURA_CARACTERE))));
      } else {
        const largura = Math.max(t.altura, 1) * LARGURA_CARACTERE;
        const vao = t.x - fim;
        const vaoEmAlturas = vao / Math.max(t.altura, 1);
        const espacos = vao <= largura * 0.3 ? 0 : vaoEmAlturas <= VAO_ESPACO_COMUM ? 1 : Math.max(2, Math.round(vao / largura));
        texto += " ".repeat(espacos);
      }
      texto += t.texto;
      fim = t.x + t.largura;
    }
    return texto.replace(/\s+$/, "");
  });
  // O leitor ancora rótulos no início da linha: a margem esquerda não carrega informação.
  return montadas.map((l) => l.trimStart());
}

// Uma ficha ocupa 1 a 3 páginas: acima disso o arquivo não é um lote de fichas razoável.
export const MAX_PAGINAS = 150;
const TEMPO_MAXIMO_MS = 30_000;

export class PdfInvalidoError extends Error {}

// Lê o PDF e devolve o texto, uma página depois da outra, com as colunas preservadas.
export async function textoLayoutDoPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer), verbosity: 0, isEvalSupported: false, enableXfa: false, disableFontFace: true, stopAtErrors: true,
  }).promise.catch(() => {
    throw new PdfInvalidoError("o PDF está corrompido ou protegido");
  });
  try {
    if (doc.numPages > MAX_PAGINAS) throw new PdfInvalidoError(`o PDF tem ${doc.numPages} páginas (máximo ${MAX_PAGINAS})`);
    const limite = Date.now() + TEMPO_MAXIMO_MS;
    const paginas: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (Date.now() > limite) throw new PdfInvalidoError("a leitura do PDF demorou demais");
      const pagina = await doc.getPage(n);
      const conteudo = await pagina.getTextContent();
      const trechos: Trecho[] = [];
      for (const i of conteudo.items) {
        if (!("str" in i)) continue;
        trechos.push({ texto: i.str, x: i.transform[4], y: i.transform[5], largura: i.width, altura: i.height });
      }
      paginas.push(linhasDaPagina(trechos).join("\n"));
    }
    return paginas.join("\n");
  } finally {
    await doc.destroy();
  }
}
