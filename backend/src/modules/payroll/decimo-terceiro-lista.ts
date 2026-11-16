// Lista de pagamento do 13º (1ª ou 2ª parcela), no mesmo molde da lista do adiantamento e da 1ª
// quinzena: uma linha por pessoa, agrupada por empresa (sem registro num grupo só), com a situação
// (a lançar, lançado, pago) e os dados bancários, para conferir e levar ao banco. Nada é gravado.
//   - CLT: o título do extrato da contabilidade; quem tem salário combinado já leva a diferença SOMADA.
//   - Sem registro: o sistema calcula; o que ainda não foi lançado aparece como "a lançar".
import { complementoSomado, foiSomado, liquidoDoExtrato } from "./decimo-terceiro-combinado.js";
import { familia13 } from "./decimo-terceiro-sr.js";
import type { LinhaPagamentoMeio, PessoaMeio, ResumoSituacao, SituacaoPagamentoMeio } from "./pagamento-meio.js";
import { GRUPO_SEM_EMPRESA, GRUPO_SEM_REGISTRO } from "./pagamento-meio.js";

/** Título de 13º ativo (sem os excluídos e cancelados). */
export type ItemDaLista13 = {
  id: string; employeeId: string; periodLabel: string; amount: number; dueDate: Date; paymentDate: Date | null; paidAmount: number | null;
  details: unknown;
};
/** O que a prévia do 13º diz de uma linha (só o que a lista usa). */
export type LinhaPreviaLista13 = {
  employeeId: string; origem: "SEM_REGISTRO" | "COMBINADO"; viaExtrato: boolean;
  calculo: { vencimento1: string; vencimento2: string } | null;
  // 1ª parcela da linha (a 2ª da diferença só entra na lista com a 1ª resolvida no título do extrato).
  p1?: { gerar: boolean; aguardaExtrato?: boolean; conferir?: boolean };
  p: { existe: boolean; paga: boolean; lancado: number | null; devido: number | null; gerar: boolean; aguardaExtrato?: boolean };
};

export type ListaDecimo13 = {
  parcela: 1 | 2; ano: number; linhas: LinhaPagamentoMeio[]; total: number; avisos: string[];
  // Pessoas com salário combinado cuja diferença ainda não entrou na lista (aguardam o extrato do 13º): o PDF não pode sair como "lançado".
  aguardandoExtrato: string[];
  aLancar: ResumoSituacao; lancado: ResumoSituacao; pago: ResumoSituacao;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const dia = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmm = (iso: string) => iso.slice(0, 10).split("-").slice(1).reverse().join("/");
const det = (d: unknown): Record<string, unknown> => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});

function grupoDe(semRegistro: boolean, d: unknown, pessoa: PessoaMeio | undefined): string {
  if (semRegistro) return GRUPO_SEM_REGISTRO;
  const doExtrato = det(d).empresa;
  const nome = typeof doExtrato === "string" && doExtrato.trim() ? doExtrato : pessoa?.empresa;
  return nome?.trim() ? nome.trim().toUpperCase() : GRUPO_SEM_EMPRESA;
}

/** Ordem: empresas em ordem alfabética, sem empresa e sem registro por último; dentro, pelo nome. */
function ordenar(linhas: LinhaPagamentoMeio[]): LinhaPagamentoMeio[] {
  const peso = (g: string) => (g === GRUPO_SEM_REGISTRO ? 2 : g === GRUPO_SEM_EMPRESA ? 1 : 0);
  return [...linhas].sort((a, b) => peso(a.grupo) - peso(b.grupo)
    || a.grupo.localeCompare(b.grupo, "pt-BR")
    || a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

export function montarListaDecimo13(
  ano: number, parcela: 1 | 2, itens: ItemDaLista13[], previa: LinhaPreviaLista13[], pessoas: Map<string, PessoaMeio>,
): ListaDecimo13 {
  // Quem tem a diferença do combinado por somar ao título do extrato (gerar a parcela atualiza o título).
  const faltaSomar = new Map<string, number>(parcela === 1 ? previa.filter((l) => l.origem === "COMBINADO" && l.viaExtrato && l.p.gerar).map((l): [string, number] => [l.employeeId, l.p.devido ?? 0]) : []);
  // (a soma de devido 0 também conta: o título volta ao líquido do extrato)
  // Quem tem o cálculo de hoje diferente do título em aberto (sem registro).
  const desatualizado = new Map(previa.filter((l) => l.origem === "SEM_REGISTRO" && l.p.existe && l.p.gerar).map((l) => [l.employeeId, l.p.devido ?? 0]));

  const dosItens = itens
    .filter((i) => familia13(i.periodLabel).parcela === parcela)
    .map((i): LinhaPagamentoMeio => {
      const pessoa = pessoas.get(i.employeeId);
      const origemDoRotulo = familia13(i.periodLabel).origem;
      const semRegistro = origemDoRotulo === "SEM_REGISTRO";
      const pago = i.paymentDate != null;
      const valor = round2(i.amount);
      const valorPago = pago ? round2(i.paidAmount ?? i.amount) : null;
      const avisos: string[] = [];
      let somar: number | null = null;
      if (!pago && origemDoRotulo === "EXTRATO" && faltaSomar.has(i.employeeId)) {
        // Falta somar, ou somar de novo: o cálculo de hoje deu outra diferença. O título vale o líquido do extrato + a diferença de hoje.
        const diferenca = faltaSomar.get(i.employeeId)!;
        const liquido = foiSomado(i.details) ? liquidoDoExtrato(i.details) ?? round2(valor - (complementoSomado(i.details) ?? 0)) : valor;
        somar = round2(liquido + diferenca);
        avisos.push(`Título em aberto de ${reais(valor)}; com a diferença do salário combinado (${reais(diferenca)}) fica ${reais(somar)}: lance a parcela na tela do 13º antes de pagar.`);
      } else if (foiSomado(i.details)) {
        avisos.push(`Inclui a diferença do salário combinado (${reais(complementoSomado(i.details) ?? 0)}) somada ao líquido do extrato.`);
      } else if (origemDoRotulo === "COMBINADO") {
        avisos.push("Só a diferença do salário combinado (o 13º do registrado está no título do extrato).");
      }
      const hoje = !pago && semRegistro ? desatualizado.get(i.employeeId) : undefined;
      if (hoje != null) avisos.push(`O cálculo de hoje dá ${reais(hoje)}: lançar de novo atualiza o título.`);
      if (pago && valorPago != null && Math.abs(valorPago - valor) >= 0.005) avisos.push(`Pago ${reais(valorPago)} (título de ${reais(valor)}).`);
      return {
        employeeId: i.employeeId, nome: pessoa?.nome ?? "—", grupo: grupoDe(semRegistro, i.details, pessoa),
        origem: semRegistro ? "SEM_REGISTRO" : "EXTRATO", valor,
        situacao: pago ? "PAGO" : "LANCADO", vencimento: dia(i.dueDate), pagoEm: pago ? dia(i.paymentDate!) : null, valorPago,
        payrollItemId: i.id, pix: pessoa?.pix ?? null, pixTipo: pessoa?.pixTipo ?? null, contaBancaria: pessoa?.contaBancaria ?? null,
        aviso: avisos.length > 0 ? avisos.join(" ") : null, atualizarPara: hoje ?? somar,
      };
    });

  // Sem registro (e diferença do combinado lançada à parte) que o cálculo deu e ainda não tem título.
  const aLancar = previa
    .filter((l) => l.p.gerar && !l.p.existe && l.p.lancado == null && (l.p.devido ?? 0) > 0 && l.calculo
      && (l.origem === "SEM_REGISTRO"
        || (parcela === 1 && !l.viaExtrato && !l.p.aguardaExtrato)
        || (parcela === 2 && !(l.p1?.aguardaExtrato || l.p1?.conferir || (l.viaExtrato && l.p1?.gerar)))))
    .map((l): LinhaPagamentoMeio => {
      const pessoa = pessoas.get(l.employeeId);
      const venc = parcela === 1 ? l.calculo!.vencimento1 : l.calculo!.vencimento2;
      return {
        employeeId: l.employeeId, nome: pessoa?.nome ?? "—", grupo: l.origem === "SEM_REGISTRO" ? GRUPO_SEM_REGISTRO : grupoDe(false, null, pessoa),
        origem: l.origem === "SEM_REGISTRO" ? "SEM_REGISTRO" : "EXTRATO", valor: round2(l.p.devido ?? 0),
        situacao: "A_LANCAR", vencimento: venc, pagoEm: null, valorPago: null, payrollItemId: null,
        pix: pessoa?.pix ?? null, pixTipo: pessoa?.pixTipo ?? null, contaBancaria: pessoa?.contaBancaria ?? null,
        aviso: `Ainda não está no Contas a Pagar: vence ${ddmm(venc)}.`, atualizarPara: null,
      };
    });

  const linhas = ordenar([...dosItens, ...aLancar]);
  const resumo = (s: SituacaoPagamentoMeio): ResumoSituacao => {
    const doTipoS = linhas.filter((l) => l.situacao === s);
    return { pessoas: doTipoS.length, total: round2(doTipoS.reduce((a, l) => a + (s === "PAGO" ? l.valorPago ?? l.valor : l.valor), 0)) };
  };
  const avisos: string[] = [];
  const aguardandoExtrato = parcela === 1
    ? previa.filter((l) => l.origem === "COMBINADO" && l.p.aguardaExtrato).map((l) => pessoas.get(l.employeeId)?.nome ?? "—")
    : [];
  if (aguardandoExtrato.length > 0) {
    avisos.push(`${aguardandoExtrato.length} pessoa(s) com salário combinado aguardam o extrato do 13º (Retorno do RH): a diferença entra no título quando o extrato é importado.`);
  }
  return {
    parcela, ano, linhas, total: round2(linhas.reduce((a, l) => a + l.valor, 0)), avisos, aguardandoExtrato,
    aLancar: resumo("A_LANCAR"), lancado: resumo("LANCADO"), pago: resumo("PAGO"),
  };
}
