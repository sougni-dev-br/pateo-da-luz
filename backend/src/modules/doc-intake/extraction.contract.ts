// Contrato da extracao: o que pedimos ao modelo e o formato que ele e obrigado
// a devolver. Mantido separado do servico porque e a peca que mais vai mudar
// conforme aparecem layouts novos (condominio, energia, fornecedor).

export type TipoDocumento = "NFSE" | "NFE" | "BOLETO" | "FATURA" | "OUTRO";

/** Resposta crua do modelo — tudo string, nada convertido. */
export type ExtracaoCrua = {
  tipoDocumento: TipoDocumento;
  emissorNome: string | null;
  emissorCnpj: string | null;
  destinatarioNome: string | null;
  destinatarioCnpj: string | null;
  numeroDocumento: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  valorTotal: string | null;
  rubricas: Array<{ descricao: string; valor: string }>;
  linhaDigitavel: string | null;
  documentoReferenciado: string | null;
  /** Como o documento se identifica dentro de um parcelamento: "1/3", "02", "parcela 2 de 5". */
  parcela: string | null;
  observacoes: string | null;
};

const STRING_OR_NULL = { type: "STRING", nullable: true } as const;

export const EXTRACAO_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    tipoDocumento: { type: "STRING", enum: ["NFSE", "NFE", "BOLETO", "FATURA", "OUTRO"] },
    emissorNome: STRING_OR_NULL,
    emissorCnpj: STRING_OR_NULL,
    destinatarioNome: STRING_OR_NULL,
    destinatarioCnpj: STRING_OR_NULL,
    numeroDocumento: STRING_OR_NULL,
    dataEmissao: STRING_OR_NULL,
    dataVencimento: STRING_OR_NULL,
    valorTotal: STRING_OR_NULL,
    rubricas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { descricao: { type: "STRING" }, valor: { type: "STRING" } },
        required: ["descricao", "valor"],
      },
    },
    linhaDigitavel: STRING_OR_NULL,
    documentoReferenciado: STRING_OR_NULL,
    parcela: STRING_OR_NULL,
    observacoes: STRING_OR_NULL,
  },
  required: ["tipoDocumento", "rubricas"],
};

const INSTRUCOES = `Voce le documentos financeiros brasileiros (nota fiscal de servico, NF-e, boleto bancario, fatura) e devolve os campos em JSON.

REGRAS ABSOLUTAS:
1. TRANSCREVA, NAO CALCULE. Copie os valores exatamente como aparecem no documento, incluindo pontos e virgulas ("1.234,56"). Nunca some, converta, arredonde ou complete um valor que nao esta escrito.
2. NUNCA invente. Se um campo nao existe no documento, devolva null. Campo ausente e informacao valida; campo inventado e erro grave.
3. Datas exatamente como escritas ("17/08/2026"). Nao converta formato.
4. emissor = quem PRESTOU o servico / vendeu / esta cobrando (o fornecedor).
   destinatario = quem CONTRATOU / esta pagando (o cliente).
   Em NFS-e, emissor = PRESTADOR DE SERVICOS e destinatario = TOMADOR DE SERVICOS.
   Em boleto, emissor = beneficiario/cedente e destinatario = pagador/sacado.
   Nao troque os dois: e o erro mais caro que existe aqui.
5. rubricas = as linhas de servico/produto/cobranca discriminadas, cada uma com sua descricao e seu valor. Se o documento so tem um valor total sem discriminacao, devolva rubricas vazio.
6. dataVencimento: em NFS-e procure por "Vencimento", "Vencimento Titulos" ou similar. Nao confunda com a data de emissao.
7. documentoReferenciado: se o documento cita outro (ex.: um boleto que diz "Ref. NFS-e: 1454727"), devolva essa referencia. Ela e o que liga o boleto a nota fiscal dele — nao deixe passar.
8. parcela: se o documento se identifica dentro de um parcelamento, devolva como esta escrito ("1/3", "parcela 2 de 5", "02"). Em boleto isso costuma aparecer perto do numero do documento, ou como sufixo dele ("1454727/02" indica a parcela 02). Se o documento nao e parcelado, devolva null.
9. Em BOLETO, valorTotal e o valor DAQUELE boleto (a parcela), nao o valor total da compra. Copie o que esta escrito, sem somar nem dividir nada.

Extraia do documento abaixo:

`;

/**
 * Prompt para documento escaneado: o PDF vai junto como binario, entao nao ha
 * texto para colar aqui. As regras sao as mesmas — a unica diferenca e o aviso
 * sobre leitura de imagem, onde numero borrado e risco real.
 */
export function montarPromptVisao(): string {
  return INSTRUCOES + [
    "O documento esta anexado como arquivo (digitalizado ou fotografado).",
    "",
    "ATENCAO ESPECIAL POR SER IMAGEM: se um numero, data ou digito estiver borrado, cortado ou ilegivel, devolva null naquele campo. NUNCA adivinhe um digito — um valor chutado entra na contabilidade como se fosse verdade.",
  ].join("\n");
}

export function montarPrompt(textoDocumento: string, maxChars = 20_000): string {
  const texto = textoDocumento.length > maxChars
    ? `${textoDocumento.slice(0, maxChars)}\n[...documento truncado...]`
    : textoDocumento;
  return `${INSTRUCOES}---INICIO DO DOCUMENTO---\n${texto}\n---FIM DO DOCUMENTO---`;
}
