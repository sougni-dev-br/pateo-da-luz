// Campos da ficha cadastral por link: o que a pessoa preenche, o que o RH completa e como
// isso vira cadastro. A pessoa é anônima (só tem o link), então tudo que chega é lido por
// lista fechada de campos, com tamanho máximo — campo desconhecido é ignorado.
import { cidadeProprio, nomeProprio } from "../../shared/utils/nome-proprio.js";

export const ESTADOS_CIVIS = ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Separado(a)", "Viúvo(a)"] as const;
export const RACAS_CORES = ["Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"] as const;
export const ESCOLARIDADES = [
  "Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo",
  "Superior incompleto", "Superior completo", "Pós-graduação",
] as const;
export const SEXOS = ["FEMININO", "MASCULINO"] as const;
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export const TIPOS_ARQUIVO = {
  // Foto da própria pessoa (rosto, estilo 3x4): vai na ficha impressa e identifica o cadastro.
  FOTO_PESSOA: "Sua foto",
  DOC_FOTO: "Documento com foto (RG ou CNH)",
  CPF: "CPF",
  CTPS: "Carteira de trabalho",
  COMPROVANTE_ENDERECO: "Comprovante de endereço",
  TITULO: "Título de eleitor",
  CERTIDAO: "Certidão de nascimento ou casamento",
  ESCOLARIDADE: "Comprovante de escolaridade",
  RESERVISTA: "Reservista",
  FILHOS: "Documentos dos filhos",
  OUTRO: "Outro",
} as const;
export type TipoArquivo = keyof typeof TIPOS_ARQUIVO;
/** Sem estes a admissão não finaliza. Na atualização nenhum é obrigatório. */
export const ARQUIVOS_OBRIGATORIOS_ADMISSAO: TipoArquivo[] = ["FOTO_PESSOA", "DOC_FOTO", "COMPROVANTE_ENDERECO"];

// Texto livre: nome do campo → tamanho máximo.
const TEXTO: Record<string, number> = {
  nomeCompleto: 120, nomeMae: 120, nomePai: 120, nomeConjuge: 120, nacionalidade: 60, naturalidade: 80,
  rg: 20, rgOrgaoEmissor: 20, ctpsNumero: 20, ctpsSerie: 10, tituloZona: 6, tituloSecao: 6,
  endereco: 120, numero: 15, complemento: 60, bairro: 80, cidade: 80, email: 120, vtTrajeto: 300, pixChave: 120,
};
// Só algarismos: nome do campo → [mínimo, máximo] de dígitos.
const DIGITOS: Record<string, [number, number]> = {
  cpf: [11, 11], pis: [11, 11], cep: [8, 8], telefone: [10, 11], tituloEleitor: [12, 12],
};
const DATAS = ["dataNascimento", "rgDataEmissao"] as const;
const OPCOES: Record<string, readonly string[]> = {
  sexo: SEXOS, estadoCivil: ESTADOS_CIVIS, racaCor: RACAS_CORES, escolaridade: ESCOLARIDADES, rgUf: UFS, ctpsUf: UFS, uf: UFS,
};
const BOOLEANOS = ["possuiDeficiencia", "usaVt"] as const;
const MAX_FILHOS = 10;

/** `ref`: id do dependente já cadastrado (atualização) — corrigir o nome não vira filho novo. */
export type Filho = { nome: string; dataNascimento: string | null; cpf: string | null; ref?: string | null };

/** Dependente sem parentesco (importado da ficha de registro) conta como filho; cônjuge etc. não. */
export const ehFilho = (parentesco: string | null | undefined) => !parentesco || /filh/i.test(parentesco);
export type DadosPessoa = Record<string, string | boolean | Filho[] | null>;

export const ROTULOS: Record<string, string> = {
  nomeCompleto: "Nome completo", dataNascimento: "Data de nascimento", sexo: "Sexo", estadoCivil: "Estado civil",
  cpf: "CPF", nomeMae: "Nome da mãe", nomePai: "Nome do pai", nacionalidade: "Nacionalidade",
  naturalidade: "Naturalidade", racaCor: "Raça/cor", escolaridade: "Escolaridade", possuiDeficiencia: "Pessoa com deficiência",
  rg: "RG", rgOrgaoEmissor: "Órgão emissor do RG", rgUf: "UF do RG", rgDataEmissao: "Data de emissão do RG",
  ctpsNumero: "Número da CTPS", ctpsSerie: "Série da CTPS", ctpsUf: "UF da CTPS", pis: "PIS",
  tituloEleitor: "Título de eleitor", tituloZona: "Zona eleitoral", tituloSecao: "Seção eleitoral",
  cep: "CEP", endereco: "Endereço", numero: "Número", complemento: "Complemento", bairro: "Bairro", cidade: "Cidade", uf: "UF",
  telefone: "Telefone", email: "E-mail", nomeConjuge: "Nome do cônjuge", filhos: "Filhos",
  usaVt: "Vale-transporte", vtTrajeto: "Trajeto do vale-transporte", pixChave: "Chave PIX",
};

const OBRIGATORIOS = [
  "nomeCompleto", "dataNascimento", "sexo", "cpf", "nomeMae", "estadoCivil", "racaCor", "escolaridade",
  "rg", "cep", "endereco", "numero", "bairro", "cidade", "uf", "telefone", "usaVt",
] as const;

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(cpf[i]) * (n + 1 - i);
    const d = 11 - (soma % 11);
    return d >= 10 ? 0 : d;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/** "AAAA-MM-DD" que existe no calendário, entre 1900 e hoje. */
export function dataValida(v: unknown): v is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (!m) return false;
  const d = new Date(`${m[0]}T00:00:00.000Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[0] && m[1] >= "1900" && d.getTime() <= Date.now();
}

/** "AAAA-MM-DD" que existe no calendário (admissão pode ser futura). */
function diaDoCalendario(v: string): boolean {
  const d = new Date(`${v}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000";
}

function texto(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s.slice(0, max);
}

function lerFilhos(v: unknown): Filho[] | { erro: string } {
  if (!Array.isArray(v)) return { erro: "Lista de filhos inválida." };
  if (v.length > MAX_FILHOS) return { erro: `No máximo ${MAX_FILHOS} filhos.` };
  const filhos: Filho[] = [];
  for (const bruto of v) {
    if (!bruto || typeof bruto !== "object") continue;
    const f = bruto as Record<string, unknown>;
    const nome = texto(f.nome, 120);
    if (!nome) continue;
    const nascimento = f.dataNascimento == null || f.dataNascimento === "" ? null : String(f.dataNascimento);
    if (nascimento !== null && !dataValida(nascimento)) return { erro: `Data de nascimento de ${nome} inválida.` };
    const cpf = f.cpf == null || f.cpf === "" ? null : String(f.cpf).replace(/\D/g, "");
    if (cpf !== null && !cpfValido(cpf)) return { erro: `CPF de ${nome} inválido.` };
    // A referência vem da própria ficha; na conclusão só vale se for dependente deste funcionário.
    const ref = typeof f.ref === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(f.ref) ? f.ref : null;
    filhos.push({ nome: nomeProprio(nome) ?? nome, dataNascimento: nascimento, cpf, ref });
  }
  return filhos;
}

/**
 * Lê só os campos presentes no corpo (salvar uma etapa não apaga as outras). Vazio limpa o
 * campo. Valor que não dá para entender é recusado com a mensagem para a pessoa corrigir.
 */
export function lerDadosPessoa(b: Record<string, unknown>): { erro: string } | { dados: DadosPessoa } {
  const dados: DadosPessoa = {};
  for (const [campo, max] of Object.entries(TEXTO)) if (campo in b) dados[campo] = texto(b[campo], max);
  for (const [campo, [min, max]] of Object.entries(DIGITOS)) {
    if (!(campo in b)) continue;
    const d = b[campo] == null ? "" : String(b[campo]).replace(/\D/g, "");
    if (d === "") { dados[campo] = null; continue; }
    if (d.length < min || d.length > max) return { erro: `${ROTULOS[campo]} inválido.` };
    dados[campo] = d;
  }
  if (typeof dados.cpf === "string" && !cpfValido(dados.cpf)) return { erro: "CPF inválido. Confira os números." };
  for (const campo of DATAS) {
    if (!(campo in b)) continue;
    if (b[campo] == null || b[campo] === "") { dados[campo] = null; continue; }
    if (!dataValida(b[campo])) return { erro: `${ROTULOS[campo]} inválida.` };
    dados[campo] = String(b[campo]);
  }
  for (const [campo, lista] of Object.entries(OPCOES)) {
    if (!(campo in b)) continue;
    if (b[campo] == null || b[campo] === "") { dados[campo] = null; continue; }
    if (!lista.includes(String(b[campo]))) return { erro: `${ROTULOS[campo]}: escolha uma das opções.` };
    dados[campo] = String(b[campo]);
  }
  for (const campo of BOOLEANOS) {
    if (!(campo in b)) continue;
    if (b[campo] != null && typeof b[campo] !== "boolean") return { erro: `${ROTULOS[campo]}: responda sim ou não.` };
    dados[campo] = (b[campo] as boolean | null) ?? null;
  }
  if (typeof dados.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) return { erro: "E-mail inválido." };
  if ("filhos" in b) {
    const filhos = b.filhos == null ? [] : lerFilhos(b.filhos);
    if ("erro" in filhos) return filhos;
    dados.filhos = filhos;
  }
  return { dados };
}

/** O que falta para finalizar (rótulos, na ordem do formulário). Vazio = pode finalizar. */
export function faltaParaFinalizar(dados: DadosPessoa, tiposArquivo: string[], exigeArquivos: boolean): string[] {
  const falta: string[] = OBRIGATORIOS.filter((c) => dados[c] == null || dados[c] === "").map((c) => ROTULOS[c]);
  if (typeof dados.nomeCompleto === "string" && dados.nomeCompleto.split(" ").length < 2) falta.unshift("Nome completo (nome e sobrenome)");
  // Na atualização o trajeto já está no cadastro (pernas do VT): só a admissão precisa contar.
  if (exigeArquivos && dados.usaVt === true && !dados.vtTrajeto) falta.push(ROTULOS.vtTrajeto);
  if (exigeArquivos) {
    for (const t of ARQUIVOS_OBRIGATORIOS_ADMISSAO) {
      if (!tiposArquivo.includes(t)) falta.push(t === "FOTO_PESSOA" ? "Sua foto (rosto)" : `Foto: ${TIPOS_ARQUIVO[t]}`);
    }
  }
  return [...new Set(falta)];
}

// ─── Parte do RH ─────────────────────────────────────────────────────────────

export type DadosEmpresa = {
  companyId: string | null; admissao: string | null; funcao: string | null; salario: number | null;
  modalidade: "CLT" | "NAO_CLT"; entrada: string | null; intervaloInicio: string | null; intervaloFim: string | null;
  saida: string | null; sabadoEntrada: string | null; sabadoSaida: string | null; folga: string | null;
  valeTransporte: boolean | null; valorVt: number | null; observacoes: string | null;
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function lerDadosEmpresa(b: Record<string, unknown>): { erro: string } | { dados: DadosEmpresa } {
  const hora = (campo: string): string | null | { erro: string } => {
    const v = texto(b[campo], 5);
    if (v === null) return null;
    return HORA.test(v) ? v : { erro: `Horário inválido (${campo}). Use HH:MM.` };
  };
  const horas: Record<string, string | null> = {};
  for (const c of ["entrada", "intervaloInicio", "intervaloFim", "saida", "sabadoEntrada", "sabadoSaida"]) {
    const h = hora(c);
    if (h && typeof h === "object") return h;
    horas[c] = h;
  }
  const valor = (campo: string, rotulo: string): number | null | { erro: string } => {
    if (b[campo] == null || b[campo] === "") return null;
    const n = Number(b[campo]);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : { erro: `${rotulo} inválido.` };
  };
  const salario = valor("salario", "Salário");
  if (salario && typeof salario === "object") return salario;
  const valorVt = valor("valorVt", "Valor do VT");
  if (valorVt && typeof valorVt === "object") return valorVt;
  const admissao = b.admissao == null || b.admissao === "" ? null : String(b.admissao);
  if (admissao !== null && !diaDoCalendario(admissao)) return { erro: "Data de admissão inválida." };
  if (b.valeTransporte != null && typeof b.valeTransporte !== "boolean") return { erro: "Vale-transporte: sim ou não." };
  return {
    dados: {
      companyId: texto(b.companyId, 40), admissao, funcao: texto(b.funcao, 80), salario,
      modalidade: b.modalidade === "NAO_CLT" ? "NAO_CLT" : "CLT",
      entrada: horas.entrada, intervaloInicio: horas.intervaloInicio, intervaloFim: horas.intervaloFim, saida: horas.saida,
      sabadoEntrada: horas.sabadoEntrada, sabadoSaida: horas.sabadoSaida, folga: texto(b.folga, 120),
      valeTransporte: (b.valeTransporte as boolean | null | undefined) ?? null, valorVt, observacoes: texto(b.observacoes, 500),
    },
  };
}

// ─── Ficha ↔ cadastro ────────────────────────────────────────────────────────

/** Campo da ficha → coluna do Employee (só dados pessoais; empresa/salário nunca). */
export const PARA_FUNCIONARIO: Record<string, string> = {
  nomeCompleto: "nomeCompleto", dataNascimento: "birthDate", sexo: "gender", estadoCivil: "estadoCivil", cpf: "cpf",
  nomeMae: "nomeMae", nomePai: "nomePai", nacionalidade: "nacionalidade", naturalidade: "naturalidade", racaCor: "racaCor",
  escolaridade: "escolaridade", possuiDeficiencia: "possuiDeficiencia", rg: "rg", rgOrgaoEmissor: "rgOrgaoEmissor",
  rgUf: "rgUf", rgDataEmissao: "rgDataEmissao", ctpsNumero: "ctpsNumero", ctpsSerie: "ctpsSerie", ctpsUf: "ctpsUf",
  pis: "pis", tituloEleitor: "tituloEleitor", tituloZona: "tituloZona", tituloSecao: "tituloSecao", cep: "zipCode",
  endereco: "address", numero: "addressNumber", complemento: "addressComplement", bairro: "neighborhood", cidade: "city",
  uf: "state", telefone: "phone", email: "email", nomeConjuge: "nomeConjuge", pixChave: "pixKey",
};
const CAMPOS_DATA_FUNCIONARIO = new Set(["birthDate", "rgDataEmissao"]);
const NOMES_PROPRIOS = new Set(["nomeCompleto", "nomeMae", "nomePai", "nomeConjuge", "nacionalidade", "endereco", "complemento", "bairro"]);

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : null);

// Telefone e CEP vão para o cadastro com máscara, como a tela de Funcionários grava — senão a
// mesma coluna fica com dois formatos.
function mascarar(campo: string, v: string): string {
  const d = v.replace(/\D/g, "");
  if (campo === "cep" && d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (campo === "telefone" && d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (campo === "telefone" && d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

/** Valor da ficha já no formato do cadastro (nome próprio, cidade com acento, data, máscara). */
export function valorParaFuncionario(campo: string, valor: unknown): string | boolean | Date | null {
  if (valor == null || valor === "") return null;
  const coluna = PARA_FUNCIONARIO[campo];
  if (CAMPOS_DATA_FUNCIONARIO.has(coluna)) return new Date(`${valor}T00:00:00.000Z`);
  if (typeof valor === "boolean") return valor;
  if (NOMES_PROPRIOS.has(campo)) return nomeProprio(String(valor));
  if (campo === "cidade" || campo === "naturalidade") return cidadeProprio(String(valor));
  if (campo === "cep" || campo === "telefone") return mascarar(campo, String(valor));
  return String(valor);
}

/**
 * Tipo da chave PIX pelo formato (o cadastro guarda chave e tipo juntos; a lista de pagamento
 * da gorjeta e os extras usam o tipo). null = não deu para saber: o RH escolhe no cadastro.
 */
export function tipoDaChavePix(chave: string): "CPF" | "EMAIL" | "TELEFONE" | "ALEATORIA" | null {
  const v = chave.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "EMAIL";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "ALEATORIA";
  const d = v.replace(/\D/g, "");
  if (/^[\d.\-\s]+$/.test(v) && d.length === 11 && cpfValido(d)) return "CPF";
  if (/^[\d()+\-\s]+$/.test(v) && (d.length === 10 || d.length === 11 || (d.length === 13 && d.startsWith("55")))) return "TELEFONE";
  return null;
}

/** Dados atuais do funcionário no formato da ficha — a atualização já abre preenchida. */
export function dadosDoFuncionario(
  e: Record<string, unknown>, filhos: Array<{ id?: string; nome: string; dataNascimento: Date | null; cpf: string | null }>,
): DadosPessoa {
  const dados: DadosPessoa = {};
  for (const [campo, coluna] of Object.entries(PARA_FUNCIONARIO)) {
    const v = e[coluna];
    if (v == null || v === "") continue;
    if (v instanceof Date) dados[campo] = iso(v);
    else if (coluna === "gender") { if (v !== "NAO_INFORMADO") dados[campo] = String(v); }
    else if (typeof v === "boolean") dados[campo] = v;
    else dados[campo] = DIGITOS[campo] ? String(v).replace(/\D/g, "") : String(v);
  }
  if (!dados.nomeCompleto) dados.nomeCompleto = [e.firstName, e.lastName].filter(Boolean).join(" ") || null;
  if (typeof e.vtType === "string") dados.usaVt = e.vtType !== "NENHUM";
  dados.filhos = filhos.map((f) => ({ nome: f.nome, dataNascimento: iso(f.dataNascimento), cpf: f.cpf, ref: f.id ?? null }));
  return dados;
}

const comparavel = (v: unknown): string => {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim().toLocaleLowerCase("pt-BR");
};

export type Diferenca = { campo: string; rotulo: string; atual: string | null; novo: string };

const SEM_PONTUACAO = new Set(["rg", "ctpsNumero", "tituloZona", "tituloSecao"]);
const SEXO: Record<string, string> = { FEMININO: "Feminino", MASCULINO: "Masculino", NAO_INFORMADO: "Não informado" };

const mostrar = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10).split("-").reverse().join("/");
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  return SEXO[String(v)] ?? String(v);
};

/** O que a ficha muda no cadastro. Campo vazio na ficha não apaga nada do cadastro. */
export function diferencas(dados: DadosPessoa, funcionario: Record<string, unknown>): Diferenca[] {
  const lista: Diferenca[] = [];
  for (const [campo, coluna] of Object.entries(PARA_FUNCIONARIO)) {
    const novo = valorParaFuncionario(campo, dados[campo]);
    if (novo == null) continue;
    // Cadastro antigo sem "nome completo": o nome que vale é nome + sobrenome.
    const atual = coluna === "nomeCompleto" && !funcionario.nomeCompleto
      ? [funcionario.firstName, funcionario.lastName].filter(Boolean).join(" ") || null
      : funcionario[coluna];
    const soAlfanumerico = DIGITOS[campo] || SEM_PONTUACAO.has(campo);
    const limpar = (v: unknown) => (soAlfanumerico ? comparavel(v).replace(/[^0-9a-z]/g, "") : comparavel(v));
    if (limpar(atual) === limpar(novo)) continue;
    lista.push({ campo, rotulo: ROTULOS[campo], atual: mostrar(atual), novo: mostrar(novo)! });
  }
  return lista;
}

/** Nome = prenome; Sobrenome = todo o resto (regra do cadastro). */
export function dividirNome(nomeCompleto: string): { firstName: string; lastName: string } {
  const partes = (nomeProprio(nomeCompleto) ?? nomeCompleto).split(" ").filter(Boolean);
  return { firstName: partes[0] ?? "", lastName: partes.slice(1).join(" ") };
}

const chaveNome = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Filhos da ficha que ainda não estão nos dependentes: nem pela referência, nem pelo nome (sem caixa nem acento). */
export function filhosNovos(filhos: Filho[], existentes: Array<{ id: string; nome: string }>): Filho[] {
  const ids = new Set(existentes.map((d) => d.id));
  const ja = new Set(existentes.map((d) => chaveNome(d.nome)));
  return filhos.filter((f) => !(f.ref && ids.has(f.ref)) && !ja.has(chaveNome(f.nome)));
}

export type FilhoAlterado = {
  dependenteId: string; nome: string;
  /** Grafia do nome corrigida pela pessoa (só quando o dependente veio do cadastro pela referência). */
  nomeNovo?: string;
  dataNascimento?: { atual: string | null; novo: string };
  cpf?: { atual: string | null; novo: string };
};

/**
 * Dependentes que já estão no cadastro e cuja data de nascimento ou CPF a pessoa informou
 * diferente (a data define o salário-família). Vazio na ficha não apaga o que está no cadastro.
 */
export function filhosAlterados(
  filhos: Filho[], existentes: Array<{ id: string; nome: string; dataNascimento: Date | null; cpf: string | null }>,
): FilhoAlterado[] {
  const lista: FilhoAlterado[] = [];
  const quantos = (nomes: string[], alvo: string) => nomes.filter((n) => chaveNome(n) === chaveNome(alvo)).length;
  for (const d of existentes) {
    // Pela referência (a ficha veio do cadastro), o nome pode ter sido corrigido.
    const porRef = filhos.find((x) => x.ref === d.id);
    // Sem referência, pelo nome. Dois filhos com o mesmo nome (na ficha ou no cadastro): não dá
    // para saber qual é qual — nada é corrigido sozinho; o RH ajusta no cadastro.
    const repetido = quantos(existentes.map((e) => e.nome), d.nome) > 1 || quantos(filhos.map((x) => x.nome), d.nome) > 1;
    const f = porRef ?? (repetido ? undefined : filhos.find((x) => !x.ref && chaveNome(x.nome) === chaveNome(d.nome)));
    if (!f) continue;
    const item: FilhoAlterado = { dependenteId: d.id, nome: d.nome };
    if (porRef && chaveNome(f.nome) !== chaveNome(d.nome)) item.nomeNovo = f.nome;
    const nascimentoAtual = iso(d.dataNascimento);
    if (f.dataNascimento && f.dataNascimento !== nascimentoAtual) item.dataNascimento = { atual: nascimentoAtual, novo: f.dataNascimento };
    const cpfAtual = d.cpf ? d.cpf.replace(/\D/g, "") : null;
    if (f.cpf && f.cpf !== cpfAtual) item.cpf = { atual: cpfAtual, novo: f.cpf };
    if (item.nomeNovo || item.dataNascimento || item.cpf) lista.push(item);
  }
  return lista;
}

/** Como abrir o link sem deixar os dados à vista de quem achar o link: data de nascimento, senão CPF. */
export function verificacaoNecessaria(dados: DadosPessoa): "NASCIMENTO" | "CPF" | null {
  if (typeof dados.dataNascimento === "string") return "NASCIMENTO";
  if (typeof dados.cpf === "string") return "CPF";
  return null;
}
