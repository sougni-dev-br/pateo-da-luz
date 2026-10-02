// Etapas do formulário público e os campos de cada uma. Os obrigatórios espelham o backend
// (ficha-cadastral-campos.ts): o servidor confere de novo ao finalizar.
import { cpfValido, dataParaIso, isoParaData, mascaraCep, mascaraCpf, mascaraPis, mascaraTelefone, mascaraTitulo, soDigitos } from "./formato";
import type { Dados, Opcoes } from "./api";

export type TipoCampo = "texto" | "data" | "cpf" | "cep" | "telefone" | "pis" | "titulo" | "email" | "lista" | "simnao" | "sexo";
export type Campo = {
  nome: string; rotulo: string; tipo: TipoCampo; obrigatorio?: boolean; dica?: string;
  lista?: keyof Pick<Opcoes, "estadosCivis" | "racasCores" | "escolaridades" | "ufs">;
  largura?: "inteira" | "meia" | "terco"; autoComplete?: string; padrao?: string;
  /** Subtítulo mostrado antes deste campo (abre um grupo dentro da etapa). */
  grupo?: string;
};
export type Etapa = { id: string; titulo: string; resumo: string; campos: Campo[] };

export const ETAPAS: Etapa[] = [
  {
    id: "voce", titulo: "Sobre você", resumo: "Nome, nascimento e família de origem",
    campos: [
      { grupo: "Identificação", nome: "nomeCompleto", rotulo: "Nome completo", tipo: "texto", obrigatorio: true, dica: "Como está no seu documento, sem abreviar.", autoComplete: "name" },
      { nome: "dataNascimento", rotulo: "Data de nascimento", tipo: "data", obrigatorio: true, largura: "meia", autoComplete: "bday" },
      { nome: "cpf", rotulo: "CPF", tipo: "cpf", obrigatorio: true, largura: "meia" },
      { nome: "sexo", rotulo: "Sexo", tipo: "sexo", obrigatorio: true },
      { nome: "estadoCivil", rotulo: "Estado civil", tipo: "lista", lista: "estadosCivis", obrigatorio: true, largura: "meia" },
      { nome: "racaCor", rotulo: "Raça/cor", tipo: "lista", lista: "racasCores", obrigatorio: true, largura: "meia" },
      { nome: "escolaridade", rotulo: "Escolaridade", tipo: "lista", lista: "escolaridades", obrigatorio: true },
      { nome: "nacionalidade", rotulo: "Nacionalidade", tipo: "texto", largura: "meia", padrao: "Brasileira" },
      { nome: "naturalidade", rotulo: "Cidade onde nasceu", tipo: "texto", largura: "meia", dica: "Ex.: Recife/PE" },
      { grupo: "Filiação", nome: "nomeMae", rotulo: "Nome da mãe", tipo: "texto", obrigatorio: true },
      { nome: "nomePai", rotulo: "Nome do pai", tipo: "texto", dica: "Deixe em branco se não consta no documento." },
      { grupo: "Acessibilidade", nome: "possuiDeficiencia", rotulo: "Você é pessoa com deficiência?", tipo: "simnao" },
    ],
  },
  {
    id: "documentos", titulo: "Documentos", resumo: "RG, carteira de trabalho, PIS e título",
    campos: [
      { grupo: "RG", nome: "rg", rotulo: "RG (número)", tipo: "texto", obrigatorio: true, largura: "meia" },
      { nome: "rgOrgaoEmissor", rotulo: "Órgão emissor", tipo: "texto", largura: "meia", dica: "Ex.: SSP" },
      { nome: "rgUf", rotulo: "Estado do RG", tipo: "lista", lista: "ufs", largura: "meia" },
      { nome: "rgDataEmissao", rotulo: "Data de emissão do RG", tipo: "data", largura: "meia" },
      { grupo: "Carteira de trabalho e PIS", nome: "ctpsNumero", rotulo: "Carteira de trabalho (número)", tipo: "texto", largura: "meia", dica: "Na carteira digital, é o número do CPF." },
      { nome: "ctpsSerie", rotulo: "Série", tipo: "texto", largura: "terco" },
      { nome: "ctpsUf", rotulo: "Estado", tipo: "lista", lista: "ufs", largura: "terco" },
      { nome: "pis", rotulo: "PIS / NIS", tipo: "pis", dica: "Está na carteira de trabalho ou no app Carteira de Trabalho Digital." },
      { grupo: "Título de eleitor", nome: "tituloEleitor", rotulo: "Título de eleitor", tipo: "titulo", largura: "meia" },
      { nome: "tituloZona", rotulo: "Zona", tipo: "texto", largura: "terco" },
      { nome: "tituloSecao", rotulo: "Seção", tipo: "texto", largura: "terco" },
    ],
  },
  {
    id: "endereco", titulo: "Endereço e contato", resumo: "Onde você mora e como falar com você",
    campos: [
      { grupo: "Endereço", nome: "cep", rotulo: "CEP", tipo: "cep", obrigatorio: true, largura: "meia", autoComplete: "postal-code" },
      { nome: "endereco", rotulo: "Rua / Avenida", tipo: "texto", obrigatorio: true, autoComplete: "address-line1" },
      { nome: "numero", rotulo: "Número", tipo: "texto", obrigatorio: true, largura: "meia" },
      { nome: "complemento", rotulo: "Complemento", tipo: "texto", largura: "meia", dica: "Apto, bloco, casa…" },
      { nome: "bairro", rotulo: "Bairro", tipo: "texto", obrigatorio: true },
      { nome: "cidade", rotulo: "Cidade", tipo: "texto", obrigatorio: true, largura: "meia", autoComplete: "address-level2" },
      { nome: "uf", rotulo: "Estado", tipo: "lista", lista: "ufs", obrigatorio: true, largura: "meia" },
      { grupo: "Contato", nome: "telefone", rotulo: "Celular", tipo: "telefone", obrigatorio: true, largura: "meia", autoComplete: "tel" },
      { nome: "email", rotulo: "E-mail", tipo: "email", largura: "meia", autoComplete: "email" },
    ],
  },
  { id: "familia", titulo: "Família", resumo: "Cônjuge e filhos", campos: [] },
  {
    id: "transporte", titulo: "Transporte e pagamento", resumo: "Vale-transporte e chave PIX",
    campos: [
      { grupo: "Vale-transporte", nome: "usaVt", rotulo: "Vai precisar de vale-transporte?", tipo: "simnao", obrigatorio: true },
      { nome: "vtTrajeto", rotulo: "Quais conduções você pega (ida e volta)?", tipo: "texto", dica: "Ex.: ônibus 875A até a estação, depois metrô linha 4." },
      { grupo: "Pagamento", nome: "pixChave", rotulo: "Chave PIX para receber o salário", tipo: "texto", dica: "CPF, celular, e-mail ou chave aleatória." },
    ],
  },
  { id: "fotos", titulo: "Fotos", resumo: "Sua foto e as dos documentos — tire na hora ou envie da galeria", campos: [] },
  { id: "revisao", titulo: "Revisar e enviar", resumo: "Confira e envie para o RH", campos: [] },
];

export type Valores = Record<string, string | boolean | null>;

const DATA = new Set(["data"]);
const MASCARAS: Partial<Record<TipoCampo, (v: string) => string>> = {
  cpf: mascaraCpf, cep: mascaraCep, telefone: mascaraTelefone, pis: mascaraPis, titulo: mascaraTitulo,
};

/** Dados do servidor → como aparecem nos campos (datas em DD/MM/AAAA). */
export function valoresDe(dados: Dados): Valores {
  const v: Valores = {};
  for (const etapa of ETAPAS) for (const c of etapa.campos) {
    const bruto = dados[c.nome];
    if (DATA.has(c.tipo)) v[c.nome] = isoParaData(bruto);
    else if (typeof bruto === "boolean") v[c.nome] = bruto;
    else if (bruto == null) v[c.nome] = c.padrao ?? "";
    else v[c.nome] = MASCARAS[c.tipo]?.(String(bruto)) ?? String(bruto);
  }
  v.nomeConjuge = typeof dados.nomeConjuge === "string" ? dados.nomeConjuge : "";
  return v;
}

/** Campos de uma etapa → corpo para o servidor, ou o primeiro erro para mostrar. */
export function corpoDaEtapa(etapa: Etapa, valores: Valores, exigeTrajeto = true): { erros: Record<string, string> } | { corpo: Dados } {
  const erros: Record<string, string> = {};
  const corpo: Dados = {};
  for (const c of etapa.campos) {
    const v = valores[c.nome];
    const vazio = v == null || v === "";
    if (c.obrigatorio && vazio) { erros[c.nome] = "Preencha este campo."; continue; }
    if (c.tipo === "simnao" || c.tipo === "sexo") { corpo[c.nome] = vazio ? null : v; continue; }
    const s = typeof v === "string" ? v.trim() : "";
    if (DATA.has(c.tipo)) {
      if (!s) { corpo[c.nome] = null; continue; }
      const iso = dataParaIso(s);
      if (!iso || iso > new Date().toISOString().slice(0, 10)) { erros[c.nome] = "Data inválida. Use DD/MM/AAAA."; continue; }
      corpo[c.nome] = iso;
      continue;
    }
    if (c.tipo === "cpf" && s && !cpfValido(s)) { erros[c.nome] = "CPF inválido. Confira os números."; continue; }
    if (c.tipo === "telefone" && s && soDigitos(s).length < 10) { erros[c.nome] = "Celular com DDD."; continue; }
    if (c.tipo === "cep" && s && soDigitos(s).length !== 8) { erros[c.nome] = "CEP tem 8 números."; continue; }
    if (c.tipo === "pis" && s && soDigitos(s).length !== 11) { erros[c.nome] = "PIS tem 11 números."; continue; }
    if (c.tipo === "titulo" && s && soDigitos(s).length !== 12) { erros[c.nome] = "Título tem 12 números."; continue; }
    if (c.tipo === "email" && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { erros[c.nome] = "E-mail inválido."; continue; }
    if (c.nome === "nomeCompleto" && s && s.split(/\s+/).length < 2) { erros[c.nome] = "Escreva nome e sobrenome."; continue; }
    corpo[c.nome] = s || null;
  }
  // Marcou Sim, escreveu o trajeto e voltou para Não: o trajeto não vale mais.
  if (etapa.id === "transporte" && valores.usaVt !== true) corpo.vtTrajeto = null;
  if (exigeTrajeto && etapa.id === "transporte" && valores.usaVt === true && !String(valores.vtTrajeto ?? "").trim()) {
    erros.vtTrajeto = "Conte quais conduções você usa — é assim que o RH calcula o vale.";
  }
  return Object.keys(erros).length ? { erros } : { corpo };
}

/** Onde a pessoa parou: a primeira etapa com obrigatório vazio (ficha nova começa do início). */
export function etapaInicial(dados: Dados, temArquivos: boolean): number {
  const preenchido = (v: unknown) => v != null && v !== "";
  if (!Object.values(dados).some(preenchido) && !temArquivos) return 0;
  const i = ETAPAS.findIndex((e) => e.campos.some((c) => c.obrigatorio && !preenchido(dados[c.nome])));
  return i === -1 ? ETAPAS.findIndex((e) => e.id === "fotos") : i;
}
