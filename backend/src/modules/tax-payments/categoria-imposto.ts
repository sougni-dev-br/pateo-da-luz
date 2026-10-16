// Sugere a categoria do DRE de uma guia pelo tipo do documento (e, no DARF, pela
// descrição). Sem categoria o imposto cai em "Não categorizadas" no DRE, fora do
// grupo Impostos — por isso lançamento manual e importação preenchem sozinhos.
// Os nomes devolvidos são os das categorias que existem em produção.

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();
}

const PARCELAMENTO = /PARCELAMENTO|DIV(IDA)? ATIVA/;
const SIMPLES = /SIMPLES|\bDASN?\b/;
const FGTS = /\bFGTS\b/;
const PREVIDENCIA = /\bGPS\b|\bINSS\b|PREVIDENCIA|PRECIDENCIA/;
const ISS = /\bISS\b/;
const ICMS = /\bDARE\b|\bDARE-SP\b|ICMS/;
const TAXA_MUNICIPAL = /\bTFE\b|TAXA/;
const IPTU = /\bIPTU\b/;
const RECEITA = /DARF|RECEITA FEDERAL|\bIRRF\b/;

// No DARF da Receita (DCTFWeb) vêm juntos INSS e IRRF. Havendo imposto de renda,
// fica em IRRF / DARF; só contribuição previdenciária, vai para INSS.
const RENDA = /\bIRRF\b|\bIRPJ\b|IMPOSTO SOBRE RENDA|\bIR\b/;
const CONTRIBUICAO = /CONTR PREV|\bCP SEGURADO|\bINSS\b|PREVID/;

export function sugerirCategoriaImposto(
  documentType: string | null | undefined,
  description: string | null | undefined
): string | null {
  const tipo = normalizar(documentType);
  const descricao = normalizar(description);
  if (!tipo) return null;

  // GPS de parcelamento continua em INSS, como sempre foi classificada.
  if (PREVIDENCIA.test(tipo) && !RECEITA.test(tipo)) return "INSS";
  if (PARCELAMENTO.test(tipo) || PARCELAMENTO.test(descricao)) return "Parcelamentos Tributarios";
  if (RECEITA.test(tipo)) {
    if (RENDA.test(descricao)) return "IRRF / DARF";
    if (CONTRIBUICAO.test(descricao)) return "INSS";
    return "IRRF / DARF";
  }
  if (SIMPLES.test(tipo)) return "Simples Nacional";
  if (FGTS.test(tipo)) return "FGTS";
  if (ISS.test(tipo)) return null;
  if (ICMS.test(tipo)) return "GARE / ICMS";
  if (IPTU.test(tipo)) return "IPTU";
  if (TAXA_MUNICIPAL.test(tipo)) return "Taxas Municipais";
  return null;
}

export function categoriaIdPorNome(
  categorias: ReadonlyArray<{ id: string; name: string }>,
  nome: string | null
): string | null {
  if (!nome) return null;
  const alvo = normalizar(nome);
  return categorias.find((c) => normalizar(c.name) === alvo)?.id ?? null;
}
