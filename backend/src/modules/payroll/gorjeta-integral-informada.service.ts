// Gorjeta integral do mês digitada à mão: UMA tabela por pessoa e competência (AAAA-MM), usada pelas férias do salário
// combinado (modal) e pelo 13º. Só preenche mês sem apuração no sistema (a precedência é decidida por quem lê).
import { prisma } from "../../config/database.js";

const round2 = (v: number) => Math.round(v * 100) / 100;

export type InformadaDaTabela = { competencia: string; valor: number };

export async function informadasDaPessoa(employeeId: string, competencias: ReadonlyArray<string>): Promise<InformadaDaTabela[]> {
  if (competencias.length === 0) return [];
  const rows = await prisma.gorjetaIntegralInformada.findMany({
    where: { employeeId, competencia: { in: [...competencias] } }, select: { competencia: true, valor: true },
  });
  return rows.map((r) => ({ competencia: r.competencia, valor: round2(Number(r.valor)) }));
}

// Informadas de várias pessoas num ano-base (13º): competências AAAA-01 a AAAA-11.
export async function informadasDoAno(employeeIds: ReadonlyArray<string>, ano: number): Promise<Map<string, InformadaDaTabela[]>> {
  const out = new Map<string, InformadaDaTabela[]>();
  if (employeeIds.length === 0) return out;
  const rows = await prisma.gorjetaIntegralInformada.findMany({
    where: { employeeId: { in: [...employeeIds] }, competencia: { startsWith: `${ano}-` } }, select: { employeeId: true, competencia: true, valor: true },
  });
  for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), { competencia: r.competencia, valor: round2(Number(r.valor)) }]);
  return out;
}

// Grava (cria ou troca) os meses informados. Idempotente: reaplicar o mesmo valor não muda nada de relevante.
export async function gravarInformadas(employeeId: string, meses: ReadonlyMap<string, number>, userId: string): Promise<void> {
  for (const [competencia, valor] of meses) {
    const v = round2(valor);
    await prisma.gorjetaIntegralInformada.upsert({
      where: { employeeId_competencia: { employeeId, competencia } },
      create: { id: crypto.randomUUID(), employeeId, competencia, valor: v, origem: "INFORMADA", criadoPorId: userId },
      update: { valor: v, atualizadoPorId: userId },
    });
  }
}

// Apaga o valor informado dos meses (o mês volta a valer a apuração). Idempotente.
export async function apagarInformadas(employeeId: string, competencias: ReadonlyArray<string>): Promise<void> {
  if (competencias.length === 0) return;
  await prisma.gorjetaIntegralInformada.deleteMany({ where: { employeeId, competencia: { in: [...competencias] } } });
}
