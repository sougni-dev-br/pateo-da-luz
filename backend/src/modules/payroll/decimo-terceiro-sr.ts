// 13º salário de quem NÃO tem registro (NAO_CLT) — decisões do Eli, 05/11/2026:
// - Avos contam desde o início real (Employee.admissionDate), mesmo que a carteira seja
//   posterior ou que a pessoa nunca tenha sido registrada. Mês com 15 dias ou mais = 1 avo.
//   Quem foi registrado no ano (admissaoCarteira): o período sem registro vai até o fim do mês
//   anterior à carteira; o mês da carteira e o resto do ano vêm do extrato da contabilidade.
// - Base: salário base vigente em 20/12 + média mensal das variáveis (gorjeta, hora extra e
//   adicional noturno) pela regra da contabilidade — ver calcularDecimoTerceiroSR.
// - Duas parcelas: 50% até 30/11 e o acerto (13º completo − 1ª paga) até 20/12.
// CLT não passa por aqui: o valor vem do extrato da contabilidade.
import { avos13, mesesDe13 } from "./rescisao-verbas-opcionais.js";
import { round2 } from "./vt-calc.js";

export const PARCELA_1_DIA = { mes: 11, dia: 30 } as const;
export const PARCELA_2_DIA = { mes: 12, dia: 20 } as const;
export const ROTULO_13_PARCELA_1 = "13º Salário - 1ª parcela";
export const ROTULO_13_PARCELA_2 = "13º Salário - 2ª parcela";
// 1ª parcela que vem do extrato da contabilidade (CLT). Rótulo próprio: quem foi registrado depois
// tem as duas coisas (o extrato e o período sem registro) e a chave única inclui o rótulo.
export const ROTULO_13_EXTRATO_PARCELA_1 = "13º Salário - 1ª parcela (extrato)";

export type Decimo13SR = {
  ano: number;
  // Avos do ano todo (até dezembro) e os usados na 1ª parcela (até novembro; 12 para o ano inteiro).
  avos: number; avosParcela1: number; desde: string; salario: number;
  // Média mensal das variáveis: até outubro (1ª parcela) e até novembro (13º completo).
  mediaParcela1: number; mediaFinal: number;
  // 1ª parcela; 13º completo; 2ª parcela = completo − 1ª (se a 1ª foi paga como calculada).
  parcela1: number; total: number; parcela2: number;
  vencimento1: string; vencimento2: string; memoria: string;
};

// O que fazer com uma parcela ao gerar, conforme o que já existe no banco (inclusive excluído).
// Pago, existente e excluído à mão NUNCA são mexidos: só o excluído sem autor (legado) volta.
export type ParcelaExistente = { deletedAt: Date | null; deletedById: string | null; paymentDate: Date | null } | null;
export type DecisaoParcela = "criar" | "restaurar" | "ja-existe" | "ja-pago" | "excluida-a-mao";
export function decidirParcela(e: ParcelaExistente): DecisaoParcela {
  if (!e) return "criar";
  if (e.deletedAt) return e.deletedById ? "excluida-a-mao" : "restaurar";
  return e.paymentDate ? "ja-pago" : "ja-existe";
}

// De onde vem um lançamento de 13º: o extrato da contabilidade (CLT) ou o cálculo sem registro.
// Os dois convivem para quem foi registrado depois; dois do MESMO lado e da mesma parcela, não.
export function familia13(rotulo: string): { parcela: 1 | 2 | null; origem: "EXTRATO" | "SEM_REGISTRO" } {
  const parcela = /1ª\s*parcela/i.test(rotulo) ? 1 : /2ª\s*parcela/i.test(rotulo) ? 2 : null;
  return { parcela, origem: /\(extrato\)/i.test(rotulo) ? "EXTRATO" : "SEM_REGISTRO" };
}

const br = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);

// Último dia sem registro de quem foi registrado depois do início real: o mês da carteira é da
// contabilidade, então o período termina no fim do mês anterior (decisão do Eli, 05/11/2026).
export function fimSemRegistro(admissao: Date | null, carteira: Date | null): Date | null {
  if (!admissao || !carteira || carteira.getTime() <= admissao.getTime()) return null;
  return new Date(Date.UTC(carteira.getUTCFullYear(), carteira.getUTCMonth(), 0));
}

// Variáveis por mês (1 a 12): gorjeta + hora extra + adicional noturno. O DSR sobre a hora extra NÃO
// entra: é como a contabilidade calcula o 13º do CLT (conferido nos extratos de 11/2026).
export type VariaveisPorMes = ReadonlyMap<number, number>;

// Regra da contabilidade (conferida centavo a centavo com os extratos reais do 13º adiantamento):
// - média mensal = soma das variáveis dos meses já apurados ÷ número desses meses, NÃO ÷ 12. Quem
//   entrou em agosto tem a média de agosto a outubro dividida por 3. Mês SEM apuração de gorjeta no
//   sistema fica de fora (nem soma, nem entra na divisão): a gorjeta já era paga nesses meses (decisão
//   do Eli, 13/11/2026), então contar zero pagaria a menos. Mês apurado em que a pessoa não ganhou
//   nada conta como zero.
// - 1ª parcela = (salário + média até outubro) ÷ 12 × avos da 1ª ÷ 2, onde os avos da 1ª são os
//   de até novembro, e 12 para quem trabalhou o ano todo (50% do salário, como nos extratos).
// - 13º completo = (salário + média até novembro) ÷ 12 × avos do ano.
// - 2ª parcela = 13º completo − o que a 1ª parcela pagou: assim ninguém recebe a mais nem a menos.
// null = não há 13º a gerar (sem início, sem salário, saiu antes do ano, ou 0 avos).
export function calcularDecimoTerceiroSR(e: {
  ano: number; salarioBase: number | null; inicio: Date | null; desligamento: Date | null;
  variaveis?: VariaveisPorMes;
  // Meses (1 a 12) com apuração de gorjeta no sistema. Ausente = todos os meses contam.
  mesesApurados?: ReadonlySet<number>;
  // Fim do período a contar (quem foi registrado depois: o último dia sem registro; o mês da
  // carteira é da contabilidade). Antes do ano = nada a pagar neste ano.
  ate?: Date | null;
}): Decimo13SR | null {
  if (!e.inicio || e.salarioBase == null || !(e.salarioBase > 0)) return null;
  const fimDoAno = new Date(Date.UTC(e.ano, 11, 31));
  if (e.inicio.getTime() > fimDoAno.getTime()) return null;
  if (e.desligamento && e.desligamento.getUTCFullYear() < e.ano) return null;
  if (e.ate && e.ate.getUTCFullYear() < e.ano) return null;
  const limites = [e.desligamento, e.ate].filter((x): x is Date => x != null && x.getUTCFullYear() === e.ano);
  const limite = limites.reduce((menor, x) => (x.getTime() < menor.getTime() ? x : menor), fimDoAno);
  const fimDoMes = (mes: number) => new Date(Date.UTC(e.ano, mes, 0));
  const ateMes = (mes: number) => (fimDoMes(mes).getTime() < limite.getTime() ? fimDoMes(mes) : limite);
  const avosAte = (mes: number) => avos13(e.inicio!, ateMes(mes)).avos;

  const avos = avosAte(12);
  if (avos <= 0) return null;
  const avosNov = avosAte(11);
  // Quem trabalhou de janeiro a novembro recebe 50% cheio na 1ª (12 avos): é o que a contabilidade
  // faz. Nunca mais que os avos do ano, para a 2ª parcela não ficar negativa (saída em novembro).
  const avosPrimeira = Math.min(avosNov >= 11 ? 12 : avosNov, avos);
  // Média até o mês: só os meses em que a pessoa tinha avo E que têm apuração, ÷ quantos são.
  const mediaAte = (mes: number) => {
    const doAvo = mesesDe13(e.inicio!, ateMes(mes)).meses;
    const contam = e.mesesApurados ? doAvo.filter((m) => e.mesesApurados!.has(m)) : doAvo;
    if (contam.length === 0) return 0;
    let soma = 0;
    for (const m of contam) {
      const v = e.variaveis?.get(m);
      if (v != null && Number.isFinite(v)) soma += v;
    }
    return Math.max(0, soma) / contam.length;
  };
  const media1 = mediaAte(10);
  const mediaFinal = mediaAte(11);
  const salario = round2(e.salarioBase);
  const parcela1 = round2(((salario + media1) / 12 * avosPrimeira) / 2);
  const total = round2((salario + mediaFinal) / 12 * avos);
  const parcela2 = round2(total - parcela1);
  const desde = avos13(e.inicio, ateMes(12)).desde;
  const plural = (n: number) => `${n} ${n === 1 ? "avo" : "avos"}`;
  return {
    ano: e.ano, avos, avosParcela1: avosPrimeira, desde, salario, mediaParcela1: round2(media1), mediaFinal: round2(mediaFinal), parcela1, total, parcela2,
    vencimento1: iso(e.ano, PARCELA_1_DIA.mes, PARCELA_1_DIA.dia),
    vencimento2: iso(e.ano, PARCELA_2_DIA.mes, PARCELA_2_DIA.dia),
    memoria: `1ª: (S ${br(salario)} + média ${br(round2(media1))}) ÷ 12 × ${plural(avosPrimeira)} ÷ 2 = ${br(parcela1)} · `
      + `13º: (S ${br(salario)} + média ${br(round2(mediaFinal))}) ÷ 12 × ${plural(avos)} = ${br(total)} · 2ª = ${br(parcela2)} (desde ${desde.split("-").reverse().join("/")})`,
  };
}

// 2ª parcela de fato: o 13º completo menos o que a 1ª parcela pagou. Se a 1ª passou do total (a
// média caiu, o salário foi corrigido para baixo), a 2ª é zero e a diferença aparece como excesso.
export function segundaParcela(total: number, primeiraPaga: number): { valor: number; excesso: number } {
  const resto = round2(total - primeiraPaga);
  return resto >= 0 ? { valor: resto, excesso: 0 } : { valor: 0, excesso: round2(-resto) };
}

// Quanto a 1ª parcela JÁ pagou, para a 2ª fazer o acerto. Paga: o valor realmente pago (pode ter
// sido ajustado na baixa). Excluída (à mão = paga por fora): conta como calculada. Ainda a pagar:
// será atualizada para o valor calculado, então conta o calculado.
export function primeiraParaAcerto(
  item: { deletedAt: Date | null; paymentDate: Date | null; paidAmount: unknown; amount: unknown } | null, calculada: number,
): number {
  if (!item || item.deletedAt || !item.paymentDate) return calculada;
  const pago = Number(item.paidAmount ?? item.amount);
  return Number.isFinite(pago) ? round2(pago) : calculada;
}
