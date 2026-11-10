// Férias parceladas: o formulário lança as partes de uma vez. Aqui ficam as regras (as mesmas que o servidor
// repete na rota /parcelado), para a tela avisar antes de gravar.
import { fimEVolta } from "./feriasFormato";
import { MAX_PARTES, MIN_DIAS_PARTE_MAIOR, dataValida } from "./regrasFerias";

export const MIN_DIAS_PARTE = 5;
/** Menor total que dá para dividir: uma parte de 14 dias e outra de pelo menos 5. */
export const MIN_DIAS_PARA_PARCELAR = MIN_DIAS_PARTE_MAIOR + MIN_DIAS_PARTE;

export type ParteEmEdicao = { inicio: string; dias: string };
export type ErrosDaParte = { inicio?: string; dias?: string };
export type ResultadoDasPartes = { porParte: ErrosDaParte[]; geral: string[]; valido: boolean };

/** Duas partes: a maior com 14 dias e o resto na outra. */
export function partesIniciais(total: number): ParteEmEdicao[] {
  const primeira = Math.min(MIN_DIAS_PARTE_MAIOR, total - MIN_DIAS_PARTE);
  return [{ inicio: "", dias: String(primeira) }, { inicio: "", dias: String(total - primeira) }];
}

const inteiro = (v: string): number | null => (v !== "" && Number.isInteger(Number(v)) ? Number(v) : null);

/**
 * `total` é o que as partes precisam somar (o saldo do período, sem o abono). `vedado` devolve o motivo de uma data de início
 * não poder ser usada (repouso, feriado) ou null.
 */
export function validarPartes(partes: ParteEmEdicao[], total: number, aquisitivoFim: string, vedado: (inicio: string) => string | null): ResultadoDasPartes {
  const porParte: ErrosDaParte[] = partes.map((p) => {
    const erros: ErrosDaParte = {};
    if (p.inicio === "") erros.inicio = "Informe a data de início.";
    else if (!dataValida(p.inicio)) erros.inicio = "Data inválida.";
    else if (p.inicio <= aquisitivoFim) erros.inicio = "Só depois do fim do período aquisitivo.";
    else erros.inicio = vedado(p.inicio) ?? undefined;
    const dias = inteiro(p.dias);
    if (dias === null || dias < MIN_DIAS_PARTE) erros.dias = `Cada parte tem no mínimo ${MIN_DIAS_PARTE} dias.`;
    return erros;
  });
  const geral: string[] = [];
  const dias = partes.map((p) => inteiro(p.dias));
  if (partes.length > MAX_PARTES) geral.push(`No máximo ${MAX_PARTES} partes.`);
  if (dias.every((d) => d !== null)) {
    const soma = (dias as number[]).reduce((s, d) => s + d, 0);
    if (soma !== total) geral.push(`As partes somam ${soma} ${soma === 1 ? "dia" : "dias"}; precisam fechar ${total}.`);
    else if (Math.max(...(dias as number[])) < MIN_DIAS_PARTE_MAIOR) geral.push(`Uma das partes precisa ter pelo menos ${MIN_DIAS_PARTE_MAIOR} dias (CLT, art. 134, § 1º).`);
  }
  partes.forEach((a, i) => partes.slice(i + 1).forEach((b, j) => {
    const x = dataValida(a.inicio) && dias[i] !== null ? fimEVolta(a.inicio, dias[i] as number) : null;
    const y = dataValida(b.inicio) && dias[i + 1 + j] !== null ? fimEVolta(b.inicio, dias[i + 1 + j] as number) : null;
    if (x && y && a.inicio <= y.fim && b.inicio <= x.fim) geral.push(`As partes ${i + 1} e ${i + j + 2} se sobrepõem.`);
  }));
  const valido = geral.length === 0 && porParte.every((e) => !e.inicio && !e.dias);
  return { porParte, geral, valido };
}
