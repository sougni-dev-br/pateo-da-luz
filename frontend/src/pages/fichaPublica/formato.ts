// Máscaras e conversões do formulário público. A pessoa digita como está acostumada
// (DD/MM/AAAA, 000.000.000-00); o backend recebe AAAA-MM-DD e só algarismos.

export const soDigitos = (v: string) => v.replace(/\D/g, "");

function aplicar(v: string, mascara: string): string {
  const d = soDigitos(v);
  let out = "";
  let i = 0;
  for (const c of mascara) {
    if (i >= d.length) break;
    if (c === "0") out += d[i++];
    else out += c;
  }
  return out;
}

export const mascaraCpf = (v: string) => aplicar(v, "000.000.000-00");
export const mascaraCep = (v: string) => aplicar(v, "00000-000");
export const mascaraData = (v: string) => aplicar(v, "00/00/0000");
export const mascaraPis = (v: string) => aplicar(v, "000.00000.00-0");
export const mascaraTitulo = (v: string) => aplicar(v, "0000 0000 0000");
export function mascaraTelefone(v: string): string {
  const d = soDigitos(v);
  return d.length > 10 ? aplicar(d, "(00) 00000-0000") : aplicar(d, "(00) 0000-00000");
}

/** "10/04/1995" → "1995-04-10"; incompleta ou impossível → null. */
export function dataParaIso(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function isoParaData(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function cpfValido(v: string): boolean {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dig = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = 11 - (s % 11);
    return r >= 10 ? 0 : r;
  };
  return dig(9) === Number(c[9]) && dig(10) === Number(c[10]);
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const LADO_MAXIMO = 2000;
const QUALIDADE = 0.85;
const SEM_COMPRIMIR_ATE = 1.2 * 1024 * 1024;

/**
 * Foto do celular chega com 4–12 MB: reduz para no máximo 2000 px no lado maior, em JPEG.
 * Ainda dá para ler o número do documento e a ficha não estoura o espaço. PDF vai como está.
 */
export async function prepararArquivo(arquivo: File): Promise<{ blob: Blob; nome: string }> {
  if (!arquivo.type.startsWith("image/")) return { blob: arquivo, nome: arquivo.name };
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error("imagem"));
      i.src = url;
    });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth, img.naturalHeight));
    if (escala === 1 && arquivo.size <= SEM_COMPRIMIR_ATE && /jpe?g|png/.test(arquivo.type)) return { blob: arquivo, nome: arquivo.name };
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALIDADE));
    if (!blob) return { blob: arquivo, nome: arquivo.name };
    return { blob, nome: arquivo.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    // Formato que o navegador não abre (HEIC no Android, por exemplo): o servidor responde.
    return { blob: arquivo, nome: arquivo.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Endereço pelo CEP (ViaCEP). Falha em silêncio: a pessoa digita o endereço. */
export async function buscarCep(cep: string): Promise<{ endereco: string; bairro: string; cidade: string; uf: string } | null> {
  const d = soDigitos(cep);
  if (d.length !== 8) return null;
  try {
    const controle = new AbortController();
    const tempo = window.setTimeout(() => controle.abort(), 5000);
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: controle.signal });
    window.clearTimeout(tempo);
    if (!r.ok) return null;
    const j = await r.json() as Record<string, string>;
    if (j.erro) return null;
    return { endereco: j.logradouro ?? "", bairro: j.bairro ?? "", cidade: j.localidade ?? "", uf: j.uf ?? "" };
  } catch {
    return null;
  }
}
