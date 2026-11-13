import type { Decimo13Linha, Decimo13LinhaClt, PagamentoMeio } from "../../api/client";
import { parcelaClt, parcelaDaLinha, resumirClt, resumirParcela } from "../decimo13/parcelas";

export type Pendencia = { chave: string; texto: string; destino: string };

const pessoas = (n: number) => `${n} ${n === 1 ? "pessoa" : "pessoas"}`;

/** Pagamento do meio do mês (dia 15 ou 20) com gente ainda por lançar no Contas a Pagar. */
export function pendenciaDoMeio(rotulo: string, dados: PagamentoMeio | null, destino: string): Pendencia | null {
  const n = dados?.aLancar.pessoas ?? 0;
  return n > 0 ? { chave: rotulo, texto: `${rotulo}: ${pessoas(n)} a lançar no Contas a Pagar`, destino } : null;
}

/** A parcela em curso é a 1ª até novembro e a 2ª em dezembro; antes de outubro o 13º não é assunto. */
export function parcelaEmCurso(mes: number): 1 | 2 | null {
  if (mes === 10 || mes === 11) return 1;
  if (mes === 12) return 2;
  return null;
}

export function pendenciasDoDecimo(mes: number, linhas: Decimo13Linha[], clt: Decimo13LinhaClt[], destino: string): Pendencia[] {
  const n = parcelaEmCurso(mes);
  if (!n) return [];
  const sr = resumirParcela(linhas.map((l) => parcelaDaLinha(l, n)));
  const c = resumirClt(clt.map((l) => parcelaClt(l, n)));
  const out: Pendencia[] = [];
  const aGerar = sr.novas + sr.atualizar;
  if (aGerar > 0) out.push({ chave: "13-sr", texto: `13º salário (${n}ª parcela): ${pessoas(aGerar)} a lançar${sr.atualizar > 0 ? ` ou atualizar` : ""}`, destino });
  if (c.aguardando > 0) out.push({ chave: "13-clt", texto: `13º salário (${n}ª parcela): ${pessoas(c.aguardando)} CLT aguardando o extrato da contabilidade`, destino });
  return out;
}
