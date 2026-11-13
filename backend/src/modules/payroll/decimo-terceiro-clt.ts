// 13º de quem tem registro (CLT): não é calculado aqui, vem do extrato da contabilidade
// (Retorno do RH). A tela só mostra o que já foi importado e quem ainda aguarda o extrato.

export type ParcelaClt = { valor: number; pago: boolean };
export type LinhaDecimo13Clt = {
  employeeId: string; nome: string; setor: string | null;
  parcela1: ParcelaClt | null; parcela2: ParcelaClt | null;
};
export type ItemDecimo13 = { employeeId: string; periodLabel: string; amount: number; status: string };

/**
 * 1 ou 2, lido do rótulo do lançamento vindo do extrato ("13º Salário - 1ª parcela (extrato)").
 * Só vale o que tem "(extrato)": o 13º do período sem registro tem outro rótulo, de propósito,
 * e não pode entrar aqui (a mesma pessoa pode ter os dois).
 */
export function parcelaDoRotulo(rotulo: string): 1 | 2 | null {
  if (!/\(extrato\)/i.test(rotulo)) return null;
  if (/1ª\s*parcela/i.test(rotulo)) return 1;
  if (/2ª\s*parcela/i.test(rotulo)) return 2;
  return null;
}

export function montarLinhasClt(
  pessoas: Array<{ employeeId: string; nome: string; setor: string | null }>,
  itens: ItemDecimo13[],
): LinhaDecimo13Clt[] {
  const porPessoa = new Map<string, { 1?: ParcelaClt; 2?: ParcelaClt }>();
  for (const i of itens) {
    const n = parcelaDoRotulo(i.periodLabel);
    if (!n) continue;
    const atual = porPessoa.get(i.employeeId) ?? {};
    // Duas importações da mesma parcela não dobram o valor: vale a mais recente que já foi paga, senão a última.
    atual[n] = { valor: i.amount, pago: i.status === "PAID" || atual[n]?.pago === true };
    porPessoa.set(i.employeeId, atual);
  }
  return pessoas.map((p) => ({
    ...p, parcela1: porPessoa.get(p.employeeId)?.[1] ?? null, parcela2: porPessoa.get(p.employeeId)?.[2] ?? null,
  }));
}
