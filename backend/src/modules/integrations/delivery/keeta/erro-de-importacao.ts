/**
 * Erro que PODE ser mostrado ao usuário: a mensagem foi escrita de propósito para ele.
 * Qualquer outra exceção (Prisma, exceljs, banco) é interna e não deve vazar na resposta.
 */
export class ErroDeImportacao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeImportacao";
  }
}
