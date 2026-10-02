// Limite de segurança por origem (compras, impostos, Folha, extras) no Contas a Pagar e no
// relatório. Não é paginação: o ano inteiro cabe com folga; se for atingido, a tela é avisada
// (cabeçalho X-Payables-Truncado). Módulo próprio para os extras (payroll) usarem o mesmo
// valor sem importar as rotas de compras (que já importam os extras: import circular).
export const LIMITE_POR_ORIGEM = 5000;
