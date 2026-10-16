// Guia de imposto (Simples, FGTS, DARF) vence no mês seguinte ao da competência.
// Sem competência a guia fica fora de qualquer DRE, então a tela já sugere esta.
export function competenciaPeloVencimento(vencimento: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vencimento);
  if (!m) return "";
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return "";
  const [anoComp, mesComp] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
  return `${anoComp}-${String(mesComp).padStart(2, "0")}-01`;
}

// Só essas guias seguem a regra; IPTU, taxas, ICMS e parcelamentos têm calendário próprio.
const VENCE_NO_MES_SEGUINTE = /SIMPLES|\bDASN?\b|\bFGTS\b|\bGPS\b|\bINSS\b|\bDARF\b|\bIRRF\b|RECEITA FEDERAL/i;

export function competenciaSugerida(tipo: string, vencimento: string): string {
  if (/PARCELAMENTO/i.test(tipo) || !VENCE_NO_MES_SEGUINTE.test(tipo)) return "";
  return competenciaPeloVencimento(vencimento);
}
