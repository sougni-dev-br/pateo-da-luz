import type { BuffetPlateItem, PlateFormat, PlateListKind, PlateTheme } from "../../../api/client";

export const ROTA_PLAQUINHAS = "/cardapio/plaquinhas";

export const CATEGORIAS = [
  "Arroz e grãos", "Massas", "Risotos", "Carnes", "Aves", "Peixes e frutos do mar", "Guarnições",
  "Salgados", "Entradas", "Sopas e cremes", "Sobremesas", "Molhos", "Coffee break", "Bebidas",
] as const;

export const TIPOS_LISTA: Array<{ value: PlateListKind; label: string }> = [
  { value: "BUFFET", label: "Buffet do dia" },
  { value: "COFFEE_BREAK", label: "Coffee break" },
  { value: "EVENTO", label: "Evento" },
];

export const TEMAS: Array<{ value: PlateTheme; label: string; dica: string }> = [
  { value: "wine", label: "Vinho", dica: "Fundo branco, gasta pouca tinta" },
  { value: "gold", label: "Preto e dourado", dica: "Marque “Gráficos de plano de fundo”" },
  { value: "white", label: "Branco e dourado", dica: "O inverso da preta, gasta pouca tinta" },
];

// O formato que cada tipo de lista costuma usar: coffee break em stand fica melhor de pé.
export const FORMATO_SUGERIDO: Record<PlateListKind, PlateFormat> = { BUFFET: "std", COFFEE_BREAK: "tent", EVENTO: "tent" };

export const MAX_QTD = 20;
const MAX_RESULTADOS = 40;

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Procura por partes do nome, em português ou inglês, sem ligar para acento.
export function buscarPratos(catalogo: BuffetPlateItem[], texto: string, categoria: string | null): BuffetPlateItem[] {
  const termos = semAcento(texto).split(/\s+/).filter(Boolean);
  if (!termos.length && !categoria) return [];
  const achados = catalogo.filter((p) => {
    if (!p.isActive || (categoria && p.category !== categoria)) return false;
    const alvo = `${semAcento(p.namePt)} ${semAcento(p.nameEn)}`;
    return termos.every((t) => alvo.includes(t));
  });
  const inicio = termos.join(" ");
  achados.sort((a, b) => Number(semAcento(b.namePt).startsWith(inicio)) - Number(semAcento(a.namePt).startsWith(inicio)) || a.namePt.localeCompare(b.namePt, "pt-BR"));
  return termos.length ? achados.slice(0, MAX_RESULTADOS) : achados;
}

// Correções simples para quem cadastra prato novo digitando rápido.
const CORRECOES: Array<[RegExp, string]> = [
  [/\bc\/\s*/gi, "com "], [/\bfilet\b/gi, "filé"], [/\bfarfale\b/gi, "farfalle"], [/\bfett?ucc?ine\b/gi, "fettuccine"],
  [/\bbolanhesa\b/gi, "bolonhesa"], [/\bbrocolis\b|\bbrocólis\b/gi, "brócolis"], [/\bmolho rose\b/gi, "molho rosé"],
  [/\bcôco\b/gi, "coco"], [/\bmoida\b/gi, "moída"], [/\bgeléia\b/gi, "geleia"], [/\balho por[oó]\b/gi, "alho-poró"],
  [/\bcouve flor\b/gi, "couve-flor"], [/\bbatata doce\b/gi, "batata-doce"], [/\bbanana da terra\b/gi, "banana-da-terra"],
  [/\b4 queijos\b/gi, "quatro queijos"], [/\b3 queijos\b/gi, "três queijos"], [/\bmolho mostarda\b/gi, "molho de mostarda"],
  [/\bmussarela\b/gi, "muçarela"], [/\bsaint peter\b/gi, "Saint Peter"], [/\bcatupiry\b/gi, "Catupiry"],
];

// Sugere a categoria pelo começo do nome: "Bolo de…" vai para onde estão os outros bolos.
export function sugerirCategoria(catalogo: BuffetPlateItem[], nome: string): string | undefined {
  const primeira = semAcento(nome).trim().split(/\s+/)[0];
  if (!primeira) return undefined;
  const contagem = new Map<string, number>();
  for (const p of catalogo) {
    if (p.isActive && semAcento(p.namePt).split(/\s+/)[0] === primeira) contagem.set(p.category, (contagem.get(p.category) ?? 0) + 1);
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function arrumarNome(bruto: string): string {
  let s = bruto.replace(/\s+/g, " ").trim();
  for (const [re, troca] of CORRECOES) s = s.replace(re, troca);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dataCurta(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function rotuloLista(l: { name: string; eventDate: string | null; plateCount: number }): string {
  return `${l.name}${l.eventDate ? ` · ${dataCurta(l.eventDate)}` : ""} · ${l.plateCount} ${l.plateCount === 1 ? "plaquinha" : "plaquinhas"}`;
}

/** formato: escolhido só para este prato; sem valor, segue a regra de formatoDaEntrada. */
export type Entrada = { key: string; itemId: string; qty: number; formato?: PlateFormat };

/**
 * Formato em que o prato sai: o escolhido nele; senão, molho sai no formato molho (o pote
 * pede a plaquinha pequena) e o resto segue o formato da lista.
 */
export function formatoDaEntrada(e: Pick<Entrada, "formato">, prato: Pick<BuffetPlateItem, "category"> | undefined, formatoLista: PlateFormat): PlateFormat {
  if (e.formato) return e.formato;
  return prato?.category === "Molhos" && formatoLista !== "sauce" ? "sauce" : formatoLista;
}

/** O outro formato que o botão do prato oferece: molho numa lista de plaquinhas, plaquinha numa de molhos. */
export const formatoAlternativo = (formatoLista: PlateFormat): PlateFormat => (formatoLista === "sauce" ? "std" : "sauce");

let proximaChave = 0;
export const novaEntrada = (itemId: string, qty = 1, formato?: PlateFormat): Entrada => ({ key: `e${++proximaChave}`, itemId, qty, ...(formato ? { formato } : {}) });

// Agrupa na ordem do buffet (arroz, massas, carnes…, sobremesas, molhos), mantendo a ordem
// que a pessoa já tinha dentro de cada categoria. Prato sumido do catálogo vai para o fim.
export function ordenarPorCategoria(entradas: Entrada[], porId: Map<string, BuffetPlateItem>): Entrada[] {
  const posicao = (e: Entrada) => {
    const c = porId.get(e.itemId)?.category;
    const i = c ? (CATEGORIAS as readonly string[]).indexOf(c) : -1;
    return i === -1 ? CATEGORIAS.length : i;
  };
  return entradas.map((e, i) => ({ e, i })).sort((a, b) => posicao(a.e) - posicao(b.e) || a.i - b.i).map(({ e }) => e);
}

// Adiciona o prato ou, se já está na folha, soma uma plaquinha. Devolve a chave para destacar.
export function adicionarEntrada(entradas: Entrada[], itemId: string, nova: Entrada = novaEntrada(itemId)): { entradas: Entrada[]; chave: string } {
  const existente = entradas.find((e) => e.itemId === itemId);
  if (existente) {
    return { entradas: entradas.map((e) => (e === existente ? { ...e, qty: Math.min(MAX_QTD, e.qty + 1) } : e)), chave: existente.key };
  }
  return { entradas: [...entradas, nova], chave: nova.key };
}
