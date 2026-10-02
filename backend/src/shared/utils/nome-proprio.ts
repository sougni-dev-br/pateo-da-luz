// Padrão de escrita do cadastro de pessoas: nome próprio ("Antonio Sales Viana Sobrinho",
// "Rua Paim"), venha em MAIÚSCULAS, minúsculas ou misturado. Mesma regra do PDF do envio à
// contabilidade (frontend: nomeNoEnvio). Não acentua palavra: "SAO" vira "Sao" — acento em
// nome de pessoa só à mão; cidade conhecida ganha o acento pela lista abaixo.

const PARTICULAS = new Set(["da", "de", "di", "do", "du", "das", "dos", "e"]);
// Algarismo romano no fim de nome ("Pedro II") e sigla de UF ("São Paulo - SP") ficam em maiúsculas.
const ROMANO = /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/;
const UF = new Set(["ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to"]);

function palavra(p: string, primeira: boolean, depoisDeTraco: boolean): string {
  if (!primeira && PARTICULAS.has(p)) return p;
  if (ROMANO.test(p) || (depoisDeTraco && UF.has(p))) return p.toLocaleUpperCase("pt-BR");
  // "P-18" ou "joão-pedro": cada parte com inicial maiúscula.
  return p.split("-").map((s) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1)).join("-");
}

// continuacao: o texto continua um nome (o Sobrenome continua o Nome), então partícula no
// começo fica minúscula: "da Silva", não "Da Silva".
export function nomeProprio(texto: string | null | undefined, opcoes: { continuacao?: boolean } = {}): string | null {
  if (texto == null) return null;
  const limpo = texto.trim().replace(/\s+/g, " ");
  if (limpo === "") return null;
  const partes = limpo.toLocaleLowerCase("pt-BR").split(" ");
  return partes.map((p, i) => palavra(p, i === 0 && !opcoes.continuacao, partes[i - 1] === "-")).join(" ");
}

// Devolve o acento que o nome completo tem e o texto perdeu, palavra por palavra:
// "Mendes Goncalves" + "Juliana Mendes Gonçalves" → "Mendes Gonçalves". Só troca palavra igual
// sem contar acento e caixa; o resto fica como está.
export function acentosDoNomeCompleto(texto: string | null, nomeCompleto: string | null): string | null {
  if (!texto || !nomeCompleto) return texto;
  const doCompleto = new Map(nomeCompleto.split(/\s+/).map((p) => [chave(p), p]));
  return texto.split(" ").map((p) => {
    const outra = doCompleto.get(chave(p));
    const temAcento = outra != null && /[̀-ͯ]/.test(outra.normalize("NFD"));
    return temAcento ? outra : p;
  }).join(" ");
}

// Cidades da região com acento. Chave sem acento e em minúsculas.
const CIDADES: Record<string, string> = Object.fromEntries([
  "São Paulo", "Carapicuíba", "Osasco", "Barueri", "Jandira", "Itapevi", "Cotia", "Taboão da Serra",
  "Embu das Artes", "Itapecerica da Serra", "Guarulhos", "Santo André", "São Bernardo do Campo",
  "São Caetano do Sul", "Diadema", "Mauá", "Ribeirão Pires", "Poá", "Suzano", "Mogi das Cruzes",
  "Itaquaquecetuba", "Ferraz de Vasconcelos", "Arujá", "Francisco Morato", "Franco da Rocha", "Caieiras",
  "Cajamar", "Santana de Parnaíba", "Embu-Guaçu", "Juquitiba", "São Lourenço da Serra", "Vargem Grande Paulista",
].map((c) => [chave(c), c]));

function chave(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

// Cidade no padrão, com acento quando é uma das cidades da lista. Aceita "SAO PAULO - SP"
// (naturalidade): só a parte da cidade é procurada na lista.
export function cidadeProprio(texto: string | null | undefined): string | null {
  const base = nomeProprio(texto);
  if (base == null) return null;
  const [cidade, ...resto] = base.split(" - ");
  const comAcento = CIDADES[chave(cidade)] ?? cidade;
  return [comAcento, ...resto].join(" - ");
}
