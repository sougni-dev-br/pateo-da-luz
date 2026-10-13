// Erro de "periodo travado": mes com fechamento travado ou apuracao de CMV fechada.
//
// Existe para que quem PULA o dia travado (os sincronizadores) consiga distinguir a trava de
// qualquer outra falha. Antes, o sync do PDV usava `catch {}` sem olhar o erro: uma queda
// passageira do banco aparecia como "periodo fechado/mes travado", o faturamento do dia
// deixava de ser gravado e a auditoria registrava um bloqueio que nunca existiu (13/10/2026:
// 19 dias de agosto, sem nenhum periodo fechado ou mes travado no banco).
//
// E um Error comum: quem ja captura `Error` e le `message` segue funcionando igual.
export class PeriodLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodLockedError";
  }
}

export function isPeriodLockedError(error: unknown): error is PeriodLockedError {
  return error instanceof PeriodLockedError;
}
