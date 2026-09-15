// Como os documentos enviados juntos viram TÍTULOS.
//
// O caso simples e uma nota com o boleto dela: dois arquivos, um lancamento.
// O caso que importa de verdade e a nota parcelada: uma nota de R$ 3.000 com
// tres boletos de R$ 1.000. Ali os documentos NAO compartilham valor nem
// vencimento — cada boleto tem os seus — entao agrupar por valor+vencimento nao
// funciona. Sem isto, tres boletos virariam tres despesas de R$ 1.000 alem da
// nota, e a conta triplicava.

import type { DocumentoEnriquecido, SugestaoFornecedor } from "./doc-enrich.service.js";
import type { Aviso, DocumentoExtraido } from "./doc-extract.service.js";
import { onlyDigits } from "./document-validators.js";

const TOLERANCIA_CENTAVOS = 0.01;

export type ParcelaTitulo = {
  numero: number;
  dataVencimento: Date | null;
  valor: number | null;
  /** Arquivo de onde esta parcela veio — a pessoa precisa saber o que conferir. */
  origem: string;
  linhaDigitavel: string | null;
  /** "1/3" como estava escrito, quando havia. */
  rotuloLido: string | null;
};

export type TituloAgrupado = {
  chave: string | null;
  documentos: string[];
  tipoPrincipal: string;
  fornecedor: SugestaoFornecedor;
  fornecedorNome: string | null;
  empresa: { id: string; nome: string } | null;
  numeroDocumento: string | null;
  dataEmissao: Date | null;
  /** Vencimento da primeira parcela. */
  dataVencimento: Date | null;
  valorTotal: number | null;
  parcelas: ParcelaTitulo[];
  rubricas: DocumentoExtraido["rubricas"];
  linhaDigitavel: string | null;
  duplicatas: DocumentoEnriquecido["duplicatas"];
  lidoPorImagem: boolean;
  avisos: Aviso[];
  podeConfirmar: boolean;
};

const TIPOS_FISCAIS = new Set(["NFSE", "NFE", "FATURA"]);
const PRIORIDADE_FISCAL: Record<string, number> = { NFSE: 0, NFE: 0, FATURA: 1, OUTRO: 2, BOLETO: 3 };

function soNumeros(texto: string | null): string {
  return (texto ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** "1454727/02" -> "1454727". O sufixo e o numero da parcela, nao do titulo. */
function raizDoNumero(numero: string | null): string {
  if (!numero) return "";
  return soNumeros(numero.split(/[\/\-]/)[0] ?? numero);
}

function mesmoEmissor(a: DocumentoEnriquecido, b: DocumentoEnriquecido): boolean {
  const cnpjA = onlyDigits(a.emissor.cnpjDigits);
  const cnpjB = onlyDigits(b.emissor.cnpjDigits);
  return cnpjA.length === 14 && cnpjA === cnpjB;
}

/** O boleto cita o numero da nota? E o sinal mais forte que existe de vinculo. */
function citaANota(boleto: DocumentoEnriquecido, fiscal: DocumentoEnriquecido): boolean {
  const numeroFiscal = soNumeros(fiscal.numeroDocumento);
  if (!numeroFiscal || numeroFiscal.length < 3) return false;
  const referencia = soNumeros(boleto.documentoReferenciado);
  if (referencia && referencia.includes(numeroFiscal)) return true;
  // Boleto costuma repetir o numero da nota na propria numeracao: "1454727/02".
  return raizDoNumero(boleto.numeroDocumento) === numeroFiscal;
}

function somar(documentos: DocumentoEnriquecido[]): number {
  return documentos.reduce((total, documento) => total + (documento.valorTotal ?? 0), 0);
}

function bate(valorA: number, valorB: number | null): boolean {
  return valorB !== null && Math.abs(valorA - valorB) <= TOLERANCIA_CENTAVOS;
}

function ordenarPorVencimento(documentos: DocumentoEnriquecido[]): DocumentoEnriquecido[] {
  return [...documentos].sort((a, b) => {
    const dataA = a.dataVencimento?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const dataB = b.dataVencimento?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return dataA - dataB;
  });
}

function montarParcelas(boletos: DocumentoEnriquecido[], fiscal: DocumentoEnriquecido | null): ParcelaTitulo[] {
  if (boletos.length > 0) {
    return ordenarPorVencimento(boletos).map((boleto, indice) => ({
      numero: indice + 1,
      dataVencimento: boleto.dataVencimento,
      valor: boleto.valorTotal,
      origem: boleto.nomeArquivo,
      linhaDigitavel: boleto.linhaDigitavel,
      rotuloLido: boleto.parcela,
    }));
  }
  // Sem boleto, o titulo tem uma parcela so: a propria nota.
  if (!fiscal) return [];
  return [{
    numero: 1,
    dataVencimento: fiscal.dataVencimento,
    valor: fiscal.valorTotal,
    origem: fiscal.nomeArquivo,
    linhaDigitavel: fiscal.linhaDigitavel,
    rotuloLido: fiscal.parcela,
  }];
}

function unirAvisos(documentos: DocumentoEnriquecido[]): Aviso[] {
  const avisos: Aviso[] = [];
  const vistos = new Set<string>();
  for (const documento of documentos) {
    for (const aviso of documento.avisos) {
      if (vistos.has(aviso.codigo)) continue;
      vistos.add(aviso.codigo);
      avisos.push(aviso);
    }
  }
  return avisos;
}

/**
 * Funde os documentos de um titulo num rascunho de lancamento.
 * O documento fiscal manda nos dados cadastrais; os boletos viram as parcelas.
 */
export function consolidarTitulo(documentos: DocumentoEnriquecido[]): TituloAgrupado {
  const ordenados = [...documentos].sort(
    (a, b) => (PRIORIDADE_FISCAL[a.tipoDocumento] ?? 9) - (PRIORIDADE_FISCAL[b.tipoDocumento] ?? 9),
  );
  const principal = ordenados[0];
  const fiscal = ordenados.find((documento) => TIPOS_FISCAIS.has(documento.tipoDocumento)) ?? null;
  const boletos = ordenados.filter((documento) => documento.tipoDocumento === "BOLETO");

  const primeiro = <T>(pegar: (doc: DocumentoEnriquecido) => T | null): T | null =>
    ordenados.map(pegar).find((valor) => valor !== null && valor !== undefined) ?? null;

  const parcelas = montarParcelas(boletos, fiscal ?? principal);
  const somaParcelas = parcelas.reduce((total, parcela) => total + (parcela.valor ?? 0), 0);

  // O total do titulo e o da nota quando ha nota; sem nota, e a soma dos boletos.
  const valorTotal = fiscal?.valorTotal ?? (parcelas.length > 0 ? somaParcelas : principal.valorTotal);

  const avisos = unirAvisos(ordenados);

  if (parcelas.length > 1) {
    avisos.push({
      nivel: "ATENCAO",
      codigo: "TITULO_PARCELADO",
      mensagem: `Este título tem ${parcelas.length} parcelas, montadas a partir dos boletos enviados. Confira os vencimentos e os valores.`,
    });
  }

  if (valorTotal !== null && parcelas.length > 0 && !bate(somaParcelas, valorTotal)) {
    avisos.push({
      nivel: "BLOQUEIO",
      codigo: "PARCELAS_NAO_SOMAM",
      mensagem: `As parcelas somam ${somaParcelas.toFixed(2)}, diferente do valor do título (${valorTotal.toFixed(2)}). Pode estar faltando um boleto, ou sobrando um que não é deste título.`,
    });
  }

  const dono = fiscal ?? principal;

  return {
    chave: dono.chaveTitulo,
    documentos: ordenados.map((documento) => documento.nomeArquivo),
    tipoPrincipal: principal.tipoDocumento,
    fornecedor: dono.fornecedor,
    fornecedorNome: dono.fornecedor.cadastrado ? dono.fornecedor.nome : dono.emissor.nome,
    empresa: primeiro((documento) => documento.empresa),
    numeroDocumento: fiscal?.numeroDocumento ?? primeiro((documento) => documento.numeroDocumento),
    dataEmissao: primeiro((documento) => documento.dataEmissao),
    dataVencimento: parcelas[0]?.dataVencimento ?? primeiro((documento) => documento.dataVencimento),
    valorTotal,
    parcelas,
    rubricas: ordenados.find((documento) => documento.rubricas.length > 0)?.rubricas ?? [],
    linhaDigitavel: primeiro((documento) => documento.linhaDigitavel),
    duplicatas: dono.duplicatas,
    lidoPorImagem: ordenados.some((documento) => documento.lidoPorImagem),
    avisos,
    podeConfirmar: !avisos.some((aviso) => aviso.nivel === "BLOQUEIO"),
  };
}

/**
 * Decide quais documentos pertencem ao mesmo titulo.
 *
 * Ordem das evidencias, da mais forte para a mais fraca — e so isso: quando
 * nenhuma vale, os documentos ficam separados. Agrupar no escuro criaria um
 * lancamento que ninguem pediu; deixar separado, no maximo, da trabalho.
 */
export function agruparTitulos(documentos: DocumentoEnriquecido[]): TituloAgrupado[] {
  const fiscais = documentos.filter((documento) => TIPOS_FISCAIS.has(documento.tipoDocumento));
  const boletos = documentos.filter((documento) => documento.tipoDocumento === "BOLETO");
  const avulsos = documentos.filter(
    (documento) => !TIPOS_FISCAIS.has(documento.tipoDocumento) && documento.tipoDocumento !== "BOLETO",
  );

  const usados = new Set<DocumentoEnriquecido>();
  const grupos: DocumentoEnriquecido[][] = [];

  for (const fiscal of fiscais) {
    if (usados.has(fiscal)) continue;
    const disponiveis = boletos.filter((boleto) => !usados.has(boleto) && mesmoEmissor(boleto, fiscal));

    // 1. Boleto que cita a nota: vinculo explicito, o mais confiavel.
    let escolhidos = disponiveis.filter((boleto) => citaANota(boleto, fiscal));

    // 2. Sem citacao: se os boletos do mesmo emissor somam exatamente o total da
    //    nota, sao as parcelas dela. A soma exata e uma coincidencia improvavel.
    if (escolhidos.length === 0 && disponiveis.length > 0 && bate(somar(disponiveis), fiscal.valorTotal)) {
      escolhidos = disponiveis;
    }

    // 3. Ultimo caso: boleto unico de mesmo valor e mesmo vencimento da nota.
    if (escolhidos.length === 0) {
      escolhidos = disponiveis.filter(
        (boleto) => bate(boleto.valorTotal ?? 0, fiscal.valorTotal)
          && boleto.dataVencimento?.getTime() === fiscal.dataVencimento?.getTime(),
      );
    }

    usados.add(fiscal);
    escolhidos.forEach((boleto) => usados.add(boleto));
    grupos.push([fiscal, ...escolhidos]);
  }

  // Boletos sem nota: juntam-se entre si quando compartilham emissor e a raiz do
  // numero ("1454727/01" e "1454727/02" sao do mesmo titulo).
  const orfaos = boletos.filter((boleto) => !usados.has(boleto));
  const porRaiz = new Map<string, DocumentoEnriquecido[]>();
  for (const boleto of orfaos) {
    const raiz = raizDoNumero(boleto.numeroDocumento);
    const chave = raiz
      ? `${onlyDigits(boleto.emissor.cnpjDigits)}|${raiz}`
      : `__sozinho__${boleto.hash}`;
    const atual = porRaiz.get(chave);
    if (atual) atual.push(boleto);
    else porRaiz.set(chave, [boleto]);
  }
  grupos.push(...porRaiz.values());

  for (const avulso of avulsos) grupos.push([avulso]);

  return grupos.map(consolidarTitulo);
}
