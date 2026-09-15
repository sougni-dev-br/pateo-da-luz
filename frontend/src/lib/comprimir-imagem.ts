// Reduz a foto ANTES de enviar.
//
// Foto de celular sai com 4-8 MB. Em base64 isso cresce mais um terço, e cinco
// fotos passam do limite do servidor. Reduzir aqui tambem deixa a leitura mais
// rapida e mais barata.
//
// O lado delicado: comprimir demais borra digito, e digito borrado vira valor
// errado na contabilidade. Por isso a resolucao é generosa (2400px no maior
// lado, que mantem legivel o corpo de uma nota fiscal) e a qualidade é alta.

const LADO_MAXIMO = 2400;
const QUALIDADE = 0.9;
/** Abaixo disto nao vale mexer: recomprimir so degrada. */
const TAMANHO_MINIMO_PARA_COMPRIMIR = 900 * 1024;

export type ArquivoPreparado = {
  nome: string;
  base64: string;
  bytesOriginais: number;
  bytesEnviados: number;
  comprimida: boolean;
};

function lerComoDataUrl(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Prepara um arquivo para envio. PDF passa intacto. Imagem grande é
 * redimensionada; se o navegador não souber decodificar (HEIC do iPhone, por
 * exemplo), o original segue como está — o servidor lê HEIC de qualquer forma.
 */
export async function prepararArquivo(arquivo: File): Promise<ArquivoPreparado> {
  const bytesOriginais = arquivo.size;
  const ehImagem = arquivo.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(arquivo.name);

  if (!ehImagem || bytesOriginais <= TAMANHO_MINIMO_PARA_COMPRIMIR) {
    return {
      nome: arquivo.name,
      base64: await lerComoDataUrl(arquivo),
      bytesOriginais,
      bytesEnviados: bytesOriginais,
      comprimida: false,
    };
  }

  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const largura = Math.round(bitmap.width * escala);
    const altura = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("canvas indisponível");
    contexto.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();

    const dataUrl = canvas.toDataURL("image/jpeg", QUALIDADE);
    const bytesEnviados = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);

    // Se a "compressão" ficou maior que o original, não vale usar.
    if (bytesEnviados >= bytesOriginais) {
      return {
        nome: arquivo.name,
        base64: await lerComoDataUrl(arquivo),
        bytesOriginais,
        bytesEnviados: bytesOriginais,
        comprimida: false,
      };
    }

    return {
      nome: arquivo.name.replace(/\.(heic|heif|png|webp)$/i, ".jpg"),
      base64: dataUrl,
      bytesOriginais,
      bytesEnviados,
      comprimida: true,
    };
  } catch {
    // HEIC no Chrome cai aqui: o navegador não decodifica, mas o servidor lê.
    return {
      nome: arquivo.name,
      base64: await lerComoDataUrl(arquivo),
      bytesOriginais,
      bytesEnviados: bytesOriginais,
      comprimida: false,
    };
  }
}
