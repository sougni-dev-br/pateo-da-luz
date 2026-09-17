// Conversao entre a unidade em que se COMPRA e a unidade em que se CONTA.
//
// O problema que isto resolve: a nota chega em caixa/fardo/pacote e o estoquista
// conta na unidade que da para contar. Ninguem abre uma caixa de 800 sacos para
// contar saco a saco — conta-se o pacote. Quando as duas grandezas se misturam,
// o custo unitario do estoque vira o custo da caixa inteira.
//
// Caso real (SACO AMOSTRA TARJA 12X30 C800, agosto/2026): a caixa de 800 entrou
// como "1 UN a R$ 113,16", a contagem registrou "720 UN", e o inventario valorou
// 720 x 113,16 = R$ 81.475,20 em vez de R$ 101,84. O inventario de agosto ficou
// 2,4x maior que o mes anterior por causa de um item.
//
// Nada aqui aplica conversao sozinho. `detectarEmbalagem` SUGERE a partir do nome
// do produto; quem decide e o cadastro. Deduzir fator de conversao do nome e
// aplicar direto no custo seria trocar um numero errado por outro.

export type UnitConversion = {
  fromUnit: string;
  toUnit: string;
  factor: number;
};

/** Conversoes que valem para qualquer produto: massa e volume sao fisica. */
const FATORES_UNIVERSAIS: Record<string, number> = {
  "G>KG": 0.001,
  "KG>G": 1000,
  "ML>L": 0.001,
  "L>ML": 1000
};

/** Grafias que significam a mesma unidade. A base tem as tres para "unidade". */
const SINONIMOS: Record<string, string> = {
  UNI: "UN",
  UND: "UN",
  UNIDADE: "UN",
  UNIDADES: "UN",
  CAIXA: "CX",
  PCTE: "PCT",
  PACOTE: "PCT",
  FARDO: "FD",
  LT: "L",
  LTS: "L",
  LITRO: "L",
  LITROS: "L",
  GR: "G",
  GRS: "G",
  GRAMA: "G",
  GRAMAS: "G",
  K: "KG",
  KGS: "KG",
  QUILO: "KG",
  KILO: "KG"
};

export function normalizarUnidade(unit: unknown): string {
  const bruto = String(unit ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.+$/, "");
  return SINONIMOS[bruto] ?? bruto;
}

/**
 * Quantos "toUnit" cabem em 1 "fromUnit". null quando nao ha como saber.
 *
 * A conversao cadastrada no produto vem antes da universal: um pacote pode
 * pesar 0,7 KG neste produto e 2 KG em outro.
 */
export function resolveUnitFactor(
  fromUnit: unknown,
  toUnit: unknown,
  conversions: UnitConversion[]
): number | null {
  const from = normalizarUnidade(fromUnit);
  const to = normalizarUnidade(toUnit);
  if (!from || !to) return null;
  if (from === to) return 1;

  const direct = conversions.find(
    (c) => normalizarUnidade(c.fromUnit) === from && normalizarUnidade(c.toUnit) === to
  );
  if (direct && Number.isFinite(direct.factor) && direct.factor > 0) return direct.factor;

  const inverse = conversions.find(
    (c) => normalizarUnidade(c.fromUnit) === to && normalizarUnidade(c.toUnit) === from
  );
  if (inverse && Number.isFinite(inverse.factor) && inverse.factor > 0) return 1 / inverse.factor;

  return FATORES_UNIVERSAIS[`${from}>${to}`] ?? null;
}

// ─── Leitura da embalagem escrita no nome do produto ────────────────────────────
//
// Os nomes da base carregam a embalagem por convencao do fornecedor: "C800",
// "C/1000", "CX 60", "50UNI". O mesmo nome tambem carrega medida e dimensao —
// "SACO AMOSTRA TARJA 12X30 C800" tem dimensao (12x30 cm) e embalagem (800).
// Ler "12X30" como embalagem seria pior que nao ler nada, entao so contam
// trechos com marcador explicito de embalagem (C, C/, CX, PCT, UNI).

export type NivelEmbalagem = "pacote" | "caixa";

export type EmbalagemDetectada = {
  /** Quantas unidades (ou quanto peso/volume) a embalagem contem. */
  quantidade: number;
  /** Unidade do conteudo quando o nome diz ("C/5KG"); null = contagem simples. */
  unidade: string | null;
  /** O trecho do nome que gerou a leitura, para a tela mostrar a origem. */
  trecho: string;
  nivel: NivelEmbalagem;
  /**
   * "baixa" quando o numero provavelmente descreve o PRODUTO e nao a embalagem:
   * "C/1000 FOLHAS" num papel higienico sao folhas por rolo, nao rolos por pacote.
   */
  confianca: "alta" | "baixa";
};

/** Sufixos que indicam conteudo do proprio produto, nao contagem de embalagem. */
const SUFIXOS_DO_PRODUTO = new Set(["FOLHAS", "FOLHA", "MTRS", "MTS", "CM", "MM"]);
const SUFIXOS_DE_MEDIDA = new Set(["KG", "G", "L", "ML"]);

// So estes tokens contam como sufixo. Capturar "qualquer palavra" fazia
// "C/40 CX" levar o CX junto e "C50X20" levar o X — sufixo errado desloca a
// leitura inteira. Os mais longos vem primeiro para KG nao ser lido como K.
const SUFIXO = "(?:KGS|KG|GRS|GR|MTRS|MTS|FOLHAS|FOLHA|UNI|UND|ML|LTS|LT|CM|MM|K|G|L)";
const ini = "(?:^|[\\s.,\\-(])";
const num = "(\\d+(?:[.,]\\d+)?)";

const PADROES: Array<{ re: RegExp; nivel: NivelEmbalagem }> = [
  // C/40 · C/1000 FOLHAS · C/5KG — o marcador mais comum na base.
  { re: new RegExp(`${ini}C\\s*\\/\\s*${num}\\s*(${SUFIXO})?\\b`, "gi"), nivel: "pacote" },
  // C800 · C500 · C25 · C 400 — sem barra.
  { re: new RegExp(`${ini}C\\s*${num}(?![\\d.,])\\s*(${SUFIXO})?\\b`, "gi"), nivel: "pacote" },
  // 50UNI · 100UNI · 50 UNI · 12 UNI
  { re: /(\d+(?:[.,]\d+)?)\s*(UNI|UND|UNIDADES?)\b/gi, nivel: "pacote" },
  // PCT 500G · PCTE 2KG · PT 700G
  { re: new RegExp(`${ini}(?:PCTE?|PT)\\s*${num}(?![\\d.,])\\s*(${SUFIXO})?\\b`, "gi"), nivel: "pacote" },
  // CX 60 · CX20 · CAIXA 500G — o nivel de fora, caixa que agrupa pacotes.
  { re: new RegExp(`${ini}(?:CX|CAIXA|FD|FARDO)\\.?\\s*\\/?\\s*${num}(?![\\d.,])\\s*(${SUFIXO})?\\b`, "gi"), nivel: "caixa" }
];

function numeroPtBr(texto: string): number {
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

/**
 * "1,800GR" e ambiguo: 1,8 grama nao existe como embalagem e 1800 gramas
 * escrito com virgula de milhar tambem aparece na base. Virgula seguida de
 * exatamente 3 digitos nao da para resolver sozinho — vai para o cadastro.
 */
function separadorAmbiguo(texto: string): boolean {
  return /,\d{3}$/.test(texto);
}

/**
 * Le as embalagens declaradas no nome do produto.
 *
 * Devolve TODAS as leituras plausiveis, da mais confiavel para a menos. E uma
 * sugestao para a tela de cadastro, nunca um fator aplicado automaticamente:
 * confirmar 800 e trabalho de um clique, descobrir que o CMV do mes saiu errado
 * custa uma auditoria.
 */
export function detectarEmbalagem(nome: unknown): EmbalagemDetectada[] {
  const texto = String(nome ?? "").trim();
  if (!texto) return [];

  const achados: EmbalagemDetectada[] = [];
  const vistos = new Set<string>();

  for (const { re, nivel } of PADROES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) != null) {
      const bruto = m[1];
      const quantidade = numeroPtBr(bruto);
      if (!Number.isFinite(quantidade) || quantidade <= 1 || quantidade > 100000) continue;

      // Normalizar ANTES de classificar: "GR" e grama, e sem isso "PCTE 500GR"
      // vira "pacote com 500 unidades" — o mesmo erro que este modulo existe
      // para evitar.
      const sufixo = normalizarUnidade(m[2] ?? "");
      const ehMedida = SUFIXOS_DE_MEDIDA.has(sufixo);
      const ehDoProduto = SUFIXOS_DO_PRODUTO.has(sufixo);

      const trecho = m[0].trim().replace(/^[.,\-(]\s*/, "");
      const chave = `${nivel}:${quantidade}:${ehMedida ? sufixo : ""}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      achados.push({
        quantidade,
        unidade: ehMedida ? sufixo : null,
        trecho,
        nivel,
        confianca: ehDoProduto || separadorAmbiguo(bruto) ? "baixa" : "alta"
      });
    }
  }

  return achados.sort((a, b) => {
    if (a.confianca !== b.confianca) return a.confianca === "alta" ? -1 : 1;
    if (a.nivel !== b.nivel) return a.nivel === "pacote" ? -1 : 1;
    return b.quantidade - a.quantidade;
  });
}

// ─── Conversao de um item de compra para a unidade de contagem ──────────────────

export type ResultadoConversao = {
  convertedUnit: string | null;
  convertedQuantity: number | null;
  convertedUnitPrice: number | null;
  conversionFactorUsed: number | null;
  /** true quando a unidade muda mas nao ha fator: o custo nao e comparavel. */
  conversionMissing: boolean;
  /** Frase pronta para log e para a tela explicar o que aconteceu. */
  motivo: string | null;
};

const SEM_CONVERSAO: ResultadoConversao = {
  convertedUnit: null,
  convertedQuantity: null,
  convertedUnitPrice: null,
  conversionFactorUsed: null,
  conversionMissing: false,
  motivo: null
};

/**
 * Traz um item de compra para a unidade em que o produto e contado.
 *
 * Invariante: o total do item nao muda. Converter 1 CX de R$ 113,16 em 800 UN
 * da 800 x R$ 0,14145 = R$ 113,16. A conversao redistribui a mesma despesa por
 * uma quantidade diferente — se ela mexesse no total, mexeria nas compras do
 * mes, e o CMV mudaria pelos dois lados.
 */
export function converterItemDeCompra(input: {
  quantity: number;
  unitPrice: number;
  unidadeDaCompra: string | null;
  unidadeDeEstoque: string | null;
  conversions?: UnitConversion[];
}): ResultadoConversao {
  const daCompra = normalizarUnidade(input.unidadeDaCompra);
  const doEstoque = normalizarUnidade(input.unidadeDeEstoque);
  const quantity = Number(input.quantity);
  const unitPrice = Number(input.unitPrice);

  if (!Number.isFinite(quantity) || quantity <= 0) return SEM_CONVERSAO;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return SEM_CONVERSAO;

  // Sem uma das pontas nao ha o que comparar. Nao e conversao faltando: e
  // cadastro incompleto, e marcar "missing" aqui encheria a tela de alarme
  // falso em produto que ninguem controla por unidade.
  if (!daCompra || !doEstoque) return SEM_CONVERSAO;

  if (daCompra === doEstoque) {
    return {
      convertedUnit: doEstoque,
      convertedQuantity: quantity,
      convertedUnitPrice: unitPrice,
      conversionFactorUsed: 1,
      conversionMissing: false,
      motivo: null
    };
  }

  const fator = resolveUnitFactor(daCompra, doEstoque, input.conversions ?? []);
  if (fator == null || !Number.isFinite(fator) || fator <= 0) {
    return {
      ...SEM_CONVERSAO,
      conversionMissing: true,
      motivo: `Compra em ${daCompra}, contagem em ${doEstoque}, e nao ha conversao cadastrada de ${daCompra} para ${doEstoque}.`
    };
  }

  const convertedQuantity = quantity * fator;
  return {
    convertedUnit: doEstoque,
    convertedQuantity,
    // A partir do total, nao do preco unitario: assim o arredondamento sobra no
    // preco (que tem 4 casas) e nunca no total do item (que bate com a nota).
    convertedUnitPrice: (quantity * unitPrice) / convertedQuantity,
    conversionFactorUsed: fator,
    conversionMissing: false,
    motivo: `1 ${daCompra} = ${fator} ${doEstoque}.`
  };
}
