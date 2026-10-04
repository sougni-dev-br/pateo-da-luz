// Confere o que a pessoa digitou na ficha com o texto lido (OCR) das fotos dos documentos.
// A leitura roda no navegador do RH (nada sai do sistema); aqui só se compara texto.
//
// Princípio: na dúvida, não sugere. Foto ruim vira "não deu para ler" — nunca uma sugestão
// errada que o RH aceitaria sem perceber. Números só são sugeridos com dígito verificador
// válido; nomes, só quando muito parecidos com o digitado (erro de digitação, não outra pessoa).

export type Situacao = "confere" | "diverge" | "nao_lido";
export type Conferencia = {
  campo: string;
  rotulo: string;
  digitado: string;
  /** Valor como deve ir para a ficha (CPF só dígitos, data AAAA-MM-DD, nome em maiúsculas do documento). */
  lido: string | null;
  situacao: Situacao;
  /** Em qual tipo de documento a leitura achou o valor. */
  documento: string | null;
  /** Número com dígito verificador (CPF, PIS, título): a leitura confirma a si mesma. Nos demais, o RH confere na foto. */
  seguro: boolean;
};

const COM_DIGITO_VERIFICADOR = new Set(["cpf", "pis", "tituloEleitor"]);

/** Texto do OCR por tipo de arquivo (DOC_FOTO, CPF, CTPS, TITULO, COMPROVANTE_ENDERECO, CERTIDAO...). */
export type TextosLidos = Partial<Record<string, string>>;

const soDigitos = (s: string) => s.replace(/\D/g, "");
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
// Apóstrofo some (D'ÁVILA → DAVILA) para "D'Ávila" digitado e "D ÁVILA" lido compararem igual.
const normalizarNome = (s: string) => semAcento(s).toUpperCase().replace(/['’`´]/g, "").replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
// O OCR troca O↔0, I/l↔1, S↔5, B↔8 dentro de números: corrige só em trechos que já parecem número.
const corrigirOcrNumerico = (s: string) => s.replace(/[\dOoIlSB.\-/ ]{6,}/g, (t) => t.replace(/[Oo]/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5").replace(/B/g, "8"));

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  return dv(9) === Number(cpf[9]) && dv(10) === Number(cpf[10]);
}

export function pisValido(pis: string): boolean {
  if (!/^\d{11}$/.test(pis) || /^(\d)\1{10}$/.test(pis)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const r = 11 - (pesos.reduce((a, p, i) => a + p * Number(pis[i]), 0) % 11);
  return (r >= 10 ? 0 : r) === Number(pis[10]);
}

/** Título de eleitor: 8 dígitos sequenciais + UF (01–28) + 2 verificadores; SP e MG têm regra própria. */
export function tituloValido(t: string): boolean {
  if (!/^\d{12}$/.test(t)) return false;
  const uf = t.slice(8, 10);
  if (Number(uf) < 1 || Number(uf) > 28) return false;
  const espUf = uf === "01" || uf === "02";
  const r1 = [...t.slice(0, 8)].reduce((a, c, i) => a + Number(c) * (i + 2), 0) % 11;
  const d1 = r1 === 10 ? 0 : (r1 === 0 && espUf ? 1 : r1);
  const r2 = (Number(uf[0]) * 7 + Number(uf[1]) * 8 + d1 * 9) % 11;
  const d2 = r2 === 10 ? 0 : (r2 === 0 && espUf ? 1 : r2);
  return d1 === Number(t[10]) && d2 === Number(t[11]);
}

// ─── Extratores ──────────────────────────────────────────────────────────────

function numeros(texto: string, padrao: RegExp, valido: (d: string) => boolean): string[] {
  const achados = [...corrigirOcrNumerico(texto).matchAll(padrao)].map((m) => soDigitos(m[0])).filter(valido);
  return [...new Set(achados)];
}
// Isolados dos dois lados: um pedaço de CNPJ, protocolo ou código de barras não vira CPF.
const cpfs = (t: string) => numeros(t, /(?<![\d.\-/])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?![\d.\-/])/g, cpfValido);
const pises = (t: string) => numeros(t, /(?<![\d.\-/])\d{3}[.\s]?\d{5}[.\s]?\d{2}[-.\s]?\d(?![\d.\-/])/g, pisValido);
const titulos = (t: string) => numeros(t, /(?<![\d.\-/])\d{4}\s?\d{4}\s?\d{4}(?![\d.\-/])/g, tituloValido);
const ceps = (t: string) => numeros(t, /\b\d{5}-?\d{3}\b/g, (d) => d.length === 8 && !/^0{8}$/.test(d));

type DataAchada = { iso: string; pos: number };
function datas(texto: string): DataAchada[] {
  const out: DataAchada[] = [];
  for (const m of corrigirOcrNumerico(texto).matchAll(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/g)) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(`${iso}T00:00:00Z`);
    if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso && m[3] >= "1920") out.push({ iso, pos: m.index ?? 0 });
  }
  return out;
}

const ROTULO_DE_OUTRA_DATA = /EXPEDI|EMISS|VALID|CASAM|ADMISS|ENTRADA|CHEGADA/i;
const ALCANCE_DO_ROTULO = 80;

/**
 * Data que vem logo depois de "nascimento". Descarta a que tiver outro rótulo de data no meio
 * (expedição, validade, casamento) e só devolve se sobrar uma — certidão de casamento traz duas.
 */
function dataDeNascimento(texto: string): string | null {
  const todas = datas(texto);
  const achadas = new Set<string>();
  for (const k of texto.matchAll(/NASC/gi)) {
    const inicio = k.index ?? 0;
    for (const d of todas) {
      if (d.pos < inicio || d.pos - inicio >= ALCANCE_DO_ROTULO) continue;
      if (ROTULO_DE_OUTRA_DATA.test(texto.slice(inicio, d.pos))) continue;
      achadas.add(d.iso);
    }
  }
  return achadas.size === 1 ? [...achadas][0] : null;
}

/** Distância de edição (Levenshtein) — para achar o nome digitado com erro dentro do texto. */
function distancia(a: string, b: string): number {
  const v = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = v[0];
    v[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = v[j];
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return v[b.length];
}

const SIMILARIDADE_MINIMA = 0.82;

type Candidato = { original: string; normal: string; similaridade: number };

/** Trecho da linha (± uma palavra) mais parecido com o nome; guarda a grafia do documento, com acento. */
function melhorNaLinha(alvo: string, linha: string): Candidato | null {
  const palavras = linha.split(/[^\p{L}'’`´]+/u)
    .map((original) => ({ original, normal: normalizarNome(original).replace(/ /g, "") }))
    .filter((p) => p.normal !== "");
  const n = alvo.split(" ").length;
  let melhor: Candidato | null = null;
  for (let tam = Math.max(1, n - 1); tam <= n + 1; tam++) {
    for (let i = 0; i + tam <= palavras.length; i++) {
      const trecho = palavras.slice(i, i + tam);
      const normal = trecho.map((p) => p.normal).join(" ");
      const similaridade = 1 - distancia(alvo, normal) / Math.max(alvo.length, normal.length);
      if (!melhor || similaridade > melhor.similaridade) {
        melhor = { original: trecho.map((p) => p.original).join(" ").toLocaleUpperCase("pt-BR"), normal, similaridade };
      }
    }
  }
  return melhor;
}

/**
 * Nome parecido com o digitado. Pula as linhas que já são o nome de outro campo (a mãe não pode
 * "virar" o pai) e desiste se duas linhas diferentes servirem — aí não dá para saber qual é.
 */
function nomeParecido(digitado: string, texto: string, outrosNomes: string[]): Candidato | null {
  const alvo = normalizarNome(digitado);
  const outros = outrosNomes.map((o) => ` ${normalizarNome(o)} `).filter((o) => o.trim() !== "");
  const porTexto = new Map<string, Candidato>();
  for (const linha of texto.split(/\r?\n/)) {
    const comEspacos = ` ${normalizarNome(linha)} `;
    if (outros.some((o) => comEspacos.includes(o))) continue;
    const c = melhorNaLinha(alvo, linha);
    if (c && c.similaridade >= SIMILARIDADE_MINIMA) porTexto.set(c.normal, c);
  }
  return porTexto.size === 1 ? [...porTexto.values()][0] : null;
}

// ─── Conferência por campo ──────────────────────────────────────────────────

type Resultado = { confere: boolean; lido: string | null };
type Regra = { campo: string; rotulo: string; fontes: string[]; conferir: (digitado: string, texto: string, dados: Record<string, unknown>) => Resultado };

const CAMPOS_DE_NOME = ["nomeCompleto", "nomeMae", "nomePai"];

function porNumero(extrair: (t: string) => string[], formatoDigitado = soDigitos) {
  return (digitado: string, texto: string) => {
    const achados = extrair(texto);
    if (achados.includes(formatoDigitado(digitado))) return { confere: true, lido: null };
    // Só sugere quando o documento traz exatamente um candidato — dois números válidos diferentes
    // (documento de outra pessoa na mesma foto, por exemplo) não dão para decidir.
    return { confere: false, lido: achados.length === 1 ? achados[0] : null };
  };
}

function porNome(campo: string) {
  return (digitado: string, texto: string, dados: Record<string, unknown>): Resultado => {
    // Palavras inteiras: "SILV" digitado não pode conferir com "SILVA" do documento.
    const alvo = ` ${normalizarNome(digitado)} `;
    const linhas = texto.split(/\r?\n/).map((l) => ` ${normalizarNome(l)} `);
    if (linhas.some((l) => l.includes(alvo))) return { confere: true, lido: null };
    const outros = CAMPOS_DE_NOME.filter((c) => c !== campo).map((c) => dados[c]).filter((v): v is string => typeof v === "string");
    return { confere: false, lido: nomeParecido(digitado, texto, outros)?.original ?? null };
  };
}

// RG muda de formato por estado: compara só dígitos (e o X), número a número.
const NUMERO_DE_RG = /(?<![\dA-Z])\d[\d.\-]{3,12}[\dX](?![\dA-Z])/gi;
const RG_DEPOIS_DO_ROTULO = /(?:REGISTRO GERAL|\bRG\b)[^\d\n]{0,15}\n?[^\d\n]{0,15}(\d{1,2}\.?\d{3}\.?\d{3}-?[\dX])(?![\dA-Z])/i;
const rgCru = (s: string) => s.replace(/[^0-9X]/gi, "").toUpperCase();

/** Sugestão no mesmo jeito que a pessoa escreveu: com pontos se ela usou pontos, só dígitos se não. */
function rgNoFormatoDigitado(digitado: string, lido: string): string {
  const cru = rgCru(lido);
  if (!/[.\-]/.test(digitado)) return cru;
  return cru.length === 9 ? `${cru.slice(0, 2)}.${cru.slice(2, 5)}.${cru.slice(5, 8)}-${cru.slice(8)}` : lido.toUpperCase();
}

function porRg(digitado: string, texto: string): Resultado {
  const alvo = rgCru(digitado);
  const corrigido = corrigirOcrNumerico(texto);
  if (alvo.length >= 5 && [...corrigido.matchAll(NUMERO_DE_RG)].some((m) => rgCru(m[0]) === alvo)) return { confere: true, lido: null };
  const m = RG_DEPOIS_DO_ROTULO.exec(semAcento(corrigido));
  return { confere: false, lido: m ? rgNoFormatoDigitado(digitado, m[1]) : null };
}

const REGRAS: Regra[] = [
  { campo: "nomeCompleto", rotulo: "Nome completo", fontes: ["DOC_FOTO", "CPF", "CTPS", "CERTIDAO", "TITULO"], conferir: porNome("nomeCompleto") },
  {
    // Certidão fica de fora: a de casamento traz a data do cônjuge.
    campo: "dataNascimento", rotulo: "Data de nascimento", fontes: ["DOC_FOTO", "CTPS"],
    conferir: (digitado, texto) => {
      if (datas(texto).some((d) => d.iso === digitado)) return { confere: true, lido: null };
      return { confere: false, lido: dataDeNascimento(texto) };
    },
  },
  { campo: "cpf", rotulo: "CPF", fontes: ["DOC_FOTO", "CPF", "CTPS"], conferir: porNumero(cpfs) },
  { campo: "rg", rotulo: "RG", fontes: ["DOC_FOTO"], conferir: porRg },
  { campo: "nomeMae", rotulo: "Nome da mãe", fontes: ["DOC_FOTO", "CERTIDAO"], conferir: porNome("nomeMae") },
  { campo: "nomePai", rotulo: "Nome do pai", fontes: ["DOC_FOTO", "CERTIDAO"], conferir: porNome("nomePai") },
  { campo: "pis", rotulo: "PIS", fontes: ["CTPS", "DOC_FOTO"], conferir: porNumero(pises) },
  { campo: "tituloEleitor", rotulo: "Título de eleitor", fontes: ["TITULO"], conferir: porNumero(titulos) },
  { campo: "cep", rotulo: "CEP", fontes: ["COMPROVANTE_ENDERECO"], conferir: porNumero(ceps) },
];

export function conferirDocumentos(dados: Record<string, unknown>, textos: TextosLidos): Conferencia[] {
  const resultado: Conferencia[] = [];
  for (const r of REGRAS) {
    const digitado = dados[r.campo];
    if (typeof digitado !== "string" || digitado.trim() === "") continue;
    const fontes = r.fontes.filter((f) => (textos[f] ?? "").trim() !== "");
    let conferida: Conferencia = {
      campo: r.campo, rotulo: r.rotulo, digitado, lido: null, situacao: "nao_lido", documento: null, seguro: COM_DIGITO_VERIFICADOR.has(r.campo),
    };
    // Confere em qualquer documento → confere. Senão, fica com a primeira sugestão — mas, se
    // documentos diferentes sugerirem valores diferentes, não sugere nada.
    const sugestoes = new Map<string, string>();
    for (const f of fontes) {
      const c = r.conferir(digitado, textos[f]!, dados);
      if (c.confere) { conferida = { ...conferida, situacao: "confere", documento: f }; break; }
      if (c.lido && !sugestoes.has(c.lido)) sugestoes.set(c.lido, f);
    }
    if (conferida.situacao !== "confere" && sugestoes.size === 1) {
      const [lido, documento] = [...sugestoes.entries()][0];
      conferida = { ...conferida, situacao: "diverge", lido, documento };
    }
    resultado.push(conferida);
  }
  return resultado;
}
