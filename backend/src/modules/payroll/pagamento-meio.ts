// Lista de pagamento do meio do mês: adiantamento (dia 20) ou 1ª quinzena (dia 15). É a
// conferência do que está no Contas a Pagar antes de ir ao banco, como a folha de líquidos:
// uma linha por pessoa, agrupada por empresa (sem registro num grupo só), com a situação
// (a lançar, lançado, pago) e os dados bancários. Nada é gravado aqui.
//   - CLT: o adiantamento vem do extrato da contabilidade (ou da folha gerada).
//   - Sem registro: o sistema calcula; o que ainda não foi lançado aparece como "a lançar".

export type TipoPagamentoMeio = "ADIANTAMENTO" | "QUINZENA";
export type SituacaoPagamentoMeio = "A_LANCAR" | "LANCADO" | "PAGO";

/** ADIANTAMENTO já gravado na competência (sem os excluídos). */
export type LancadoMeio = {
  id: string; employeeId: string; amount: number; dueDate: Date; paymentDate: Date | null; paidAmount: number | null; details: unknown;
};
/** Item do cálculo da folha (computePayroll). */
export type PrevistoMeio = {
  employeeId: string; type: string; amount: number; dueDate: string; details: Record<string, unknown> | null;
  exists: boolean; desatualizado?: boolean;
};
export type PessoaMeio = {
  id: string; nome: string; semRegistro: boolean; empresa: string | null;
  pix: string | null; pixTipo: string | null; contaBancaria: string | null;
};

export type LinhaPagamentoMeio = {
  employeeId: string; nome: string; grupo: string; origem: "EXTRATO" | "SEM_REGISTRO"; valor: number;
  situacao: SituacaoPagamentoMeio; vencimento: string; pagoEm: string | null; valorPago: number | null; payrollItemId: string | null;
  pix: string | null; pixTipo: string | null; contaBancaria: string | null; aviso: string | null;
};

export const GRUPO_SEM_REGISTRO = "Sem registro";
export const GRUPO_SEM_EMPRESA = "Sem empresa no cadastro";

const det = (d: unknown) => (d && typeof d === "object" ? (d as Record<string, unknown>) : {});
const ehQuinzena = (d: unknown) => det(d).primeiraQuinzena === true;
const doTipo = (tipo: TipoPagamentoMeio, d: unknown) => (tipo === "QUINZENA" ? ehQuinzena(d) : !ehQuinzena(d));
const round2 = (v: number) => Math.round(v * 100) / 100;
const dia = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ddmm = (iso: string) => iso.slice(0, 10).split("-").slice(1).reverse().join("/");

/** Empresa em maiúsculas (como no extrato), para o mesmo grupo não sair duas vezes. */
function grupoDe(semRegistro: boolean, d: unknown, pessoa: PessoaMeio | undefined): string {
  if (semRegistro) return GRUPO_SEM_REGISTRO;
  const doExtrato = det(d).empresa;
  const nome = typeof doExtrato === "string" && doExtrato.trim() ? doExtrato : pessoa?.empresa;
  return nome?.trim() ? nome.trim().toUpperCase() : GRUPO_SEM_EMPRESA;
}

function avisoDe(l: { semRegistro: boolean; valor: number; valorPago: number | null; pago: boolean }, d: unknown, pessoa: PessoaMeio | undefined, calculado: number | null): string | null {
  const avisos: string[] = [];
  if (!l.semRegistro && pessoa?.semRegistro) avisos.push("No cadastro está sem registro, mas veio da contabilidade: confira o vínculo em Funcionários.");
  if (!l.semRegistro && pessoa && !pessoa.semRegistro && !pessoa.empresa) avisos.push("Sem empresa no cadastro (Funcionários → Trabalho).");
  if (det(d).complemento === true) avisos.push("Complemento.");
  if (l.pago && l.valorPago != null && Math.abs(l.valorPago - l.valor) >= 0.005) avisos.push(`Pago ${reais(l.valorPago)} (título de ${reais(l.valor)}).`);
  if (calculado != null) avisos.push(`O cálculo de hoje dá ${reais(calculado)}: lançar de novo atualiza o título.`);
  return avisos.length > 0 ? avisos.join(" ") : null;
}

/** Ordem: empresas em ordem alfabética, sem empresa e sem registro por último; dentro, pelo nome. */
function ordenar(linhas: LinhaPagamentoMeio[]): LinhaPagamentoMeio[] {
  const peso = (g: string) => (g === GRUPO_SEM_REGISTRO ? 2 : g === GRUPO_SEM_EMPRESA ? 1 : 0);
  return [...linhas].sort((a, b) => peso(a.grupo) - peso(b.grupo)
    || a.grupo.localeCompare(b.grupo, "pt-BR")
    || a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

export type ResumoSituacao = { pessoas: number; total: number };
export type PagamentoMeio = {
  tipo: TipoPagamentoMeio; linhas: LinhaPagamentoMeio[]; total: number;
  aLancar: ResumoSituacao; lancado: ResumoSituacao; pago: ResumoSituacao;
};

export function montarPagamentoMeio(
  tipo: TipoPagamentoMeio, lancados: LancadoMeio[], previstos: PrevistoMeio[], pessoas: Map<string, PessoaMeio>,
): PagamentoMeio {
  const calculados = previstos.filter((p) => p.type === "ADIANTAMENTO" && det(p.details).semRegistro === true && doTipo(tipo, p.details));
  // Título em aberto com valor diferente do cálculo de hoje (só a 1ª quinzena atualiza).
  const desatualizado = new Map(calculados.filter((p) => p.exists && p.desatualizado).map((p) => [p.employeeId, p.amount]));

  const dosLancados = lancados.filter((i) => doTipo(tipo, i.details)).map((i): LinhaPagamentoMeio => {
    const pessoa = pessoas.get(i.employeeId);
    const semRegistro = det(i.details).semRegistro === true;
    const pago = i.paymentDate != null;
    const valor = round2(i.amount);
    const valorPago = pago ? round2(i.paidAmount ?? i.amount) : null;
    return {
      employeeId: i.employeeId, nome: pessoa?.nome ?? "—", grupo: grupoDe(semRegistro, i.details, pessoa),
      origem: semRegistro ? "SEM_REGISTRO" : "EXTRATO", valor,
      situacao: pago ? "PAGO" : "LANCADO", vencimento: dia(i.dueDate), pagoEm: pago ? dia(i.paymentDate!) : null, valorPago,
      payrollItemId: i.id, pix: pessoa?.pix ?? null, pixTipo: pessoa?.pixTipo ?? null, contaBancaria: pessoa?.contaBancaria ?? null,
      aviso: avisoDe({ semRegistro, valor, valorPago, pago }, i.details, pessoa, !pago && semRegistro ? desatualizado.get(i.employeeId) ?? null : null),
    };
  });

  const aLancar = calculados.filter((p) => !p.exists && p.amount > 0).map((p): LinhaPagamentoMeio => {
    const pessoa = pessoas.get(p.employeeId);
    return {
      employeeId: p.employeeId, nome: pessoa?.nome ?? "—", grupo: GRUPO_SEM_REGISTRO, origem: "SEM_REGISTRO", valor: round2(p.amount),
      situacao: "A_LANCAR", vencimento: dia(p.dueDate), pagoEm: null, valorPago: null, payrollItemId: null,
      pix: pessoa?.pix ?? null, pixTipo: pessoa?.pixTipo ?? null, contaBancaria: pessoa?.contaBancaria ?? null,
      aviso: `Ainda não está no Contas a Pagar: vence ${ddmm(dia(p.dueDate))}.`,
    };
  });

  const linhas = ordenar([...dosLancados, ...aLancar]);
  const resumo = (s: SituacaoPagamentoMeio): ResumoSituacao => {
    const doTipoS = linhas.filter((l) => l.situacao === s);
    return { pessoas: doTipoS.length, total: round2(doTipoS.reduce((a, l) => a + l.valor, 0)) };
  };
  return {
    tipo, linhas, total: round2(linhas.reduce((a, l) => a + l.valor, 0)),
    aLancar: resumo("A_LANCAR"), lancado: resumo("LANCADO"), pago: resumo("PAGO"),
  };
}
