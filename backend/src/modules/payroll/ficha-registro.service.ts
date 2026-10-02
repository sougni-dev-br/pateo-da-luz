// Ficha de registro no banco: leitura para a tela e gravação da importação.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";
import { ORIGEM_FICHA, type PlanoFicha, resumoFerias } from "./ficha-registro.js";

type Db = Pick<PrismaClient, "employeeDependente" | "employeeFerias" | "employeeAnotacaoCarteira">;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function lerFichaDoFuncionario(
  employee: { id: string; admissaoCarteira: Date | null; terminationDate: Date | null },
  verSalario: boolean,
  db: Db = prisma,
) {
  const [dependentes, ferias, anotacoes] = await Promise.all([
    db.employeeDependente.findMany({ where: { employeeId: employee.id }, orderBy: { nome: "asc" } }),
    db.employeeFerias.findMany({ where: { employeeId: employee.id }, orderBy: [{ aquisitivoInicio: "asc" }, { gozoInicio: "asc" }] }),
    db.employeeAnotacaoCarteira.findMany({ where: { employeeId: employee.id }, orderBy: [{ data: "desc" }, { tipo: "asc" }] }),
  ]);
  const hoje = new Date(`${hojeEmSaoPaulo()}T00:00:00.000Z`);
  // Os períodos aquisitivos contam da admissão que a FICHA registra (é dela que vêm os
  // períodos gravados); sem ficha, a admissão em carteira do cadastro.
  const admissao = anotacoes.find((a) => a.tipo === "ADMISSAO")?.data ?? employee.admissaoCarteira ?? ferias[0]?.aquisitivoInicio ?? null;
  return {
    dependentes: dependentes.map((d) => ({ id: d.id, nome: d.nome, parentesco: d.parentesco, dataNascimento: iso(d.dataNascimento) })),
    ferias: admissao ? resumoFerias(admissao, employee.terminationDate, ferias, hoje) : [],
    salarioOculto: !verSalario,
    carteira: anotacoes.map((a) => ({
      id: a.id, tipo: a.tipo, data: iso(a.data),
      salario: verSalario && a.salario != null ? Number(a.salario) : null,
      retroativoCompetencia: a.retroativoCompetencia,
      cargoAnterior: a.cargoAnterior, cboAnterior: a.cboAnterior, cargo: a.cargo, cbo: a.cbo,
    })),
  };
}

// Regrava o que veio da ficha (dependentes, férias, carteira). A ficha é cumulativa: o que a
// importação anterior gravou é apagado e gravado de novo; o lançado à mão (origem CADASTRO) fica.
export async function regravarListasDaFicha(tx: Db, employeeId: string, plano: Pick<PlanoFicha, "dependentes" | "ferias" | "anotacoes">) {
  const daFicha = { employeeId, origem: ORIGEM_FICHA };
  await tx.employeeDependente.deleteMany({ where: daFicha });
  await tx.employeeFerias.deleteMany({ where: daFicha });
  await tx.employeeAnotacaoCarteira.deleteMany({ where: daFicha });
  if (plano.dependentes.length) await tx.employeeDependente.createMany({ data: plano.dependentes.map((nome) => ({ ...daFicha, nome })) });
  if (plano.ferias.length) await tx.employeeFerias.createMany({ data: plano.ferias.map((f) => ({ ...daFicha, ...f })) });
  if (plano.anotacoes.length) await tx.employeeAnotacaoCarteira.createMany({ data: plano.anotacoes.map((a) => ({ ...daFicha, ...a })) });
}
