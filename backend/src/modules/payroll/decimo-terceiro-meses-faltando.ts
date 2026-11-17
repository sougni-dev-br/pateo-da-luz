// Meses (1 a 11) dentro do período de 13º de uma pessoa em que falta a variável (gorjeta + extras) para a média.
// Serve para a tela dizer, por pessoa, o que falta e deixar o usuário informar o valor de cada mês.
import { mesesDe13 } from "./rescisao-verbas-opcionais.js";

export type MotivoMesFaltando =
  // O mês não tem apuração de gorjeta no sistema: fica fora da média (nem soma, nem entra na divisão).
  | "SEM_APURACAO"
  // O mês foi apurado, mas a pessoa não aparece nele: conta como zero na média (gorjeta paga por fora, por exemplo).
  | "SEM_LANCAMENTO"
  // O mês ainda não terminou ou não foi fechado: fica fora da média até fechar.
  | "EM_ANDAMENTO";

export type MesFaltando = { mes: number; motivo: MotivoMesFaltando };

export type EntradaMesesFaltando = {
  ano: number;
  inicio: Date | null;
  desligamento: Date | null;
  // Fim do período sem registro (quem foi registrado depois): o mês da carteira é da contabilidade.
  ate: Date | null;
  diasAfastados?: ReadonlySet<string>;
  // Valor por mês que a pessoa tem na apuração (o informado à mão também entra aqui, mas vem separado em `informados`).
  variaveis: ReadonlyMap<number, number> | undefined;
  // Meses que a pessoa já tem informados à mão: não faltam.
  informados: ReadonlySet<number>;
  // Situação da apuração de cada mês (ausente = sem apuração) e os meses que entram na média.
  status: ReadonlyMap<number, string>;
  apurados: ReadonlySet<number>;
};

export function mesesSemVariavel(e: EntradaMesesFaltando): MesFaltando[] {
  if (!e.inicio) return [];
  const fimDoAno = new Date(Date.UTC(e.ano, 11, 31));
  if (e.inicio.getTime() > fimDoAno.getTime()) return [];
  // Saída ou fim do período em ano anterior: não há 13º neste ano.
  if ([e.desligamento, e.ate].some((x) => x != null && x.getUTCFullYear() < e.ano)) return [];
  const limites = [e.desligamento, e.ate].filter((x): x is Date => x != null && x.getUTCFullYear() === e.ano);
  const limite = limites.reduce((menor, x) => (x.getTime() < menor.getTime() ? x : menor), fimDoAno);
  const fimDeNovembro = new Date(Date.UTC(e.ano, 11, 0));
  const ateNovembro = fimDeNovembro.getTime() < limite.getTime() ? fimDeNovembro : limite;
  const { meses } = mesesDe13(e.inicio, ateNovembro, e.diasAfastados);
  const faltando: MesFaltando[] = [];
  for (const mes of meses) {
    if (mes > 11 || e.informados.has(mes)) continue;
    if (!e.status.has(mes)) faltando.push({ mes, motivo: "SEM_APURACAO" });
    else if (!e.apurados.has(mes)) faltando.push({ mes, motivo: "EM_ANDAMENTO" });
    else if (!e.variaveis?.has(mes)) faltando.push({ mes, motivo: "SEM_LANCAMENTO" });
  }
  return faltando;
}
