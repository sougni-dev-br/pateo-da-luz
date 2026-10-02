// Lote de pagamento da folha — regras puras (sem banco). Depois do OK à contabilidade, a
// folha de líquidos é "liberada para pagamento": um título por empresa no Contas a Pagar,
// cada um agrupando os SALARIO em aberto das pessoas daquele grupo. O serviço
// (folha-lote.service.ts) lê e grava; aqui só se decide quem vai para onde.
import { quintoDiaUtil } from "./acerto-lista.js";
import type { LinhaFolha } from "./tip-conferencia.js";

export const GRUPO_SEM_REGISTRO = "SEM_REGISTRO";
export const GRUPO_A_PARTE = "A_PARTE";
export const STATUS_LOTE = { ABERTO: "ABERTO", PAGO: "PAGO", CANCELADO: "CANCELADO" } as const;
export type StatusLote = (typeof STATUS_LOTE)[keyof typeof STATUS_LOTE];

const pad = (n: number) => String(n).padStart(2, "0");
const round2 = (v: number) => Math.round(v * 100) / 100;
const digitos = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const competenciaDoLote = (ano: number, mes: number) => `${pad(mes)}/${ano}`;

/**
 * Vencimento do título: o 5º dia útil do mês seguinte à competência — o mesmo do acerto da
 * lista (quintoDiaUtil: segunda a sábado, fora domingo e feriados). Ex.: 09/2026 → 06/10/2026.
 */
export function vencimentoDoLote(ano: number, mes: number): Date {
  return mes === 12 ? quintoDiaUtil(ano + 1, 1) : quintoDiaUtil(ano, mes + 1);
}

/** "Folha 09/2026 · Pateo da Luz", "Folha 09/2026 · Sem registro", "Folha à parte 09/2026". */
export function rotuloDoLote(ano: number, mes: number, grupo: string, nomeEmpresa: string | null): string {
  const mmaaaa = competenciaDoLote(ano, mes);
  if (grupo === GRUPO_A_PARTE) return `Folha à parte ${mmaaaa}`;
  if (grupo === GRUPO_SEM_REGISTRO) return `Folha ${mmaaaa} · Sem registro`;
  return `Folha ${mmaaaa} · ${nomeEmpresa?.trim() || grupo}`;
}

// SALARIO da competência em aberto, ainda fora de lote (sem baixa, não excluído nem cancelado).
export type SalarioAberto = { id: string; employeeId: string; amount: number };
export type MembroPlanejado = { payrollItemId: string; employeeId: string; nome: string; valor: number };
export type GrupoPlanejado = { grupo: string; rotulo: string; membros: MembroPlanejado[]; total: number };
export type PlanoDoLote = { grupos: GrupoPlanejado[]; avisos: string[] };

type LinhaParaLote = Pick<LinhaFolha, "employeeId" | "nome" | "grupo" | "origem" | "valor">;

/**
 * Monta os grupos a partir da folha de líquidos (os mesmos grupos e pessoas; quem já está
 * pago já saiu dela). Cada pessoa leva os SALARIO em aberto dela; o total é a soma deles.
 * - CLT: o grupo é o CNPJ do extrato de onde veio a linha; sem registro: SEM_REGISTRO.
 * - jaEmLote: quem já está num lote (liberado antes, ou retirado para a folha à parte) não entra.
 * - Pessoa na folha sem SALARIO em aberto, ou com SALARIO de valor diferente da folha: aviso.
 */
export function planejarLotes(
  ano: number, mes: number, linhas: LinhaParaLote[], extratos: Array<{ empresa: string; cnpj: string }>,
  salarios: SalarioAberto[], empresas: Map<string, string>, jaEmLote: Set<string> = new Set(),
): PlanoDoLote {
  const cnpjDaEmpresa = new Map(extratos.map((e) => [e.empresa, digitos(e.cnpj)]));
  const porPessoa = new Map<string, SalarioAberto[]>();
  for (const s of salarios) porPessoa.set(s.employeeId, [...(porPessoa.get(s.employeeId) ?? []), s]);
  const grupos = new Map<string, GrupoPlanejado>();
  const avisos: string[] = [];
  const vistos = new Set<string>();

  for (const l of linhas) {
    if (!l.employeeId) {
      avisos.push(`${l.nome}: não achado no cadastro — fica fora do lote; pague à parte.`);
      continue;
    }
    if (vistos.has(l.employeeId)) {
      avisos.push(`${l.nome}: aparece em mais de um grupo da folha; entrou só no primeiro.`);
      continue;
    }
    vistos.add(l.employeeId);
    if (jaEmLote.has(l.employeeId)) continue;
    const itens = porPessoa.get(l.employeeId) ?? [];
    if (itens.length === 0) {
      avisos.push(`${l.nome}: sem salário de ${competenciaDoLote(ano, mes)} em aberto no Contas a Pagar — fica fora do lote.`);
      continue;
    }
    const grupo = l.origem === "SEM_REGISTRO" ? GRUPO_SEM_REGISTRO : cnpjDaEmpresa.get(l.grupo) || l.grupo;
    const soma = round2(itens.reduce((a, s) => a + s.amount, 0));
    if (Math.abs(soma - l.valor) >= 0.01) {
      avisos.push(`${l.nome}: no Contas a Pagar ${brl(soma)}, na folha de líquidos ${brl(l.valor)} — o título usa o do Contas a Pagar.`);
    }
    const atual = grupos.get(grupo) ?? {
      grupo, rotulo: rotuloDoLote(ano, mes, grupo, grupo === GRUPO_SEM_REGISTRO ? null : empresas.get(grupo) ?? l.grupo), membros: [], total: 0,
    };
    const membros = [...atual.membros, ...itens.map((s) => ({ payrollItemId: s.id, employeeId: s.employeeId, nome: l.nome, valor: round2(s.amount) }))];
    grupos.set(grupo, { ...atual, membros, total: round2(membros.reduce((a, m) => a + m.valor, 0)) });
  }

  // SALARIO em aberto de quem não está na folha de líquidos: não vai para lote nenhum.
  const fora = salarios.filter((s) => !vistos.has(s.employeeId));
  if (fora.length > 0) {
    avisos.push(`${new Set(fora.map((s) => s.employeeId)).size} pessoa(s) com salário de ${competenciaDoLote(ano, mes)} em aberto fora da folha de líquidos — não entram no lote.`);
  }
  // Empresas na ordem dos extratos; sem registro por último.
  const ordem = (g: string) => (g === GRUPO_SEM_REGISTRO ? 1 : 0);
  return { grupos: [...grupos.values()].sort((a, b) => ordem(a.grupo) - ordem(b.grupo)), avisos };
}

/** Todos os lotes vivos (não cancelados) da competência pagos — e há ao menos um. */
export function todosPagos(lotes: Array<{ status: string }>): boolean {
  const vivos = lotes.filter((l) => l.status !== STATUS_LOTE.CANCELADO);
  return vivos.length > 0 && vivos.every((l) => l.status === STATUS_LOTE.PAGO);
}

/** Mensagem para quem tenta mexer sozinho num SALARIO que está num lote. */
export function mensagemMembroDoLote(rotulo: string, pago: boolean): string {
  return pago
    ? `Este salário foi pago no lote "${rotulo}": estorne o lote no Contas a Pagar.`
    : `Este salário está no lote "${rotulo}": retire do lote antes.`;
}
