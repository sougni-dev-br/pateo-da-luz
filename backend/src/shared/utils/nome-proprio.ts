// Padrão de escrita do cadastro de pessoas: nome próprio ("Fulano de Tal Sobrinho",
// "Rua das Flores"), venha em MAIÚSCULAS, minúsculas ou misturado. Mesma regra do PDF do envio à
// contabilidade (frontend: nomeNoEnvio). Não acentua palavra: "SAO" vira "Sao" — acento em
// nome de pessoa só à mão; cidade conhecida ganha o acento pela lista abaixo.

// "di"/"du" ficam de fora: no Brasil "Di Lucia", "Du Pont" são sobrenomes com maiúscula.
const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e"]);
// Algarismo romano ("Pedro II", "Rua XV de Novembro") e sigla de UF ("São Paulo - SP") ficam em
// maiúsculas. "i", "v" e "x" sozinhos ficam de fora: são ambíguos.
const ROMANO = /^(ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/;
const UF = new Set(["ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to"]);
// Depois destas palavras, letra sozinha é identificação ("Bloco E", "Rua A"), não partícula.
const DESIGNADORES = new Set(["rua", "bloco", "bl", "quadra", "qd", "casa", "lote", "lt", "torre", "apto", "ap", "apartamento", "sala", "setor", "ala", "travessa", "viela"]);

const maiuscula = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);

// Inicial maiúscula, inclusive depois de hífen, apóstrofo ("D'Ávila"), parêntese ("(Fundos)")
// e do prefixo "Mc" ("McDonald").
function capitalizar(p: string): string {
  const base = p.split("-").map((parte) => parte.replace(/^([("'’]*)(.)/u, (_, pre: string, c: string) => pre + c.toLocaleUpperCase("pt-BR"))).join("-");
  return base
    .replace(/(['’])(\p{L})/gu, (_, ap: string, c: string) => ap + c.toLocaleUpperCase("pt-BR"))
    .replace(/^Mc(\p{L})/u, (_, c: string) => "Mc" + c.toLocaleUpperCase("pt-BR"));
}

function palavra(original: string, anterior: string | undefined, primeira: boolean): string {
  // Palavra com número ou barra é código ("12B", "SP-280", "S/N"): fica como foi digitada.
  if (/[0-9/]/.test(original)) return original;
  const p = original.toLocaleLowerCase("pt-BR");
  // "(a)" de "Cozinheiro (a)" é marca de gênero: fica minúscula.
  if (/^\(\p{L}\)$/u.test(p)) return p;
  const ant = anterior?.toLocaleLowerCase("pt-BR");
  if (p.length === 1 && ant && DESIGNADORES.has(ant)) return p.toLocaleUpperCase("pt-BR");
  if (!primeira && PARTICULAS.has(p)) return p;
  if (ROMANO.test(p) || (ant === "-" && UF.has(p))) return p.toLocaleUpperCase("pt-BR");
  return capitalizar(p);
}

// continuacao: o texto continua um nome (o Sobrenome continua o Nome), então partícula no
// começo fica minúscula: "da Silva", não "Da Silva".
export function nomeProprio(texto: string | null | undefined, opcoes: { continuacao?: boolean } = {}): string | null {
  if (texto == null) return null;
  const limpo = texto.trim().replace(/\s+/g, " ");
  if (limpo === "") return null;
  const partes = limpo.split(" ");
  return partes.map((p, i) => palavra(p, partes[i - 1], i === 0 && !opcoes.continuacao)).join(" ");
}

// Devolve o acento que o nome completo tem e o texto perdeu, palavra por palavra:
// "Souza Goncalves" + "Fulana Souza Gonçalves" → "Souza Gonçalves". Só troca palavra igual
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
