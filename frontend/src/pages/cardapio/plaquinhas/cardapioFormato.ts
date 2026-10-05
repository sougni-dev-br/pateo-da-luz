import type { BuffetMenuSection, MenuFace } from "../../../api/client";

// Seções que a casa costuma usar, já com o inglês. "Outra" deixa escrever as duas.
export const SECOES_MODELO: Array<{ titlePt: string; titleEn: string; face: MenuFace }> = [
  { titlePt: "Antepastos", titleEn: "Antipasti", face: "front" },
  { titlePt: "Entradas", titleEn: "Starters", face: "front" },
  { titlePt: "Saladas", titleEn: "Salads", face: "front" },
  { titlePt: "Pratos à la carte", titleEn: "À la carte main courses", face: "back" },
  { titlePt: "Pratos principais", titleEn: "Main courses", face: "back" },
  { titlePt: "Acompanhamentos", titleEn: "Side dishes", face: "back" },
  { titlePt: "Sobremesas", titleEn: "Desserts", face: "back" },
  { titlePt: "Bebidas", titleEn: "Drinks", face: "back" },
  // Coffee break
  { titlePt: "Salgados", titleEn: "Savory snacks", face: "front" },
  { titlePt: "Lanches", titleEn: "Sandwiches", face: "front" },
  { titlePt: "Geleias", titleEn: "Jams", face: "front" },
  { titlePt: "Doces", titleEn: "Sweets", face: "back" },
  { titlePt: "Bolos", titleEn: "Cakes", face: "back" },
];

// Inglês dos títulos de seção que a casa costuma usar. Quem escreve um título conhecido não
// precisa digitar o inglês: ele entra sozinho ao sair do campo (e pode ser trocado).
const OUTROS_TITULOS: Array<[string, string]> = [
  ["Saladas", "Salads"], ["Pratos quentes", "Hot dishes"], ["Massas", "Pasta"], ["Risotos", "Risottos"], ["Carnes", "Meats"],
  ["Aves", "Poultry"], ["Peixes", "Fish"], ["Peixes e frutos do mar", "Fish and seafood"], ["Guarnições", "Side dishes"],
  ["Molhos", "Sauces"], ["Sopas", "Soups"], ["Frutas", "Fruits"], ["Pães", "Breads"], ["Frios", "Cold cuts"], ["Petiscos", "Snacks"],
  ["Canapés", "Canapés"], ["Finger food", "Finger food"], ["Sobremesa", "Dessert"], ["Doce", "Sweet"], ["Bolo", "Cake"],
  ["Bebidas quentes", "Hot drinks"], ["Bebidas geladas", "Cold drinks"], ["Sucos", "Juices"], ["Café da manhã", "Breakfast"],
  ["Coffee break", "Coffee break"], ["Almoço", "Lunch"], ["Jantar", "Dinner"], ["Lanche", "Snack"], ["Salgado", "Savory snack"],
  ["Principais", "Main courses"], ["Prato principal", "Main course"], ["Entrada", "Starter"], ["Acompanhamento", "Side dish"],
];
const INGLES_DOS_TITULOS = new Map(
  [...SECOES_MODELO.map((m) => [m.titlePt, m.titleEn] as [string, string]), ...OUTROS_TITULOS].map(([pt, en]) => [chaveTitulo(pt), en]),
);
function chaveTitulo(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}
export const inglesDoTitulo = (titulo: string) => INGLES_DOS_TITULOS.get(chaveTitulo(titulo));

// Tamanho de cada face, em mm. "Display de acrílico" é o bolso do display da casa
// (9,5 × 9,2 cm medidos com régua), com folga de 1–2 mm para o papel entrar.
export const TAMANHO_DISPLAY = { largura: 94, altura: 90 };
export const TAMANHOS_FACE: Array<{ id: string; nome: string; largura: number; altura: number }> = [
  { id: "display", nome: "Display de acrílico", ...TAMANHO_DISPLAY },
  { id: "a6", nome: "A6", largura: 105, altura: 148 },
  { id: "a5", nome: "A5", largura: 148, altura: 210 },
];

export const MAX_DISPLAYS = 20;
export const MARGEM_FOLHA_MM = 8;
const A4 = { curto: 210, longo: 297 };

export type Orientacao = "portrait" | "landscape";
export type LayoutFolha = { orientacao: Orientacao; colunas: number; linhas: number; porFolha: number };

// Escolhe em pé ou deitada pelo que cabe mais faces. Empate: a que deixa frente e verso lado a lado
// (número par de colunas), que é como a planilha imprimia.
export function layoutDaFolha(largura: number, altura: number): LayoutFolha | null {
  const opcoes = (["portrait", "landscape"] as const).map((orientacao) => {
    const [w, h] = orientacao === "portrait" ? [A4.curto, A4.longo] : [A4.longo, A4.curto];
    const colunas = Math.floor((w - 2 * MARGEM_FOLHA_MM) / largura);
    const linhas = Math.floor((h - 2 * MARGEM_FOLHA_MM) / altura);
    return { orientacao, colunas, linhas, porFolha: colunas * linhas };
  }).filter((o) => o.porFolha > 0);
  if (!opcoes.length) return null;
  opcoes.sort((a, b) => b.porFolha - a.porFolha || Number(b.colunas % 2 === 0) - Number(a.colunas % 2 === 0));
  return opcoes[0];
}

// "same": o mesmo cardápio (frente e verso) em todos os displays.
// "perSection": cada seção é um display, com o mesmo texto na frente e no verso.
// "perItem": cada prato é um display (o nome da seção vai em cima, pequeno).
export type Distribuicao = "same" | "perSection" | "perItem";

/** Um display por seção ou por prato: frente e verso iguais. */
export const umPorDisplay = (d: Distribuicao) => d !== "same";

// Com um prato só na face, a letra pode crescer bem mais que no cardápio cheio.
export const FONTE_MAX_PRATO = 30;

/** O conteúdo de uma face: as seções que vão nela e se leva o logo. A letra é ajustada por grupo. */
export type GrupoFace = { chave: string; rotulo: string; secoes: BuffetMenuSection[]; comLogo: boolean; maxPt?: number; umPrato?: boolean;
  /** Cópias deste display na folha; sem valor, vale o número geral de displays. */
  copias?: number };

/** Chaves de edição (estáveis ao reordenar/apagar) de cada seção e de cada prato, na mesma ordem. */
export type ChavesDasSecoes = Array<{ secao: string; itens: string[] }>;

// A chave do grupo vem da chave de edição quando existe: "escolher displays" continua apontando
// para o mesmo prato mesmo depois de subir, descer ou apagar outro.
export function gruposDasFaces(secoes: BuffetMenuSection[], distribuicao: Distribuicao, chaves?: ChavesDasSecoes): GrupoFace[] {
  const chaveSecao = (i: number) => chaves?.[i]?.secao ?? `s${i}`;
  const chaveItem = (i: number, j: number) => `${chaveSecao(i)}:${chaves?.[i]?.itens[j] ?? j}`;
  if (distribuicao === "perItem") {
    return secoes.flatMap((s, i) => s.items.map((item, j) => ({
      chave: chaveItem(i, j), rotulo: `em “${item.namePt.trim() || `prato ${j + 1}`}”`, secoes: [{ ...s, items: [item] }], comLogo: true, maxPt: FONTE_MAX_PRATO, umPrato: true, copias: item.qty ?? 1,
    })));
  }
  if (distribuicao === "perSection") {
    return secoes.map((s, i) => ({ chave: chaveSecao(i), rotulo: `em “${s.titlePt.trim() || `Seção ${i + 1}`}”`, secoes: [s], comLogo: true }));
  }
  const frente = secoes.filter((s) => s.face === "front");
  const verso = secoes.filter((s) => s.face === "back");
  // Tudo marcado como verso: o verso vira a frente (com logo), em vez de sair uma frente em branco.
  if (!frente.length) return verso.length ? [{ chave: "front", rotulo: "na frente", secoes: verso, comLogo: true }] : [];
  const grupos: GrupoFace[] = [{ chave: "front", rotulo: "na frente", secoes: frente, comLogo: true }];
  if (verso.length) grupos.push({ chave: "back", rotulo: "no verso", secoes: verso, comLogo: false });
  return grupos;
}

export type FaceImpressa = { chave: string; grupo: string; face: MenuFace; display: number };

// Cada display leva a frente e, ao lado, o verso. No "um por seção", frente e verso repetem a seção.
export function facesParaImprimir(grupos: GrupoFace[], displays: number, distribuicao: Distribuicao): FaceImpressa[] {
  const faces: FaceImpressa[] = [];
  if (umPorDisplay(distribuicao)) {
    let display = 0;
    for (const g of grupos) {
      for (let c = 1; c <= (g.copias ?? displays); c++) {
        display++;
        faces.push({ chave: `${display}-front`, grupo: g.chave, face: "front", display });
        faces.push({ chave: `${display}-back`, grupo: g.chave, face: "back", display });
      }
    }
    return faces;
  }
  for (let d = 1; d <= displays; d++) {
    for (const g of grupos) faces.push({ chave: `${d}-${g.chave}`, grupo: g.chave, face: g.chave === "back" ? "back" : "front", display: d });
  }
  return faces;
}

const vazio = (s: string) => s.trim().length < 2;

// O que impede salvar ou imprimir, dito do jeito que a pessoa encontra na tela.
export function pendenciasDoCardapio(nome: string, secoes: BuffetMenuSection[]): string[] {
  const p: string[] = [];
  if (vazio(nome)) p.push("Dê um nome para o cardápio.");
  if (!secoes.length) p.push("Adicione pelo menos uma seção.");
  secoes.forEach((s, i) => {
    const rotulo = s.titlePt.trim() || `Seção ${i + 1}`;
    if (vazio(s.titlePt)) p.push(`${rotulo}: escreva o título.`);
    if (vazio(s.titleEn)) p.push(`${rotulo}: falta o título em inglês.`);
    if (!s.items.length) p.push(`${rotulo}: adicione pelo menos um prato.`);
    s.items.forEach((it, j) => {
      if (vazio(it.namePt)) p.push(`${rotulo}, prato ${j + 1}: escreva o nome.`);
      else if (vazio(it.nameEn)) p.push(`${rotulo}: falta o inglês de “${it.namePt.trim()}”.`);
    });
  });
  return p;
}

export const cm = (mm: number) => (mm / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
