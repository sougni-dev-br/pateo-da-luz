// Chave de um evento para juntar as edições: a mesma série aparece escrita de
// vários jeitos ("23º Congresso X - evento da área médica", "Congresso X 2025",
// "PRÉ-CONGRESSO X"). A chave tira o que muda de um ano para o outro.

const ABREVIACOES: Record<string, string> = {
  CONG: "CONGRESSO",
  CONGRES: "CONGRESSO",
  CONGREESSO: "CONGRESSO",
  BRAS: "BRASILEIRO",
  BRA: "BRASILEIRO",
  BRASILEIRA: "BRASILEIRO",
  INT: "INTERNACIONAL",
  PTA: "PAULISTA",
  MEDIC: "MEDICINA",
  IMUN: "IMUNOLOGIA",
};

// Palavras que não distinguem um evento de outro.
const VAZIAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NA", "NO", "A", "O", "THE", "OF", "AND", "PRE", "EDICAO"]);

const ROMANO = /^(?=[IVXLC])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$/;

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Parte principal do nome: o que vem antes de " - ", " – " ou ":" quando o resto é só
 * a descrição da área ("AFILIADOS BRASIL 2025 - MARKETING DE AFILIADOS").
 */
function partePrincipal(nome: string): string {
  const pedacos = nome.split(/\s[-–]\s|:\s/);
  const primeiro = pedacos[0].trim();
  return primeiro.replace(/[^A-Za-z]/g, "").length >= 3 ? primeiro : nome;
}

export function chaveDoEvento(nome: string): string {
  // "PRÉ-CONGRESSO - 16º Congresso X": a parte antes do traço some inteira, então
  // nesse caso a chave sai do nome completo.
  return chaveDe(partePrincipal(nome)) || chaveDe(nome);
}

function chaveDe(nome: string): string {
  const base = semAcento(nome).toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/PRE[\s-]*CONGRESSO/g, " ")
    .replace(/(19|20)\d{2}\b/g, " ")
    .replace(/\b\d+\s*[ºª°O]?(?=\s|$)/g, " ")
    .replace(/\d+\s*[ºª°]/g, " ")
    .replace(/[^A-Z0-9]+/g, " ");
  const palavras = base.split(" ")
    .filter(Boolean)
    .filter((p) => !/^\d+$/.test(p))
    .filter((p) => !ROMANO.test(p) || p.length > 4)
    .map((p) => ABREVIACOES[p] ?? p)
    .filter((p) => !VAZIAS.has(p));
  return palavras.join(" ");
}

/** Nome para exibir: espaços normalizados, sem o ano no fim. */
export function nomeLimpo(nome: string): string {
  return nome.replace(/\s+/g, " ").replace(/\s*\b(19|20)\d{2}\s*$/, "").trim();
}

/**
 * Nome do evento que se repete, sem o que é da edição: "17º Fórum de Exemplo 2025"
 * vira "Fórum de Exemplo". O nome de cada edição continua com o número.
 */
export function nomeDaSerie(nome: string): string {
  const semEdicao = nomeLimpo(nome)
    .replace(/^\s*\d+\s*[ºª°o]?\s*\.?\s*(edi[cç][aã]o\s*)?[-–:]?\s*/i, "")
    .replace(/^\s*(?=[IVXLC]+\b)M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})\s+/, "")
    .trim();
  return semEdicao.length >= 3 ? semEdicao : nomeLimpo(nome);
}
